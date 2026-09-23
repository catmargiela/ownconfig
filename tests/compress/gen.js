'use strict';
/** Deterministic generators for compression fixtures. No real data anywhere. */

/** Pseudo-random hex, stable across runs. */
function hex(seed, len = 40) {
  let x = (seed * 2654435761) >>> 0;
  let out = '';
  while (out.length < len) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += x.toString(16).padStart(8, '0');
  }
  return out.slice(0, len);
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

const WORDS = ['parser', 'router', 'session', 'cache', 'invoice', 'report', 'search', 'upload',
  'profile', 'billing', 'metrics', 'config', 'worker', 'queue', 'token', 'schema'];
const word = (i) => WORDS[i % WORDS.length];

module.exports = { hex, range, word, WORDS };
