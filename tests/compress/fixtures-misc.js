'use strict';
/** Quality fixtures — docker, listings, search, gh, generic fallback. */
const { hex, range, word } = require('./gen');

const pad = (s, n) => String(s).padEnd(n);
const dockerPs = [
  `${pad('CONTAINER ID', 15)}${pad('IMAGE', 26)}${pad('COMMAND', 25)}${pad('CREATED', 16)}${pad('STATUS', 22)}${pad('PORTS', 26)}NAMES`,
  ...range(30).map((i) => `${pad(hex(i, 12), 15)}${pad(`example/${word(i)}:1.${i}`, 26)}${pad('"docker-entrypoint.s…"', 25)}` +
    `${pad(`${i + 2} hours ago`, 16)}${pad(`Up ${i + 1} hours`, 22)}${pad(`0.0.0.0:${3000 + i}->3000/tcp`, 26)}${word(i)}-${i}`),
].join('\n');

const dockerBuild = [
  '#0 building with "default" instance using docker driver',
  '#1 [internal] load build definition from Dockerfile',
  '#1 transferring dockerfile: 612B done',
  '#1 DONE 0.0s',
  ...range(6).flatMap((s) => [
    `#${s + 5} [${s + 1}/6] RUN step number ${s + 1}`,
    ...range(30).map((i) => `#${s + 5} ${(i * 0.37).toFixed(3)} npm info progress line ${i} for ${word(i)}`),
    s === 3 ? `#${s + 5} 9.912 npm ERR! code ERESOLVE` : `#${s + 5} DONE ${s + 2}.1s`,
  ]),
  '------',
  ' > [4/6] RUN step number 4:',
  '9.912 npm ERR! code ERESOLVE',
  '------',
  'ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
].join('\n');

const composeLogs = [
  ...range(200).map((i) => `api-1  | 2026-03-01T10:${String(i % 60).padStart(2, '0')}:00Z info request id=${hex(i, 8)} path=/${word(i)} status=200`),
  'api-1  | 2026-03-01T10:31:07Z error TypeError: Cannot read properties of undefined (reading \'id\')',
  'api-1  |     at handler (/app/src/routes/invoice.js:42:17)',
  'api-1  |     at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
  ...range(200).map((i) => `api-1  | 2026-03-01T11:${String(i % 60).padStart(2, '0')}:00Z info request id=${hex(i + 500, 8)} path=/${word(i)} status=200`),
].join('\n');

const findOut = range(320).map((i) => `./src/${word(i % 7)}/${word(i)}-${i}.${['ts', 'tsx', 'json', 'md'][i % 4]}`).join('\n');

const lsLong = ['total 1824', ...range(110).map((i) =>
  `-rw-r--r--   1 dev  staff  ${1000 + i * 37} Mar  1 10:${String(i % 60).padStart(2, '0')} ${word(i)}-${i}.${['ts', 'go', 'md'][i % 3]}`)].join('\n');

const treeOut = ['.', ...range(8).flatMap((d) => [
  `├── ${word(d)}`,
  ...range(4).flatMap((s) => [`│   ├── ${word(s + d)}-sub`,
    ...range(6).map((f) => `│   │   ${f === 5 ? '└──' : '├──'} file-${f}.ts`)]),
]), '└── README.md', '', '41 directories, 193 files'].join('\n');

const rgOut = range(360).map((i) => `src/${word(i % 20)}/${word(i % 20 + 1)}.ts:${10 + i}:  const value${i} = fetchConfig("${word(i)}");`).join('\n');

const ghChecks = [
  ...range(30).map((i) => `${word(i)}-check-${i}\tpass\t${i + 1}m2s\thttps://example.com/runs/${1000 + i}\t`),
  'e2e / chromium\tfail\t4m12s\thttps://example.com/runs/2001\t',
  'deploy-preview\tpending\t0\thttps://example.com/runs/2002\t',
].join('\n');

const ghList = range(120).map((i) => `${400 + i}\tfeat: ${word(i)} improvements\tfeature/${word(i)}-${i}\tOPEN\t2026-03-01T10:00:00Z`).join('\n');

const genericFail = [
  ...range(260).map((i) => `diff line ${i}: unchanged content for ${word(i)}`),
  'fatal: bad object HEAD~400',
  ...range(260).map((i) => `diff line ${i + 300}: more content for ${word(i)}`),
].join('\n');

module.exports = [
  { name: 'docker ps table', cmd: 'docker ps', input: dockerPs, exitCode: 0,
    mustPreserve: ['NAMES', 'parser-0', 'Up 1 hours', '0.0.0.0:3000->3000/tcp', 'example/parser:1.0'], minSavingsPercent: 30 },
  { name: 'docker build failure', cmd: 'docker build .', input: dockerBuild, exitCode: 1, stream: 'stderr',
    mustPreserve: ['[4/6] RUN step number 4', 'npm ERR! code ERESOLVE', 'ERROR: failed to solve'], minSavingsPercent: 60 },
  { name: 'compose logs error in the middle', cmd: 'docker compose logs api', input: composeLogs, exitCode: 0,
    mustPreserve: ["TypeError: Cannot read properties of undefined (reading 'id')", 'at handler (/app/src/routes/invoice.js:42:17)'],
    minSavingsPercent: 70 },
  { name: 'find grouped', cmd: 'find . -type f', input: findOut, exitCode: 0,
    mustPreserve: ['parser-0.ts', 'router-1.tsx'], minSavingsPercent: 50 },
  { name: 'ls -l grouped', cmd: 'ls -la', input: lsLong, exitCode: 0,
    mustPreserve: ['parser-0.ts', 'router-1.go'], minSavingsPercent: 50 },
  { name: 'tree depth limited', cmd: 'tree', input: treeOut, exitCode: 0,
    mustPreserve: ['├── parser', '│   ├── parser-sub', 'README.md', '41 directories, 193 files'], minSavingsPercent: 50 },
  { name: 'rg grouped per file', cmd: 'rg fetchConfig', input: rgOut, exitCode: 0,
    mustPreserve: ['src/parser/router.ts', 'const value0 = fetchConfig("parser");'], minSavingsPercent: 50 },
  { name: 'gh pr checks with failure', cmd: 'gh pr checks', input: ghChecks, exitCode: 1,
    mustPreserve: ['e2e / chromium\tfail', 'deploy-preview\tpending'], minSavingsPercent: 70 },
  { name: 'gh pr list truncated', cmd: 'gh pr list', input: ghList, exitCode: 0,
    mustPreserve: ['400\tfeat: parser improvements'], minSavingsPercent: 50 },
  { name: 'generic fallback on failure, error in the middle', cmd: 'git log', input: genericFail, exitCode: 128,
    mustPreserve: ['fatal: bad object HEAD~400', 'diff line 0:', 'diff line 559:'], minSavingsPercent: 50 },
];
