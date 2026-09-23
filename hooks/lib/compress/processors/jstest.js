'use strict';
/**
 * Test runners: bun test, vitest run, jest — and cargo test, same shape.
 * Passing lines are counted and hidden; failures, assertion diffs, stack
 * traces, console output and the final summary are all kept.
 */
const { collapseBlank, collapseRepeats, plural } = require('../text');

const PASS_LINES = [
  /^\s*(✓|✔|√)\s/, // vitest, jest, bun (TTY)
  /^\s*\(pass\)\s/, // bun (non-TTY)
  /^\s*PASS\s+\S/, // jest suite header
  /^test .+ \.\.\. ok$/, // cargo test
];
const NOISE = [
  /^\s*Compiling\s+\S+\s+v\d/, // cargo build progress
  /^running 0 tests$/,
  /^test result: ok\. 0 passed; 0 failed/,
];

function condense(text) {
  let passed = 0;
  const kept = [];
  for (const line of text.split('\n')) {
    if (PASS_LINES.some((re) => re.test(line))) { passed++; continue; }
    if (NOISE.some((re) => re.test(line))) continue;
    kept.push(line);
  }
  const head = passed ? [`[ccx: ${plural(passed, 'ligne')} de réussite ${passed > 1 ? 'masquées' : 'masquée'}]`] : [];
  return [...head, ...collapseBlank(collapseRepeats(kept))].join('\n');
}

module.exports = {
  name: 'jstest',
  match: (cmd) => /^\s*(bun\s+test|(npx\s+|bunx\s+)?(vitest\s+run|jest)|cargo\s+test)\b/.test(cmd),
  handlesFailure: true,
  process: condense,
};
