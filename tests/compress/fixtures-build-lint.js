'use strict';
/** Quality fixtures — builds and linters. */
const { range, word } = require('./gen');

const nextBuild = [
  '> web@0.1.0 build',
  '> next build',
  '',
  '   ▲ Next.js 15.1.3',
  '   - Environments: .env.local',
  '',
  '   Creating an optimized production build ...',
  ...range(14).flatMap((i) => [
    ` ⚠ ./src/app/${word(i)}/page.tsx`,
    `   ${10 + i}:7  Warning: 'unused${i}' is assigned a value but never used.  @typescript-eslint/no-unused-vars`,
    '',
  ]),
  ' ✓ Compiled successfully',
  '   Linting and checking validity of types ...',
  '   Collecting page data ...',
  ...range(40).map((i) => `   Generating static pages (${i}/40) `),
  ' ✓ Generating static pages (40/40)',
  '   Finalizing page optimization ...',
  '   Collecting build traces ...',
  '',
  'Route (app)                              Size     First Load JS',
  '┌ ○ /                                    5.2 kB          110 kB',
  ...range(12).map((i) => `├ ƒ /${word(i)}                          ${i + 1}.4 kB          ${100 + i} kB`),
  '└ ○ /settings                            2.1 kB          104 kB',
  '+ First Load JS shared by all            102 kB',
  '  ├ chunks/1517-3a1f0c.js                46.1 kB',
  '  └ other shared chunks (total)          1.9 kB',
  '',
  '○  (Static)   prerendered as static content',
  'ƒ  (Dynamic)  server-rendered on demand',
].join('\n');

const cargoFail = [
  ...range(90).map((i) => `   Compiling ${word(i)}-${i} v0.${i % 9}.${i % 5}`),
  'error[E0308]: mismatched types',
  '  --> src/billing/invoice.rs:42:20',
  '   |',
  '42 |     let total: u32 = subtotal * rate;',
  '   |                ---   ^^^^^^^^^^^^^^^ expected `u32`, found `f64`',
  '   |                |',
  '   |                expected due to this',
  '',
  ...range(30).map((i) => `   Compiling ${word(i + 7)}-late-${i} v1.${i % 4}.0`),
  'For more information about this error, try `rustc --explain E0308`.',
  "error: could not compile `billing` (lib) due to 1 previous error",
].join('\n');

const eslint = [
  ...range(14).flatMap((f) => [
    `/src/app/src/${word(f)}/${word(f + 3)}.ts`,
    ...range(5).map((i) => {
      const rules = ['@typescript-eslint/no-unused-vars', 'no-console', 'prefer-const', 'react-hooks/exhaustive-deps'];
      return `  ${10 + i * 3}:${5 + i}  warning  Rule message number ${i} for ${word(f)}  ${rules[(f + i) % 4]}`;
    }),
    '',
  ]),
  '/src/app/src/session/token.ts',
  "  7:3  error  'refreshToken' is not defined  no-undef",
  '',
  '✖ 71 problems (1 error, 70 warnings)',
  '  0 errors and 12 warnings potentially fixable with the `--fix` option.',
].join('\n');

const golangci = [
  ...range(40).flatMap((i) => [
    `internal/${word(i)}/${word(i + 1)}.go:${20 + i}:${2 + (i % 5)}: ${['Error return value of `f.Close` is not checked',
      'ineffectual assignment to err', 'S1002: should omit comparison to bool constant'][i % 3]} (${['errcheck', 'ineffassign', 'gosimple'][i % 3]})`,
    '\tdefer f.Close()',
    '\t^',
  ]),
  '40 issues:',
  '* errcheck: 14',
  '* gosimple: 13',
  '* ineffassign: 13',
].join('\n');

const clippy = [
  '    Checking app v0.1.0 (/src/app)',
  ...range(24).flatMap((i) => [
    `warning: ${['this `if` has identical blocks', 'redundant clone', 'use of `unwrap()`'][i % 3]}`,
    `  --> src/${word(i)}.rs:${10 + i}:9`,
    '   |',
    `${10 + i} |         let v = value.clone();`,
    '   |                 ^^^^^^^^^^^^^ help: remove this',
    '   |',
    `   = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#${['if_same_then_else', 'redundant_clone', 'unwrap_used'][i % 3]}`,
    '',
  ]),
  'warning: `app` (lib) generated 24 warnings',
  '    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.21s',
].join('\n');

module.exports = [
  { name: 'next build success', cmd: 'npm run build', input: nextBuild, exitCode: 0,
    mustPreserve: ['Route (app)', '┌ ○ /', '└ ○ /settings', '+ First Load JS shared by all', 'Next.js 15.1.3'], minSavingsPercent: 35 },
  { name: 'cargo build error buried', cmd: 'cargo build', input: cargoFail, exitCode: 101,
    mustPreserve: ['error[E0308]: mismatched types', '--> src/billing/invoice.rs:42:20', 'expected `u32`, found `f64`',
      'could not compile `billing`'], minSavingsPercent: 60 },
  { name: 'eslint grouped by rule', cmd: 'npx eslint .', input: eslint, exitCode: 1,
    mustPreserve: ["'refreshToken' is not defined", '✖ 71 problems (1 error, 70 warnings)', 'no-console', 'prefer-const'],
    minSavingsPercent: 50 },
  { name: 'golangci-lint grouped', cmd: 'golangci-lint run', input: golangci, exitCode: 1,
    mustPreserve: ['errcheck', 'ineffassign', 'gosimple', '40 issues:'], minSavingsPercent: 50 },
  { name: 'clippy grouped', cmd: 'cargo clippy', input: clippy, exitCode: 0,
    mustPreserve: ['redundant clone', 'unwrap_used', 'generated 24 warnings', 'Finished'], minSavingsPercent: 60 },
];
