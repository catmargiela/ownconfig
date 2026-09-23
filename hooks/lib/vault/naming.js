'use strict';
/**
 * Project identity and page locations.
 *
 * A project is a git repository: its name comes from the repository root found
 * by walking up from `cwd` (worktrees resolve to the main repository). A page
 * that declares `chemin:` is found by that path first, so a page renamed by hand
 * never becomes an orphan.
 */
const fs = require('fs');
const path = require('path');
const { gitRoot, findUp } = require('../util');
const { DIRS, read } = require('./store');

const GENERIC_BASE = new Set([
  'www', 'app', 'apps', 'src', 'web', 'site', 'client', 'server', 'frontend',
  'backend', 'api', 'front', 'back', 'core', 'main', 'code', 'dev', 'projet',
  'project', 'repo', 'work',
]);
const CONTAINERS = new Set([
  'documents', 'desktop', 'downloads', 'users', 'home', 'dev', 'code',
  'projects', 'projets', 'repos', 'git', 'workspace', 'sites',
]);

/** Folder identifying the project: git root (worktrees → main repo), else `cwd`. */
function projectDir(cwd) {
  if (!cwd) return cwd;
  return gitRoot(cwd) || cwd;
}

/**
 * Readable, discriminating page name: a short or generic basename is prefixed by
 * its parent folder, unless that parent is a mere container (`Documents`…).
 */
function projectName(cwd) {
  if (!cwd) return 'Sans projet';
  const parts = projectDir(cwd).split(path.sep).filter(Boolean);
  const base = parts[parts.length - 1] || 'projet';
  const parent = parts[parts.length - 2];
  const ambiguous = GENERIC_BASE.has(base.toLowerCase()) || base.length <= 4;
  const usable = parent && !CONTAINERS.has(parent.toLowerCase());
  const name = ambiguous && usable ? `${parent}-${base}` : base;
  return name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
}

const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

function projectFile(name) { return path.join(DIRS.projets, `${name}.md`); }

/** A page declaring exactly `cwd` wins; otherwise the one declaring the git root. */
function resolveProjectFile(cwd) {
  if (!cwd) return projectFile(projectName(cwd));
  const target = realOr(cwd);
  const root = projectDir(cwd);
  const rootReal = realOr(root);
  let byRoot = null;
  try {
    for (const f of fs.readdirSync(DIRS.projets)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(DIRS.projets, f);
      const m = read(full).match(/^chemin:\s*(.+)$/m);
      if (!m) continue;
      const declared = m[1].trim().replace(/^["']|["']$/g, '');
      if (!declared) continue;
      const real = realOr(declared);
      if (real === target || declared === cwd) return full;
      if (!byRoot && (real === rootReal || declared === root)) byRoot = full;
    }
  } catch { /* no Projets folder */ }
  return byRoot || projectFile(projectName(cwd));
}

// Journal file names keep their historical UTC date; times shown are local.
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toTimeString().slice(0, 5);

/** Local HH:MM of an ISO timestamp, or of now when absent/invalid. */
function hhmm(ts) {
  const d = ts ? new Date(ts) : new Date();
  return Number.isNaN(d.getTime()) ? now() : d.toTimeString().slice(0, 5);
}

function journalFile(name) { return path.join(DIRS.journal, `${today()} — ${name}.md`); }

/** Current branch read from the git HEAD file — no git process. */
function currentBranch(cwd) {
  try {
    const found = cwd && findUp(cwd, ['.git']);
    if (!found) return '';
    let gitDir = found.file;
    if (fs.statSync(gitDir).isFile()) {
      const m = fs.readFileSync(gitDir, 'utf8').match(/^gitdir:\s*(.+)$/m);
      if (!m) return '';
      gitDir = path.resolve(found.dir, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return ref ? ref[1] : head.slice(0, 7);
  } catch { return ''; }
}

/**
 * GitHub `owner/repo` of the `origin` remote, read from the repository config.
 * Anything that is not github.com gives null: commits are then shown as plain hashes.
 */
function githubRepo(root) {
  if (!root) return null;
  const cfg = read(path.join(root, '.git', 'config'));
  const section = cfg.split(/^\[/m).find((s) => /^remote\s+"origin"\]/.test(s));
  const url = section && (section.match(/^\s*url\s*=\s*(.+)$/m) || [])[1];
  if (!url) return null;
  const m = url.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

module.exports = {
  projectDir, projectName, projectFile, resolveProjectFile, journalFile,
  today, now, hhmm, realOr, currentBranch, githubRepo,
};
