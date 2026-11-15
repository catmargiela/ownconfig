'use strict';
/**
 * References of a project page that no longer exist: files and folders it
 * quotes, branches it names. A note about something that is gone is probably
 * outdated — this finds candidates without any model, for `/vault-tidy`.
 *
 * Only what can be checked on this machine is reported: a path under the home
 * directory, a path inside one of the folders the page declares, a branch of
 * one of those repositories. `/etc/…` on a server, a URL or an example never is.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BRANCH = /^(feat|feature|fix|chore|refactor|docs|test|perf|hotfix|release|wip)\/[\w./-]+$/;
const NOT_A_PATH = /[<>*?$|{}=;,&()\s…]|^https?:|^[a-z]+:\/\/|^\.\.?$|^-|\.\.\./i;
const HAS_EXT = /\.[A-Za-z0-9]{1,6}$/;

/**
 * Text in backticks with its line number in the file. The frontmatter and the
 * regions the hooks manage are skipped: only what was written by hand is judged.
 */
function quoted(raw) {
  const out = [];
  const lines = String(raw || '').split(/\r?\n/);
  let skip = lines[0] === '---' ? 'frontmatter' : null;
  lines.forEach((line, i) => {
    if (skip === 'frontmatter') { if (i > 0 && line === '---') skip = null; return; }
    if (/<!-- claude:[A-Za-z0-9:_-]+:start -->/.test(line)) skip = 'region';
    if (skip === 'region') { if (/<!-- claude:[A-Za-z0-9:_-]+:end -->/.test(line)) skip = null; return; }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) out.push({ token: m[1].trim(), line: i + 1, text: line.trim() });
  });
  return out;
}

/** Branch names of a repository, local and remote, without any network access. */
function branchesOf(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((b) => b.trim()).filter(Boolean);
  } catch { return null; }
}

/** 'missing' when `token` is a path that should exist here and does not; null when unknown or present. */
function pathState(token, dirs) {
  const home = os.homedir();
  if (token === '~' || token.startsWith('~/')) return fs.existsSync(path.join(home, token.slice(1))) ? null : 'missing';
  if (path.isAbsolute(token)) {
    const local = token === home || token.startsWith(home + path.sep) || dirs.some((d) => token.startsWith(d + path.sep));
    return local && !fs.existsSync(token) ? 'missing' : null;
  }
  const rel = token.replace(/^\.\//, '');
  if (!rel.includes('/') && !HAS_EXT.test(rel)) return null;          // a word, a command, a package name
  if (dirs.some((d) => fs.existsSync(path.join(d, rel)))) return null;
  // Judged only when its first folder is in the project: otherwise it is relative to somewhere unknown.
  const first = rel.split('/')[0];
  const anchored = rel.includes('/') && dirs.some((d) => fs.existsSync(path.join(d, first)));
  return anchored ? 'missing' : null;
}

/**
 * [{ kind: 'chemin'|'branche', token, line, text }] for the hand-written part
 * of `raw`, checked against the folders `dirs` the page covers.
 */
function staleRefs(raw, dirs) {
  const here = dirs.filter((d) => fs.existsSync(d));
  if (!here.length) return [];
  const known = here.map(branchesOf).filter(Boolean);
  const branches = new Set(known.flat().flatMap((b) => [b, b.replace(/^[^/]+\//, '')]));
  const seen = new Set();
  const out = [];
  for (const q of quoted(raw)) {
    const token = q.token.replace(/[.:]+$/, '').replace(/:\d+(-\d+)?$/, '');
    if (!token || NOT_A_PATH.test(token) || seen.has(token)) continue;
    let kind = null;
    const state = pathState(token, here);
    // `feat/x` names a branch unless it is a file (`docs/x.md`) or a folder that exists.
    if (BRANCH.test(token) && !HAS_EXT.test(token)) {
      const folder = here.some((d) => fs.existsSync(path.join(d, token)));
      if (known.length && !branches.has(token) && !folder) kind = 'branche';
    } else if (state === 'missing') kind = 'chemin';
    if (!kind) continue;
    seen.add(token);
    out.push({ kind, token, line: q.line, text: q.text });
  }
  return out;
}

module.exports = { staleRefs, quoted, pathState };
