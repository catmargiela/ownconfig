'use strict';
/**
 * Version history of the vault's `Claude/` folder.
 *
 * A bare git repository OUTSIDE the vault (`~/.claude/state/vault-history.git`)
 * with `Claude/` as its work tree: no `.git` inside the vault, so neither
 * Obsidian nor a cloud sync ever sees it. One commit per Stop and per compaction
 * when something changed — every hook write, and every hand edit made in
 * between, can be inspected and undone.
 *
 *   git --git-dir ~/.claude/state/vault-history.git --work-tree "<vault>/Claude" log -- Projets/x.md
 *
 * Local only: no remote is ever configured, nothing is pushed. User git config,
 * hooks and signing are neutralized for these commits. Off with
 * CC_VAULT_HISTORY=off or whenever the vault itself is off. Every failure is
 * silent: history never matters more than the answer.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./store');

const GIT_DIR = process.env.CC_VAULT_HISTORY_DIR
  || path.join(os.homedir(), '.claude', 'state', 'vault-history.git');
const EXCLUDE = ['.DS_Store', '*.tmp.*', '*.lock', '.trash/'];
const IDENTITY = ['-c', 'user.name=ccx vault', '-c', 'user.email=vault@localhost', '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.quotepath=false'];

function active() {
  if (String(process.env.CC_VAULT_HISTORY || '').trim().toLowerCase() === 'off') return false;
  return store.enabled() && fs.existsSync(store.ROOT);
}

function git(args, opts = {}) {
  return execFileSync('git', [...IDENTITY, `--git-dir=${GIT_DIR}`, `--work-tree=${store.ROOT}`, ...args], {
    cwd: store.ROOT, encoding: 'utf8', timeout: opts.timeout || 5000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  });
}

function ensureRepo() {
  if (fs.existsSync(path.join(GIT_DIR, 'HEAD'))) return;
  fs.mkdirSync(path.dirname(GIT_DIR), { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', GIT_DIR], { stdio: 'ignore', timeout: 5000 });
  fs.mkdirSync(path.join(GIT_DIR, 'info'), { recursive: true });
  fs.writeFileSync(path.join(GIT_DIR, 'info', 'exclude'), `${EXCLUDE.join('\n')}\n`);
}

/** Commit the current state of `Claude/` if anything changed. Returns true when a commit was made. */
function snapshot(reason, sessionId) {
  if (!active()) return false;
  try {
    ensureRepo();
    git(['add', '--all', '.']);
    const staged = git(['diff', '--cached', '--name-only']).trim();
    if (!staged) return false;
    const sid = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
    const n = staged.split('\n').length;
    git(['commit', '--quiet', '-m', `vault: ${reason}${sid ? ` ${sid}` : ''} (${n} fichier${n > 1 ? 's' : ''})`]);
    return true;
  } catch (err) {
    store.debug(`historique : ${err.message.split('\n')[0]}`);
    return false;
  }
}

/** Files of the vault changed between two dates, with their commit count: [{ file, commits }]. */
function changedBetween(since, until) {
  if (!fs.existsSync(path.join(GIT_DIR, 'HEAD'))) return [];
  try {
    const out = git(['log', `--since=${since.toISOString()}`, `--until=${until.toISOString()}`,
      '--name-only', '--pretty=format:']);
    const counts = new Map();
    for (const f of out.split('\n').map((l) => l.trim()).filter(Boolean)) counts.set(f, (counts.get(f) || 0) + 1);
    return [...counts].map(([file, commits]) => ({ file, commits })).sort((a, b) => b.commits - a.commits);
  } catch { return []; }
}

/** { commits, last } for the doctor, or null when there is no history yet. */
function summary() {
  if (!fs.existsSync(path.join(GIT_DIR, 'HEAD'))) return null;
  try {
    const commits = Number(git(['rev-list', '--count', 'HEAD']).trim()) || 0;
    const last = git(['log', '-1', '--format=%cI']).trim();
    return { commits, last };
  } catch { return { commits: 0, last: '' }; }
}

const onStop = (input) => { snapshot('fin de réponse', input && input.session_id); };
const onCompact = (input) => { snapshot('avant compaction', input && input.session_id); };

module.exports = { snapshot, changedBetween, summary, onStop, onCompact, GIT_DIR };
