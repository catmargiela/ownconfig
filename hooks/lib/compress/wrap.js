#!/usr/bin/env node
'use strict';
/**
 * Output-compression wrapper.
 *
 *   node wrap.js <base64 command>
 *
 * Runs the command in the user's shell, stdin inherited, stdout and stderr
 * captured SEPARATELY, and prints each one condensed on its own stream. The
 * exit code is the command's (a signal gives 128 + n). Rules:
 *   - small output (< 2000 chars) or saving under 20 % → raw output, unchanged;
 *   - otherwise one footer line on stdout, with the way to get the raw output;
 *   - a command that is no longer eligible runs as is, output untouched;
 *   - any internal error → raw output. Output is never lost.
 * No timeout of its own: the caller's timeout applies.
 */
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { eligible, parse } = require('./policy');
const { compress } = require('./engine');
const stats = require('./stats');

const MIN_CHARS = 2000;
const MIN_SAVING = 0.2;
const MAX_CAPTURE = 8 * 1024 * 1024;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function shell() {
  const s = process.env.SHELL;
  if (s && /\/(zsh|bash|sh|dash|ksh)$/.test(s) && fs.existsSync(s)) return s;
  return fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh';
}

function exitCodeOf(code, signal) {
  if (signal) return 128 + (os.constants.signals[signal] || 0);
  return code == null ? 1 : code;
}

/** Signals received by the wrapper go to the command; the wrapper waits for it. */
function forward(child) {
  for (const sig of SIGNALS) process.on(sig, () => { try { child.kill(sig); } catch { /* gone */ } });
}

function decode(arg) {
  if (!arg || !/^[A-Za-z0-9+/]+={0,2}$/.test(arg)) return null;
  const cmd = Buffer.from(arg, 'base64').toString('utf8');
  return cmd.trim() ? cmd : null;
}

function passthrough(cmd) {
  const child = spawn(shell(), ['-c', cmd], { stdio: 'inherit' });
  forward(child);
  child.on('error', () => { process.exitCode = 127; });
  child.on('close', (code, signal) => { process.exitCode = exitCodeOf(code, signal); });
}

/** Valid UTF-8 text without NUL bytes: anything else is written back byte for byte. */
function asText(buf) {
  if (buf.includes(0)) return null;
  const s = buf.toString('utf8');
  return Buffer.byteLength(s) === buf.length && !s.includes('\uFFFD') ? s : null;
}

function footer(cmd, before, after, name) {
  return `[ccx: sortie compressée ${before}→${after} car. (${name}) — CCX_RAW=1 ${cmd.trim()} pour la sortie brute]\n`;
}

/** Compressed { stdout, stderr, before, after, processor }, or null for "print raw". */
function condense(cmd, processor, bufs, exitCode) {
  const raw = { stdout: asText(bufs.stdout), stderr: asText(bufs.stderr) };
  if (raw.stdout === null || raw.stderr === null) return null;
  const before = raw.stdout.length + raw.stderr.length;
  if (before < MIN_CHARS) return { before, after: before, processor, skipped: true };
  const out = {};
  let name = processor;
  for (const stream of ['stdout', 'stderr']) {
    const r = compress(cmd, raw[stream], { exitCode, stream, processor });
    out[stream] = r.text;
    if (r.changed) name = r.processor;
  }
  const after = out.stdout.length + out.stderr.length;
  if (after > before * (1 - MIN_SAVING)) return { before, after: before, processor: name, skipped: true };
  const sep = out.stdout && !out.stdout.endsWith('\n') ? '\n' : '';
  out.stdout += sep + footer(cmd, before, after, name);
  return { ...out, before, after, processor: name };
}

function finish(cmd, processor, bufs, exitCode) {
  let result = null;
  try { result = condense(cmd, processor, bufs, exitCode); } catch { result = null; }
  if (result && !result.skipped) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } else {
    process.stdout.write(bufs.stdout);
    process.stderr.write(bufs.stderr);
  }
  if (result) {
    stats.record({ ts: new Date().toISOString(), cmd: stats.label(parse(cmd)), processor: result.processor,
      before: result.before, after: result.after, exit: exitCode });
  }
  process.exitCode = exitCode;
}

function capture(cmd, processor) {
  const child = spawn(shell(), ['-c', cmd], { stdio: ['inherit', 'pipe', 'pipe'] });
  forward(child);
  const chunks = { stdout: [], stderr: [] };
  let size = 0;
  let overflow = false;
  const onData = (name) => (chunk) => {
    if (overflow) { process[name].write(chunk); return; }
    chunks[name].push(chunk);
    size += chunk.length;
    if (size <= MAX_CAPTURE) return;
    // Too big to hold: hand over what we have, then stream the rest untouched.
    overflow = true;
    process.stdout.write(Buffer.concat(chunks.stdout));
    process.stderr.write(Buffer.concat(chunks.stderr));
  };
  child.stdout.on('data', onData('stdout'));
  child.stderr.on('data', onData('stderr'));
  child.on('error', (err) => { process.stderr.write(`[ccx] ${err.message}\n`); process.exitCode = 127; });
  child.on('close', (code, signal) => {
    const exitCode = exitCodeOf(code, signal);
    if (overflow) { process.exitCode = exitCode; return; }
    finish(cmd, processor, { stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr) }, exitCode);
  });
}

function main() {
  const cmd = decode(process.argv[2]);
  if (!cmd) {
    process.stderr.write('[ccx] wrap.js : commande absente ou illisible (base64 attendu).\n');
    process.exitCode = 2;
    return;
  }
  let verdict = { ok: false };
  try { verdict = eligible(cmd); } catch { /* unsure → run untouched */ }
  if (!verdict.ok) return passthrough(cmd);
  return capture(cmd, verdict.processor);
}

// A reader that went away (EPIPE) must not turn into a crash trace.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
main();
