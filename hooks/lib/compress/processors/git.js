'use strict';
/**
 * git status | diff | show | log.
 *
 *  - status: `git` hints dropped, entries grouped by directory with counts;
 *    every path stays visible.
 *  - diff / show / log -p: see git-diff.js — no context line is ever removed.
 *  - log: one `hash7 subject` line per commit, ALL commits kept, and only when
 *    the caller asked for nothing specific (no -n, format, patch, graph…).
 *    Output of an unexpected shape is returned untouched.
 */
const { condenseDiff } = require('./git-diff');
const { plural } = require('../text');

function subcommand(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += words[i] === '-C' ? 2 : 1;
  return words[i] || '';
}

// ------------------------------------------------------------------ status
const SECTION = /^(Changes to be committed|Changes not staged for commit|Untracked files|Unmerged paths|Ignored files):$/;
const HINT = /^\s*\((use "git|commit or discard|fix conflicts|all conflicts)/;
const ENTRY = /^\t(?:(new file|modified|deleted|renamed|typechange|copied|both modified|both added|both deleted|added by us|added by them|deleted by us|deleted by them):\s+)?(.+)$/;
const CODES = { 'new file': 'A', modified: 'M', deleted: 'D', renamed: 'R', typechange: 'T', copied: 'C' };

function splitPath(p) {
  const trimmed = p.replace(/\/$/, '');
  const cut = trimmed.lastIndexOf('/');
  const tail = p.endsWith('/') ? '/' : '';
  return cut < 0 ? ['.', trimmed + tail] : [trimmed.slice(0, cut), trimmed.slice(cut + 1) + tail];
}

function groupEntries(entries) {
  if (entries.length <= 8) return entries.map((e) => `  ${e.code ? e.code + ' ' : ''}${e.path}`);
  const dirs = new Map();
  for (const e of entries) {
    const [dir, base] = splitPath(e.path.split(' -> ').pop());
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(`${e.code ? e.code + ' ' : ''}${base}`);
  }
  return [...dirs].map(([dir, names]) => {
    const shown = names.slice(0, 12).join(', ');
    const more = names.length > 12 ? `, … +${names.length - 12}` : '';
    return `  ${dir}/ (${names.length}) : ${shown}${more}`;
  });
}

function status(text) {
  const out = [];
  let section = null;
  const flush = () => {
    if (section) out.push(`${section.title} (${section.entries.length})`, ...groupEntries(section.entries));
    section = null;
  };
  for (const line of text.split('\n')) {
    if (SECTION.test(line)) { flush(); section = { title: line.slice(0, -1), entries: [] }; continue; }
    if (HINT.test(line)) continue;
    const m = section && ENTRY.exec(line);
    if (m) { section.entries.push({ code: CODES[m[1]] || (m[1] ? 'U' : ''), path: m[2].trim() }); continue; }
    if (!line.trim()) continue;
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

// ------------------------------------------------------------------ log
const EXPLICIT = /^(-n.*|-\d+|--max-count.*|--format.*|--pretty.*|--oneline|-p|-u|--patch|--stat.*|--shortstat|--numstat|--name-only|--name-status|--graph|-L.*|--raw|--summary|-s|--no-patch)$/;

function condenseLog(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const m = /^commit ([0-9a-f]{7,64})(.*)$/.exec(lines[i]);
    if (!m) return null;
    i++;
    while (i < lines.length && /^[A-Za-z]+:/.test(lines[i])) i++;
    let subject = '';
    while (i < lines.length && !lines[i].startsWith('commit ')) {
      if (!subject && lines[i].startsWith('    ')) subject = lines[i].trim();
      else if (lines[i].trim() && !lines[i].startsWith('    ')) return null;
      i++;
    }
    out.push(`${m[1].slice(0, 7)}${m[2]} ${subject}`);
  }
  return out.length ? `[ccx: ${plural(out.length, 'commit')} — hash + sujet]\n${out.join('\n')}` : null;
}

function log(text, words) {
  if (text.includes('\ndiff --git ') || text.startsWith('diff --git ')) return condenseDiff(text);
  if (words.slice(1).some((w) => EXPLICIT.test(w))) return text;
  return condenseLog(text) || text;
}

module.exports = {
  name: 'git',
  match: (cmd) => /^\s*git\s/.test(cmd),
  // A successful git output is content (commit messages, code), not diagnostics:
  // `fix error handling` is not an error. Failures go through generic + recovery.
  recoverOnSuccess: false,
  process(text, ctx) {
    const sub = subcommand(ctx.words);
    if (sub === 'status') return status(text);
    if (sub === 'log') return log(text, ctx.words);
    return condenseDiff(text);
  },
  status, condenseLog,
};
