'use strict';
/**
 * Engine selection for wrap.js.
 *
 *   bestResult(cmd, processor, raw, exitCode, before)
 *     -> { stdout, stderr, name, engine, redacted, after } | null
 *
 * CCX_COMPRESS_ENGINE=auto (default): a command with a dedicated Node
 * processor (git, go test, next build, eslint, docker, ls/find, rg, gh…)
 * stays on the Node engine, whose output contracts are tested in
 * tests/compress/; any other command (policy processor `generic`: kubectl,
 * terraform, mvn, npm ci…) goes to the token-saver processors first, then to
 * Node. `node` / `python`: that engine only. A result is accepted only if it
 * saves at least MIN_SAVING (or if it redacted secrets); otherwise the next
 * engine is tried, then the raw output is printed.
 */
const { parse } = require('./policy');
const { compress } = require('./engine');
const { compressWithPython, engineMode } = require('./python');

const MIN_SAVING = 0.2;

/** Node engine, stream by stream: { stdout, stderr, name: 'node:<processor>', engine }. */
function compressWithNode(cmd, processor, raw, exitCode) {
  const out = {};
  let name = processor;
  for (const stream of ['stdout', 'stderr']) {
    const r = compress(cmd, raw[stream], { exitCode, stream, processor });
    out[stream] = r.text;
    if (r.changed) name = r.processor;
  }
  return { ...out, name: `node:${name}`, engine: 'node', redacted: false };
}

/** Engines to try, in order (see the header). */
function engineOrder(processor) {
  const mode = engineMode();
  if (mode !== 'auto') return [mode];
  return processor === 'generic' ? ['python', 'node'] : ['node'];
}

/** First engine whose result saves at least MIN_SAVING (or redacted secrets), else null. */
function bestResult(cmd, processor, raw, exitCode, before) {
  const label = (parse(cmd) || []).join(' ') || cmd;
  const run = {
    python: () => compressWithPython(label, processor, raw, exitCode),
    node: () => compressWithNode(cmd, processor, raw, exitCode),
  };
  for (const attempt of engineOrder(processor).map((e) => run[e])) {
    let r = null;
    try { r = attempt(); } catch { r = null; }
    if (!r) continue;
    const after = r.stdout.length + r.stderr.length;
    if (r.redacted || after <= before * (1 - MIN_SAVING)) return { ...r, after };
  }
  return null;
}

module.exports = { bestResult, engineOrder, compressWithNode, MIN_SAVING };
