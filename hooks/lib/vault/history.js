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
// The vault is a work tree anyone syncing or importing notes can write to: no
// user configuration is read, so a `.gitattributes` there finds no filter to run.
const IDENTITY = ['-c', 'user.name=ccx vault', '-c', 'user.email=vault@localhost', '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.quotepath=false',
  '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null'];
const BACKOFF_MS = 10 * 60 * 1000;
const backoffFile = () => `${GIT_DIR}.backoff`;

/** Environment without any inherited GIT_* variable (GIT_DIR, GIT_CONFIG_COUNT…). */
function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
}

/** A git call timed out lately: the vault is too big or the disk too slow to pay that at every Stop. */
function backingOff() {
  try { return Date.now() - fs.statSync(backoffFile()).mtimeMs < BACKOFF_MS; } catch { return false; }
}

function active() {
  if (String(process.env.CC_VAULT_HISTORY || '').trim().toLowerCase() === 'off') return false;
  if (!store.enabled() || backingOff()) return false;
  // A link would make git record whatever folder it points to.
  try { return fs.lstatSync(store.ROOT).isDirectory(); } catch { return false; }
}

function git(args, opts = {}) {
  return execFileSync('git', [...IDENTITY, `--git-dir=${GIT_DIR}`, `--work-tree=${store.ROOT}`, ...args], {
    cwd: store.ROOT, encoding: 'utf8', timeout: opts.timeout || 5000, stdio: ['ignore', 'pipe', 'pipe'],
    env: gitEnv(),
  });
}

function ensureRepo() {
  if (fs.existsSync(path.join(GIT_DIR, 'HEAD'))) return;
  fs.mkdirSync(path.dirname(GIT_DIR), { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', GIT_DIR], { stdio: 'ignore', timeout: 5000, env: gitEnv() });
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
    if (err.code === 'ETIMEDOUT' || err.killed) { try { fs.writeFileSync(backoffFile(), ''); } catch { /* ignore */ } }
    store.debug(`historique : ${err.message.split('\n')[0]}`);
    return false;
  }
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

module.exports = { snapshot, summary, onStop, onCompact, GIT_DIR };
