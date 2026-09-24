'use strict';
/** Shared helpers. Hooks must NEVER crash a tool call: everything defaults to allow. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STATE_DIR = path.join(os.homedir(), '.claude', 'state', 'ccx');

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

/** Resolve the active rigour profile. Invalid values fall back to `standard`. */
function profile() {
  const raw = String(process.env.CC_PROFILE || 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

/** A hook runs when the active profile is listed in `profiles`. */
function enabled(profiles) {
  if (process.env.CCX_DISABLED === '1') return false;
  return profiles.includes(profile());
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

function statePath(sessionId, name) {
  const safe = String(sessionId || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'nosession';
  ensureDir(STATE_DIR);
  return path.join(STATE_DIR, `${safe}.${name}.json`);
}

function readState(sessionId, name, fallback) {
  try { return JSON.parse(fs.readFileSync(statePath(sessionId, name), 'utf8')); }
  catch { return fallback; }
}

/** Atomic write: a half-written state file must never be read back as truth. */
function writeState(sessionId, name, value) {
  const target = statePath(sessionId, name);
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, target);
  } catch { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

/** Block the tool call and hand `reason` back to Claude. */
function deny(reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}

/**
 * Non-blocking warnings. Several modules share one process, and stdout must hold
 * a single JSON object: modules only buffer here, the dispatcher flushes once.
 */
const warnings = [];

function warn(msg) {
  if (msg && !warnings.includes(msg)) warnings.push(msg);
}

/**
 * Tool-input rewrite requested by a module (PreToolUse only). Patches layer on
 * top of each other. Never paired with a permission decision: the rewritten
 * input still goes through the normal permission flow.
 */
let updatedInput = null;

function updateInput(patch) {
  if (patch && typeof patch === 'object') updatedInput = { ...(updatedInput || {}), ...patch };
}

/**
 * Emit buffered warnings and any input rewrite as ONE hook JSON on stdout:
 * `systemMessage` for the user, `additionalContext` for the model
 * (PreToolUse / PostToolUse / UserPromptSubmit), `updatedInput` (PreToolUse only).
 * No `permissionDecision` key, ever.
 */
function flushOutput(hookEventName) {
  const rewrite = hookEventName === 'PreToolUse' ? updatedInput : null;
  if (!warnings.length && !rewrite) return;
  const text = warnings.join('\n\n');
  const out = {};
  if (text) out.systemMessage = text;
  if (['PreToolUse', 'PostToolUse', 'UserPromptSubmit'].includes(hookEventName)) {
    const specific = { hookEventName };
    if (text) specific.additionalContext = text;
    if (rewrite) specific.updatedInput = rewrite;
    out.hookSpecificOutput = specific;
  }
  process.stdout.write(JSON.stringify(out) + '\n');
  warnings.length = 0;
  updatedInput = null;
}

/** Text an Edit / Write / MultiEdit call is about to put on disk. */
function newTexts(toolInput) {
  const ti = toolInput || {};
  const out = [];
  if (typeof ti.content === 'string') out.push(ti.content);
  if (typeof ti.new_string === 'string') out.push(ti.new_string);
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) if (e && typeof e.new_string === 'string') out.push(e.new_string);
  }
  return out;
}

/** Walk up from `start` looking for a file, stopping at the filesystem root. */
function findUp(start, names) {
  let dir = start;
  for (let i = 0; i < 30 && dir; i++) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) return { dir, file: p, name: n };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Main working tree behind a `.git` FILE (linked worktree, e.g. `.claude/worktrees/x`).
 * `gitdir:` points at `<main>/.git/worktrees/<name>`, whose `commondir` leads back
 * to `<main>/.git`. Anything else (submodule, bare repo) keeps its own directory.
 */
function worktreeMain(dir, dotGit) {
  const m = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
  if (!m) return dir;
  const gitdir = path.resolve(dir, m[1].trim());
  let common = null;
  try {
    common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
  } catch {
    const parts = gitdir.split(path.sep);
    const w = parts.lastIndexOf('worktrees');
    if (w > 0) common = parts.slice(0, w).join(path.sep);
  }
  return common && path.basename(common) === '.git' ? path.dirname(common) : dir;
}

/**
 * Root of the git repository containing `start`, worktrees resolved to the main
 * repository. Pure filesystem walk (no `git` process). A repository at the home
 * directory itself (dotfiles) is ignored: it would swallow every project.
 */
function gitRoot(start) {
  if (!start) return null;
  try {
    const found = findUp(start, ['.git']);
    if (!found || found.dir === os.homedir()) return null;
    return fs.statSync(found.file).isFile() ? worktreeMain(found.dir, found.file) : found.dir;
  } catch { return null; }
}

/** Run a command with a hard timeout. Returns {ok, out} and never throws. */
function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeout || 20000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...(opts.env || {}), CCX_DISABLED: '1' },
    });
    return { ok: true, out: out || '' };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/** Never leak an absolute home path into a message shown to the model. */
function tilde(p) {
  if (!p) return '';
  const home = os.homedir();
  return p.startsWith(home) ? p.replace(home, '~') : p;
}

module.exports = {
  profile, enabled, readState, writeState, deny, warn, updateInput, flushOutput,
  flushWarnings: flushOutput, newTexts,
  findUp, gitRoot, run, tilde, ensureDir, STATE_DIR,
};
