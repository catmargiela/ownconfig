'use strict';
/**
 * Python engine: the vendored token-saver processors (vendor/token-saver/),
 * reached through ts_adapter.py.
 *
 *   compressWithPython(cmd, nodeProcessor, raw, exitCode)
 *     -> { stdout, stderr, name: 'ts:<processor>', engine: 'python', redacted } | null
 *
 * The interpreter is NEVER looked up on PATH: a `python3` shim put first in
 * PATH by direnv, mise or a virtualenv would otherwise run with no Bash
 * permission prompt. Candidates, in order: CCX_PYTHON (only an absolute path
 * to an existing executable file), then /opt/homebrew/bin/python3,
 * /usr/local/bin/python3, /usr/bin/python3. A candidate the adapter rejects as
 * too old (< 3.10, e.g. macOS /usr/bin/python3 3.9) passes to the next one.
 * CCX_PYTHON comes from Claude Code's own environment: whatever sets it (a
 * direnv .envrc loaded before launch) could already change the hooks' PATH,
 * so it is trusted at that level and documented as "set it in your profile".
 * It runs isolated (`-I -B`), from `/`, with PATH fixed to the system
 * directories and a HOME that does not exist: no user config, no user
 * processors, no bytecode, nothing written. 5 s timeout, 8 MB input cap.
 * Anything unexpected — no interpreter, crash, timeout, malformed answer —
 * returns null and the caller falls back to the Node engine.
 *
 * The answer is untrusted: only its two text fields are used, and the
 * critical-line recovery of the Node engine runs on top of them, so an error
 * line dropped by an upstream processor still comes back. The exit code is
 * never read from the answer.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { recover } = require('./engine');
const { stripAnsi, resolveCR } = require('./text');
const processors = require('./processors');

const ADAPTER = path.join(__dirname, 'ts_adapter.py');
const TIMEOUT_MS = 5000;
const MAX_INPUT = 8 * 1024 * 1024;
const MODES = ['auto', 'node', 'python'];
const SYSTEM_PYTHONS = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const TOO_OLD = /^RuntimeError: python >= \d+\.\d+ required/;

function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Absolute interpreter paths to try, in order. PATH is never consulted. */
function pythonCandidates(env = process.env) {
  const own = String(env.CCX_PYTHON || '');
  const list = path.isAbsolute(own) && isExecutableFile(own) ? [own] : [];
  for (const p of SYSTEM_PYTHONS) if (!list.includes(p) && isExecutableFile(p)) list.push(p);
  return list;
}

/** CCX_COMPRESS_ENGINE: auto (python, then node), node, python. */
function engineMode() {
  const v = String(process.env.CCX_COMPRESS_ENGINE || '').trim().toLowerCase();
  return MODES.includes(v) ? v : 'auto';
}

function adapterEnv() {
  return {
    PATH: SYSTEM_PATH,
    HOME: path.join(os.tmpdir(), 'ccx-ts-nohome'),
    LANG: 'C.UTF-8',
  };
}

/** One interpreter: { answer } | { tooOld: true } | null. */
function runWith(python, input) {
  const r = spawnSync(python, ['-I', '-B', ADAPTER], {
    input, encoding: 'utf8', timeout: TIMEOUT_MS, killSignal: 'SIGKILL', cwd: '/',
    maxBuffer: 4 * MAX_INPUT, env: adapterEnv(), stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (r.error || r.status !== 0 || !r.stdout) return null;
  let answer;
  try { answer = JSON.parse(r.stdout); } catch { return null; }
  if (answer && answer.ok === false && TOO_OLD.test(String(answer.error || ''))) return { tooOld: true };
  if (!answer || answer.ok !== true) return null;
  if (typeof answer.stdout !== 'string' || typeof answer.stderr !== 'string') return null;
  return { answer };
}

/**
 * Raw adapter answer, or null. Only a "too old" refusal moves on to the next
 * candidate; a crash or a timeout stops here (never 3 × 5 s).
 */
function runAdapter(request, candidates = pythonCandidates()) {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_INPUT) return null;
  for (const python of candidates) {
    const r = runWith(python, input);
    if (!r) return null;
    if (r.answer) return r.answer;
  }
  return null;
}

/** Error lines of the raw stream missing from the Python result, put back. */
function secure(raw, out, exitCode, nodeProcessor) {
  if (!raw.trim() || out === raw) return raw;
  const proc = processors.byName[nodeProcessor] || processors.byName.generic;
  let text = out;
  if (exitCode !== 0 || proc.recoverOnSuccess !== false) text = recover(resolveCR(stripAnsi(raw)), text);
  text = text.replace(/\n+$/, '');
  return raw.endsWith('\n') ? `${text}\n` : text;
}

function processorName(answer) {
  const name = String(answer.processor || 'none');
  return /^[A-Za-z0-9_-]{1,40}$/.test(name) ? name : 'unknown';
}

/**
 * @param {string} label  command as the policy parsed it (words joined), used for routing only
 * @param {string} nodeProcessor  processor chosen by policy.js (decides success-time recovery)
 * @param {{stdout: string, stderr: string}} raw
 */
function compressWithPython(label, nodeProcessor, raw, exitCode) {
  const answer = runAdapter({ command: label, exit_code: exitCode, stdout: raw.stdout, stderr: raw.stderr });
  if (!answer) return null;
  const redacted = answer.redacted === true;
  // After redaction the raw text is off limits: recovery would put secrets back.
  const pick = (s) => (redacted ? answer[s] : secure(raw[s], answer[s], exitCode, nodeProcessor));
  return { stdout: pick('stdout'), stderr: pick('stderr'), name: `ts:${processorName(answer)}`, engine: 'python', redacted };
}

module.exports = { compressWithPython, engineMode, runAdapter, pythonCandidates, ADAPTER, TIMEOUT_MS, SYSTEM_PYTHONS };
