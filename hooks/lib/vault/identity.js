'use strict';
/**
 * Which project page belongs to a working directory, and whether a directory
 * may have one at all.
 *
 * A page declares the folders it covers in its frontmatter:
 *
 *   chemin: /path/to/repo
 *   chemin: [/path/to/api, /path/to/front]
 *   chemin:
 *     - /path/to/api
 *     - /path/to/front
 *
 * A page without `chemin:` is never found: nothing is guessed from its name.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRoot } = require('../util');
const { DIRS, read } = require('./store');

const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '').trim();
const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/** Items of a block list (`  - value`) following line `at`. */
function blockItems(lines, at) {
  const items = [];
  for (let i = at + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s+(.+)$/);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

/** Folders declared by `chemin:` in the frontmatter (scalar, inline or block list). */
function declaredPaths(raw) {
  const fm = String(raw || '').match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const lines = fm[1].split('\n');
  const at = lines.findIndex((l) => /^chemin:/.test(l));
  if (at < 0) return [];
  const value = lines[at].slice('chemin:'.length).trim();
  const inline = value.match(/^\[(.*)\]$/);
  const items = inline ? inline[1].split(',') : value ? [value] : blockItems(lines, at);
  return items.map(unquote).filter(Boolean).map(expandHome);
}

/** Every project page that declares at least one folder, in file-name order. */
function projectPages() {
  let names = [];
  try { names = fs.readdirSync(DIRS.projets).filter((f) => f.endsWith('.md')).sort(); }
  catch { /* no Projets folder */ }
  return names
    .map((f) => {
      const file = path.join(DIRS.projets, f);
      const paths = declaredPaths(read(file));
      return { file, paths, real: paths.map(realOr) };
    })
    .filter((p) => p.paths.length > 0);
}

/** Does the page hold anything worth injecting? Loaded late: inject.js needs naming.js. */
function hasContent(file) {
  return require('./inject').cleanForInjection(read(file)).length > 0;
}

/** Among pages declaring the same folder: the one with real content, then name order. */
function pick(candidates) {
  if (candidates.length <= 1) return candidates[0] || null;
  return candidates.find((p) => hasContent(p.file)) || candidates[0];
}

/**
 * Pages declaring exactly `cwd`, else pages declaring its git root. Returned as
 * a list so a diagnostic can report a conflict; `findPage` picks the winner.
 */
function candidatePages(cwd) {
  if (!cwd) return [];
  const root = gitRoot(cwd) || cwd;
  const pages = projectPages();
  const declaring = (real, literal) => pages.filter((p) => p.real.includes(real) || p.paths.includes(literal));
  const exact = declaring(realOr(cwd), cwd);
  return exact.length ? exact : declaring(realOr(root), root);
}

/** File of the page covering `cwd`, or null. */
function findPage(cwd) {
  const winner = pick(candidatePages(cwd));
  return winner ? winner.file : null;
}

/** Is `real` a Claude Code session scratchpad (`<tmp>/claude-<uid>/…`)? */
function isScratchpad(real) {
  return [...new Set([realOr(os.tmpdir()), '/tmp'])].some((tmp) => {
    if (!real.startsWith(tmp + path.sep)) return false;
    return real.slice(tmp.length + 1).split(path.sep)[0].startsWith('claude-');
  });
}

/**
 * A page is created only for a real project: a git repository that is neither
 * the home directory, nor Claude Code's own folder, nor a session scratchpad.
 * Judged on the repository root, so a worktree stored under `~/.claude` still
 * belongs to its project.
 */
function canHavePage(cwd) {
  if (!cwd) return { ok: false, why: 'aucun dossier de travail' };
  const root = gitRoot(cwd);
  const real = realOr(root || cwd);
  const home = realOr(os.homedir());
  if (real === home) return { ok: false, why: 'dossier personnel' };
  if (inside(real, path.join(home, '.claude'))) return { ok: false, why: 'dossier interne de Claude Code' };
  if (isScratchpad(real)) return { ok: false, why: 'dossier temporaire de session' };
  if (!root) return { ok: false, why: 'hors dépôt git' };
  return { ok: true, why: '' };
}

module.exports = { declaredPaths, projectPages, candidatePages, findPage, canHavePage, realOr };
