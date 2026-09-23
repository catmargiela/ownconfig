'use strict';
/**
 * Session capture: folds transcript entries into a small accumulator that is
 * persisted between Stop passes, so each pass only reads what was appended.
 */
const os = require('os');
const path = require('path');
const { gitRoot, findUp } = require('../util');
const { realOr } = require('./naming');
const F = require('./filters');

const CAP = { asks: 40, files: 300, outside: 300, errors: 20, commits: 50, prs: 20, pending: 50, text: 20000 };

function emptyAcc() {
  return {
    v: 2, offset: 0, startTs: null, endTs: null, branches: [], asks: [], files: [], outside: [],
    errors: [], refusals: 0, commits: [], prs: [], lastText: '', turnText: [], pending: {},
  };
}

/** Appends `item` (moved to the end when already present), keeping the last `max`. */
const pushLast = (list, item, max) => [...list.filter((x) => x !== item), item].slice(-max);
/** Appends `item` only when new, keeping the first `max`. */
const pushOnce = (list, item, max) => (list.includes(item) || list.length >= max ? list : [...list, item]);

// ---------------------------------------------------------------- files

const TEMP = [/^\/tmp\//, /^\/private\/tmp\//, /^\/private\/var\/folders\//, /^\/var\/folders\//, /\/\.claude\/jobs\//];

function isTemp(abs) {
  const tmp = os.tmpdir();
  return TEMP.some((re) => re.test(abs)) || abs.startsWith(tmp + path.sep) || abs.startsWith(realOr(tmp) + path.sep);
}

/** Path relative to the worktree holding `abs` (a worktree of the project). */
function worktreeRelative(abs) {
  const top = findUp(path.dirname(abs), ['.git']);
  return top ? path.relative(top.dir, abs) : null;
}

/**
 * Where an edited file belongs: `{ rel }` inside the project (relative path),
 * `{ outside: abs }` otherwise. Temporary and job paths are always outside,
 * even when they are worktrees of the project.
 */
function classifyFile(file, root) {
  if (!file) return null;
  const abs = path.resolve(String(file));
  if (root) {
    for (const r of new Set([root, realOr(root)])) {
      if (abs.startsWith(r + path.sep)) {
        const rel = path.relative(r, abs);
        return { rel: rel.replace(/^\.claude\/worktrees\/[^/]+\//, '') };
      }
    }
  }
  if (isTemp(abs) || !root) return { outside: abs };
  const own = gitRoot(path.dirname(abs));
  if (own && realOr(own) === realOr(root)) {
    const rel = worktreeRelative(abs);
    if (rel) return { rel };
  }
  return { outside: abs };
}

// ---------------------------------------------------------------- commits and PRs

const COMMIT_LINE = /^\[([^\]\n]+?) ([0-9a-f]{7,40})\] (.+)$/gm;
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

/** Tool calls whose result may announce a commit or a pull request. */
function pendingKind(block) {
  const name = String(block?.name || '');
  if (/create_pull_request/i.test(name)) return 'pr';
  if (name !== 'Bash') return null;
  const cmd = String(block.input?.command || '');
  if (/\bgh\s+pr\s+create\b/.test(cmd)) return /\bgit\s+(commit|cherry-pick|revert|merge)\b/.test(cmd) ? 'both' : 'pr';
  if (/\bgit\s+(commit|cherry-pick|revert|merge)\b/.test(cmd)) return 'commit';
  return null;
}

function collectCommits(acc, text) {
  let commits = acc.commits;
  for (const m of text.matchAll(COMMIT_LINE)) {
    if (commits.some((c) => c.hash === m[2])) continue;
    const branch = m[1].replace(/\s*\(root-commit\)/, '').trim();
    commits = pushOnce(commits, { hash: m[2], branch, msg: F.trimAtWord(m[3], 100) }, CAP.commits);
  }
  return { ...acc, commits };
}

function collectPrs(acc, text) {
  let prs = acc.prs;
  for (const url of text.match(PR_URL) || []) prs = pushOnce(prs, url, CAP.prs);
  return { ...acc, prs };
}

// ---------------------------------------------------------------- entries

function onToolResult(acc, b) {
  let next = acc;
  const kind = acc.pending[b.tool_use_id];
  if (kind) {
    const text = F.resultText(b.content);
    if (kind === 'commit' || kind === 'both') next = collectCommits(next, text);
    if (kind === 'pr' || kind === 'both') next = collectPrs(next, text);
    const { [b.tool_use_id]: _done, ...rest } = next.pending;
    next = { ...next, pending: rest };
  }
  if (!b.is_error) return next;
  const err = F.classifyError(b.content);
  if (err.kind === 'guard') return { ...next, refusals: next.refusals + 1 };
  if (err.kind !== 'error') return next;
  const errors = next.errors.some((e) => e === err.line) ? next.errors : [...next.errors, err.line].slice(-CAP.errors);
  return { ...next, errors };
}

function onUser(acc, m, e) {
  if (Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result')) {
    return m.content.filter((b) => b?.type === 'tool_result').reduce(onToolResult, { ...acc, turnText: [] });
  }
  const next = { ...acc, turnText: [] };
  if (e.isMeta || e.isCompactSummary) return next;
  const raw = typeof m.content === 'string' ? m.content
    : Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n') : '';
  const ask = F.userPrompt(raw);
  return ask ? { ...next, asks: pushLast(next.asks, ask, CAP.asks) } : next;
}

function onFile(acc, file, root) {
  const c = classifyFile(file, root);
  if (!c) return acc;
  if (c.rel) return { ...acc, files: pushOnce(acc.files, c.rel, CAP.files) };
  return { ...acc, outside: pushOnce(acc.outside, c.outside, CAP.outside) };
}

function onAssistant(acc, m, root) {
  let next = acc;
  for (const b of Array.isArray(m.content) ? m.content : []) {
    if (b?.type === 'text' && b.text && b.text.trim()) {
      const turnText = [...next.turnText, b.text.trim()];
      next = { ...next, turnText, lastText: turnText.join('\n\n').slice(0, CAP.text) };
    }
    if (b?.type !== 'tool_use') continue;
    const file = b.input?.file_path || b.input?.notebook_path || b.input?.path;
    if (file && /Edit|Write/i.test(b.name || '')) next = onFile(next, file, root);
    const kind = pendingKind(b);
    if (kind && b.id && Object.keys(next.pending).length < CAP.pending) {
      next = { ...next, pending: { ...next.pending, [b.id]: kind } };
    }
  }
  return next;
}

function onEntry(acc, e, root) {
  const m = e?.message;
  if (!m || e.isSidechain) return acc;
  const ts = typeof e.timestamp === 'string' ? e.timestamp : null;
  let next = ts ? { ...acc, startTs: acc.startTs || ts, endTs: ts } : acc;
  if (e.gitBranch && e.gitBranch !== 'HEAD') next = { ...next, branches: pushOnce(next.branches, e.gitBranch, 20) };
  if (m.role === 'user') return onUser(next, m, e);
  if (m.role === 'assistant') return onAssistant(next, m, root);
  return next;
}

/** Folds entries into the accumulator. `root` is the project's git root. */
function ingest(acc, entries, root) {
  return entries.reduce((a, e) => onEntry(a, e, root), acc || emptyAcc());
}

module.exports = { emptyAcc, ingest, classifyFile, pendingKind, CAP };
