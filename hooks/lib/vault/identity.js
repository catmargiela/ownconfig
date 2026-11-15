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
 * A page without `chemin:` is reached only while it bears the default name of
 * the folder (naming.js fallback). Renamed, or written under a name of its own,
 * it is never found: nothing else is guessed from a name.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRoot } = require('../util');
const { DIRS, read } = require('./store');

const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const CONTROL = /[\x00-\x1f\x7f]/;
const HEAD_BYTES = 64 * 1024;

/** One YAML scalar: quotes removed, or the trailing `# comment` of a bare value. */
function scalar(s) {
  const t = String(s).trim();
  const quote = t[0];
  if (quote !== '"' && quote !== "'") return t.replace(/(^|\s+)#.*$/, '').trim();
  const end = t.lastIndexOf(quote);
  return end > 0 ? t.slice(1, end) : t.slice(1);
}

/** A folder as written after `chemin:`; quoted when a bare value would be misread. */
const pathScalar = (p) => (/\s#|^\s|\s$|^["'\[]/.test(p) ? `"${p}"` : p);

/** Start of a file: the frontmatter is all that is needed to identify a page. */
function readHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
  } catch { return ''; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } } }
}
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
  // A page saved by a Windows editor has a BOM and CRLF line ends.
  const fm = String(raw || '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const lines = fm[1].split(/\r?\n/);
  const at = lines.findIndex((l) => /^chemin:/.test(l));
  if (at < 0) return [];
  const value = lines[at].slice('chemin:'.length).trim();
  const inline = value.match(/^\[(.*)\]\s*(?:#.*)?$/);
  const bare = scalar(value);
  const items = inline ? inline[1].split(',') : bare ? [value] : blockItems(lines, at);
  return items.map(scalar).filter(Boolean).map(expandHome);
}

let cache = null;

/** Every project page that declares at least one folder, in file-name order. */
function projectPages() {
  return cache || scanPages();
}

/** Runs `fn` with the pages read once: an audit resolves every folder of every page. */
function withPageCache(fn) {
  cache = scanPages();
  try { return fn(); } finally { cache = null; }
}

function scanPages() {
  let names = [];
  try { names = fs.readdirSync(DIRS.projets).filter((f) => f.endsWith('.md')).sort(); }
  catch { /* no Projets folder */ }
  return names
    .map((f) => {
      const file = path.join(DIRS.projets, f);
      const paths = declaredPaths(readHead(file));
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

/**
 * Does `file` declare a folder that still exists? Asked about the page bearing
 * the default name of a folder it does not declare: it is then another
 * project's page, not this one's. (All its folders gone: the project moved.)
 */
function ownedElsewhere(file) {
  return declaredPaths(readHead(file)).some((p) => fs.existsSync(p));
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
 * belongs to its project. `code` tells the cases apart for the diagnostic.
 */
function canHavePage(cwd) {
  const no = (code, why) => ({ ok: false, code, why });
  if (!cwd) return no('none', 'aucun dossier de travail');
  const root = gitRoot(cwd);
  const real = realOr(root || cwd);
  const home = realOr(os.homedir());
  // Written in the frontmatter as is: a line break there would forge a key.
  if (CONTROL.test(real)) return no('unsafe', 'nom de dossier illisible');
  if (real === home) return no('home', 'dossier personnel');
  if (inside(real, realOr(path.join(home, '.claude')))) return no('internal', 'dossier interne de Claude Code');
  if (isScratchpad(real)) return no('scratchpad', 'dossier temporaire de session');
  if (!root) return no('no-git', 'hors dépôt git');
  return { ok: true, code: 'ok', why: '' };
}

module.exports = {
  declaredPaths, pathScalar, projectPages, withPageCache, candidatePages, findPage,
  ownedElsewhere, canHavePage, realOr,
};
