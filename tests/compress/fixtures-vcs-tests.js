'use strict';
/**
 * Quality fixtures — git and test runners. Each fixture: cmd, input, exitCode,
 * mustPreserve (in the input AND the output), minSavingsPercent.
 */
const { hex, range, word } = require('./gen');

// ------------------------------------------------------------------ git
const gitStatus = [
  'On branch feature/search-filters',
  "Your branch is ahead of 'origin/feature/search-filters' by 2 commits.",
  '  (use "git push" to publish your local commits)',
  '',
  'Changes to be committed:',
  '  (use "git restore --staged <file>..." to unstage)',
  ...range(14).map((i) => `\tmodified:   src/components/search/${word(i)}Panel.tsx`),
  '\tnew file:   src/lib/filters/dateRange.ts',
  '',
  'Changes not staged for commit:',
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  ...range(22).map((i) => `\tmodified:   src/server/handlers/${word(i + 3)}_${i}.go`),
  '\tdeleted:    docs/legacy-filters.md',
  '',
  'Untracked files:',
  '  (use "git add <file>..." to include in what will be committed)',
  ...range(12).map((i) => `\ttests/fixtures/${word(i)}-${i}.json`),
  '',
].join('\n');

const lockHunk = range(260).map((i) => (i % 2 ? '+' : '-') +
  `      "integrity": "sha512-${hex(i, 60)}",`).join('\n');
const gitDiff = [
  'diff --git a/src/lib/filters/dateRange.ts b/src/lib/filters/dateRange.ts',
  'index 3f2a1b4..9c8d7e6 100644',
  '--- a/src/lib/filters/dateRange.ts',
  '+++ b/src/lib/filters/dateRange.ts',
  '@@ -12,7 +12,9 @@ export function parseRange(input: string): DateRange {',
  '   const [from, to] = input.split("..");',
  '-  return { from: new Date(from), to: new Date(to) };',
  '+  const start = new Date(from);',
  '+  const end = to ? new Date(to) : new Date();',
  '+  return { from: start, to: end };',
  ' }',
  ' ',
  ' export function isEmpty(range: DateRange): boolean {',
  'diff --git a/package-lock.json b/package-lock.json',
  'index 1111111..2222222 100644',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  '@@ -1,300 +1,300 @@',
  lockHunk,
  'diff --git a/src/server/search.go b/src/server/search.go',
  'index aaaaaaa..bbbbbbb 100644',
  '--- a/src/server/search.go',
  '+++ b/src/server/search.go',
  '@@ -40,6 +40,7 @@ func (s *Server) Search(w http.ResponseWriter, r *http.Request) {',
  '   q := r.URL.Query().Get("q")',
  '+  limit := parseLimit(r.URL.Query().Get("limit"))',
  '   results, err := s.index.Find(q)',
  '',
].join('\n');

const commits = range(60).map((i) => [
  `commit ${hex(i + 1)}${i === 0 ? ' (HEAD -> main, origin/main)' : ''}`,
  i % 17 === 5 ? `Merge: ${hex(i, 7)} ${hex(i + 99, 7)}` : null,
  'Author: Dev Example <dev@example.com>',
  `Date:   Mon Mar ${(i % 28) + 1} 10:${String(i % 60).padStart(2, '0')}:00 2026 +0100`,
  '',
  `    ${i % 3 ? 'feat' : 'fix'}: ${word(i)} handling for the ${word(i + 5)} module (#${100 + i})`,
  '',
  `    Longer explanation of the change to the ${word(i)} module, wrapped`,
  '    over a couple of lines as commit bodies usually are.',
  '',
].filter((l) => l !== null).join('\n')).join('\n');

// ------------------------------------------------------------------ go test
const goVerbose = (fail) => [
  ...range(120).flatMap((i) => {
    const name = `Test${word(i)[0].toUpperCase()}${word(i).slice(1)}${i}`;
    if (fail && i === 61) {
      return [`=== RUN   ${name}`, '    date_test.go:42: parseDate("2026-01-02"): got 2026-01-01, want 2026-01-02',
        `--- FAIL: ${name} (0.00s)`];
    }
    return [`=== RUN   ${name}`, `    ${word(i)}_test.go:${10 + i}: setup done`, `--- PASS: ${name} (0.0${i % 9}s)`];
  }),
  fail ? 'FAIL' : 'PASS',
  fail ? 'FAIL\texample.com/app/internal/date\t0.214s' : 'ok  \texample.com/app/internal/date\t0.214s',
  'ok  \texample.com/app/internal/search\t0.031s\tcoverage: 81.2% of statements',
  '?   \texample.com/app/cmd/server\t[no test files]',
  fail ? 'FAIL' : '',
].join('\n');

const goPanic = [
  ...range(80).flatMap((i) => [`=== RUN   TestQueue${i}`, `--- PASS: TestQueue${i} (0.00s)`]),
  '=== RUN   TestQueueDrain',
  'panic: runtime error: index out of range [3] with length 3 [recovered]',
  '',
  'goroutine 21 [running]:',
  'testing.tRunner.func1.2({0x1029c1f40, 0x14000126018})',
  '\t/usr/local/go/src/testing/testing.go:1632 +0x1bc',
  'example.com/app/internal/queue.(*Queue).Drain(...)',
  '\t/src/app/internal/queue/queue.go:88 +0x2c4',
  ...range(60).flatMap((i) => [`=== RUN   TestWorker${i}`, `--- PASS: TestWorker${i} (0.00s)`]),
  'FAIL\texample.com/app/internal/queue\t0.412s',
  'FAIL',
].join('\n');

