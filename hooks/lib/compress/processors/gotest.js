'use strict';
/**
 * go test. Passing noise is counted, never shown: `=== RUN/PAUSE/CONT`,
 * `--- PASS`, `ok  pkg`, `?  pkg [no test files]`, bare `PASS`, and the log
 * lines a passing test printed under `-v`. Everything else stays — every
 * `--- FAIL` block, panics, build errors, `FAIL` summaries, unknown lines.
 */
const { isCritical, collapseBlank, plural } = require('../text');

const RUN = /^\s*=== (RUN|PAUSE|CONT|NAME)\s/;
const PASS = /^\s*--- PASS: /;
const SKIP = /^\s*--- SKIP: /;
const FAIL = /^\s*--- FAIL: /;
const OK_PKG = /^ok\s+\S+\s+(\(cached\)|[\d.]+s)(\s+coverage: [\d.]+% of statements.*)?$/;
const NO_TESTS = /^\?\s+\S+\s+\[no test files\]$/;

function summary(pkgs, tests, skipped) {
  const parts = [];
  if (pkgs) parts.push(`${plural(pkgs, 'paquet')} ok`);
  if (tests) parts.push(`${plural(tests, 'test')} ${tests > 1 ? 'passés' : 'passé'}`);
  if (skipped) parts.push(`${skipped} ignoré${skipped > 1 ? 's' : ''}`);
  return parts.length ? [`[ccx: ${parts.join(', ')}]`] : [];
}

function condense(text) {
  const out = [];
  let buffer = [];
  let pkgs = 0, tests = 0, skipped = 0;
  const flush = () => { out.push(...buffer); buffer = []; };
  for (const line of text.split('\n')) {
    if (RUN.test(line)) { flush(); continue; }
    // A failure keeps what was printed before it (the test's own log under -v).
    if (FAIL.test(line)) { flush(); out.push(line); continue; }
    if (PASS.test(line)) {
      tests++;
      // Output of a test that passed is noise — unless it looks like an error.
      out.push(...buffer.filter(isCritical));
      buffer = [];
      continue;
    }
    const ok = OK_PKG.exec(line);
    if (ok) { pkgs++; flush(); if (ok[2]) out.push(line); continue; }
    if (NO_TESTS.test(line) || line.trim() === 'PASS') continue;
    if (SKIP.test(line)) { skipped++; flush(); out.push(line); continue; }
    buffer.push(line);
  }
  flush();
  return [...summary(pkgs, tests, skipped), ...collapseBlank(out)].join('\n');
}

module.exports = {
  name: 'gotest',
  match: (cmd) => /^\s*go\s+test\b/.test(cmd),
  handlesFailure: true,
  process: condense,
};