// ------------------------------------------------------------------ js tests
const vitestFail = [
  ' RUN  v2.1.8 /src/app',
  '',
  ...range(40).map((i) => ` ✓ src/${word(i)}/${word(i + 1)}.test.ts (${(i % 7) + 2} tests) ${i + 3}ms`),
  ...range(70).map((i) => `   ✓ ${word(i)} > handles case ${i} ${i % 5}ms`),
  ' ❯ src/billing/invoice.test.ts (6 tests | 1 failed) 18ms',
  '   × invoice > applies the discount before tax 7ms',
  ...range(40).map((i) => `   ✓ ${word(i + 3)} > keeps state ${i} ${i % 4}ms`),
  '',
  '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
  '',
  ' FAIL  src/billing/invoice.test.ts > invoice > applies the discount before tax',
  'AssertionError: expected 108 to be 102 // Object.is equality',
  '',
  '- Expected',
  '+ Received',
  '',
  '- 102',
  '+ 108',
  '',
  ' ❯ src/billing/invoice.test.ts:42:27',
  '',
  ' Test Files  1 failed | 40 passed (41)',
  '      Tests  1 failed | 151 passed (152)',
  '   Duration  2.31s',
].join('\n');

const bunPass = [
  'bun test v1.2.4',
  '',
  ...range(12).flatMap((f) => [`src/${word(f)}.test.ts:`,
    ...range(14).map((i) => `(pass) ${word(f)} > case ${i} [0.${(i * 7) % 90 + 10}ms]`), '']),
  ' 168 pass',
  ' 0 fail',
  ' 402 expect() calls',
  'Ran 168 tests across 12 files. [412.00ms]',
].join('\n');

const jestFail = [
  ...range(25).map((i) => `PASS src/${word(i)}/${word(i + 2)}.test.js`),
  'FAIL src/session/token.test.js',
  '  ● token › refreshes before expiry',
  '',
  '    expect(received).toBe(expected) // Object.is equality',
  '',
  '    Expected: true',
  '    Received: false',
  '',
  '      18 |   const t = issue({ ttl: 60 });',
  '      19 |   advance(59);',
  '    > 20 |   expect(t.needsRefresh()).toBe(true);',
  '         |                            ^',
  '',
  '      at Object.toBe (src/session/token.test.js:20:28)',
  '',
  ...range(30).map((i) => `PASS src/${word(i + 4)}/more-${i}.test.js`),
  '',
  'Test Suites: 1 failed, 55 passed, 56 total',
  'Tests:       1 failed, 389 passed, 390 total',
  'Snapshots:   0 total',
  'Time:        6.412 s',
  'Ran all test suites.',
].join('\n');

module.exports = [
  { name: 'git status long', cmd: 'git status', input: gitStatus, exitCode: 0,
    mustPreserve: ['On branch feature/search-filters', 'dateRange.ts', 'legacy-filters.md', 'Untracked files'], minSavingsPercent: 25 },
  { name: 'git diff + lockfile', cmd: 'git diff', input: gitDiff, exitCode: 0,
    mustPreserve: ['+  const end = to ? new Date(to) : new Date();', '-  return { from: new Date(from), to: new Date(to) };',
      '   const [from, to] = input.split("..");', '@@ -40,6 +40,7 @@', '+  limit := parseLimit(r.URL.Query().Get("limit"))',
      'package-lock.json'], minSavingsPercent: 80 },
  { name: 'git log default', cmd: 'git log', input: commits, exitCode: 0,
    mustPreserve: [hex(1, 7), hex(60, 7), 'fix: parser handling for the report module (#100)', 'HEAD -> main'], minSavingsPercent: 60 },
  { name: 'git log -n : untouched', cmd: 'git log -n 60', input: commits, exitCode: 0,
    mustPreserve: ['Author: Dev Example', 'Longer explanation'], minSavingsPercent: 0 },
  { name: 'go test -v success', cmd: 'go test -v ./...', input: goVerbose(false), exitCode: 0,
    mustPreserve: ['coverage: 81.2% of statements'], minSavingsPercent: 85 },
  { name: 'go test failure buried in the middle', cmd: 'go test -v ./...', input: goVerbose(true), exitCode: 1,
    mustPreserve: ['--- FAIL: TestQueue61', 'date_test.go:42: parseDate("2026-01-02"): got 2026-01-01, want 2026-01-02',
      'FAIL\texample.com/app/internal/date\t0.214s'], minSavingsPercent: 80 },
  { name: 'go test panic', cmd: 'go test ./internal/queue', input: goPanic, exitCode: 2,
    mustPreserve: ['panic: runtime error: index out of range [3] with length 3', 'queue.go:88', 'FAIL\texample.com/app/internal/queue'],
    minSavingsPercent: 70 },
  { name: 'vitest failure', cmd: 'npx vitest run', input: vitestFail, exitCode: 1,
    mustPreserve: ['× invoice > applies the discount before tax', 'AssertionError: expected 108 to be 102', '- 102', '+ 108',
      'src/billing/invoice.test.ts:42:27', 'Tests  1 failed | 151 passed (152)'], minSavingsPercent: 60 },
  { name: 'bun test success', cmd: 'bun test', input: bunPass, exitCode: 0,
    mustPreserve: ['168 pass', 'Ran 168 tests across 12 files'], minSavingsPercent: 70 },
  { name: 'jest failure', cmd: 'npx jest', input: jestFail, exitCode: 1,
    mustPreserve: ['FAIL src/session/token.test.js', '● token › refreshes before expiry', 'Received: false',
      'at Object.toBe (src/session/token.test.js:20:28)', 'Tests:       1 failed, 389 passed, 390 total'], minSavingsPercent: 35 },
];
