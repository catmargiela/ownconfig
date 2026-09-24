#!/usr/bin/env node
'use strict';
/**
 * Tests des gardes no-artifact-files, dev-server-guard et commit-gate.
 * Lancé par `node test.js` ; utilisable seul : `node test-guards.js`.
 *
 * Tout tourne dans un HOME, un vault et des dépôts git temporaires : rien n'est
 * écrit dans le vrai ~/.claude.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DISPATCH = path.join(__dirname, 'hooks', 'dispatch.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-grd-')));
const HOME = path.join(TMP, 'home');
const VAULT = path.join(TMP, 'vault');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(VAULT, { recursive: true });
const ENV = { ...process.env, HOME, CC_VAULT: VAULT, CC_PROFILE: 'standard', CCX_DISABLED: '', CCX_COMPRESS: '',
  CCX_DEBUG: '1', GIT_CONFIG_NOSYSTEM: '1' };
let pass = 0, fail = 0;

function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}

function hook(event, input, env = {}) {
  const r = spawnSync('node', [DISPATCH, event], { input: JSON.stringify(input), encoding: 'utf8', env: { ...ENV, ...env } });
  return { code: r.status, err: r.stderr || '', out: r.stdout || '' };
}
const internalError = (r) => /\[ccx:/.test(r.err);
const mk = (...p) => { const d = path.join(TMP, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
  '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args],
{ cwd, encoding: 'utf8', env: ENV });
function repo(name) {
  const dir = mk(name);
  git(dir, 'init', '-q');
  return dir;
}
function stage(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '--', ...Object.keys(files));
}

// ---------------------------------------------------------------- no-artifact-files
group('no-artifact-files : fichiers de travail');
const proj = repo('proj');
let sid = 0;
const write = (file, s, env) => hook('pre-edit',
  { session_id: s, cwd: proj, tool_name: 'Write', tool_input: { file_path: file, content: 'x\n' } }, env);
const S1 = `grd-art-${++sid}`;
const first = write(path.join(proj, 'NOTES.md'), S1);
check('NOTES.md neuf : refusé (exit 2)', first.code, 2);
check('message en français, relance indiquée', /relancer la même écriture/.test(first.err), true);
check('NOTES.md : 2e tentative autorisée', write(path.join(proj, 'NOTES.md'), S1).code, 0);
check('docs/NOTES.md autorisé', write(path.join(proj, 'docs', 'NOTES.md'), S1).code, 0);
check('.github/report.md autorisé', write(path.join(proj, '.github', 'report.md'), S1).code, 0);
check('dans le vault autorisé', write(path.join(VAULT, 'Claude', 'notes.md'), S1).code, 0);
fs.writeFileSync(path.join(proj, 'summary.md'), 'déjà là\n');
check('fichier existant (édition) autorisé', hook('pre-edit', { session_id: S1, cwd: proj, tool_name: 'Edit',
  tool_input: { file_path: path.join(proj, 'summary.md'), old_string: 'déjà', new_string: 'encore' } }).code, 0);
check('rapport-final.md refusé une fois', [write(path.join(proj, 'rapport-final.md'), S1).code,
  write(path.join(proj, 'rapport-final.md'), S1).code], [2, 0]);
check('résumé.txt refusé', write(path.join(proj, 'résumé.txt'), S1).code, 2);
check('src/report.ts autorisé (ni md ni txt)', write(path.join(proj, 'src', 'report.ts'), S1).code, 0);
check('README.md autorisé', write(path.join(proj, 'README.md'), S1).code, 0);
check('chemin relatif résolu depuis cwd', write('plan.md', S1).code, 2);
check('profil minimal : autorisé', write(path.join(proj, 'todo.md'), `grd-art-${++sid}`, { CC_PROFILE: 'minimal' }).code, 0);
check('CCX_DISABLED : autorisé', write(path.join(proj, 'todo.md'), `grd-art-${++sid}`, { CCX_DISABLED: '1' }).code, 0);
const strictS = `grd-art-${++sid}`;
const strict1 = write(path.join(proj, 'wip.md'), strictS, { CC_PROFILE: 'strict' });
const strict2 = write(path.join(proj, 'wip.md'), strictS, { CC_PROFILE: 'strict' });
const strict3 = write(path.join(proj, 'wip.md'), strictS, { CC_PROFILE: 'strict' });
check('strict : artefact, puis fact-forcing, puis passage', [strict1.code, /Fichier de travail/.test(strict1.err),
  strict2.code, /Fact-Forcing/.test(strict2.err), strict3.code], [2, true, 2, true, 0]);

// ---------------------------------------------------------------- dev-server-guard
group('dev-server-guard : serveurs au premier plan');
const bash = (command, extra = {}, env, cwd = proj) => hook('pre-bash',
  { session_id: `grd-dev-${++sid}`, cwd, tool_name: 'Bash', tool_input: { command, ...extra } }, env);
const REFUSED = ['next dev', 'npm run dev', 'pnpm run start', 'yarn run serve', 'bun run watch', 'bun dev', 'pnpm dev',
  'vite', 'vite dev', 'npx vite --port 5173', 'go run ./cmd/api', 'air', 'tauri dev', 'cargo tauri dev',
  'npm run tauri dev', 'docker compose up', 'docker compose -f dev.yml up --build', 'docker-compose up',
  'python -m http.server', 'python3 -m http.server 8000', 'nodemon app.js', 'tsc --watch', 'npx tsc -w',
  'jest --watch', 'vitest --watch', 'cd web && next dev', '(cd web && npm run dev)', 'PORT=3000 next dev > dev.log 2>&1'];
for (const c of REFUSED) check(`refusé : ${c}`, bash(c).code, 2);
for (const c of ['next dev', 'go run .', 'docker compose up']) {
  check(`run_in_background : ${c} autorisé`, bash(c, { run_in_background: true }).code, 0);
}
const ALLOWED = ['vite build', 'vitest run', 'vitest', 'docker compose up -d', 'docker compose up --detach',
  'docker-compose up -d', 'go build ./...', 'next build', 'npm run build', 'npm test', 'tsc --noEmit',
  'git commit -m "docs: explain next dev"', "echo 'npm run dev'", 'next dev &'];
for (const c of ALLOWED) check(`autorisé : ${c}`, bash(c).code, 0);
const devMsg = bash('next dev').err;
check('message : run_in_background + Monitor', /run_in_background: true/.test(devMsg) && /Monitor/.test(devMsg), true);
check('message compose : -d suggéré', /docker compose up -d/.test(bash('docker compose up').err), true);
check('profil minimal : autorisé', bash('next dev', {}, { CC_PROFILE: 'minimal' }).code, 0);
check('strict : refusé', bash('next dev', {}, { CC_PROFILE: 'strict' }).code, 2);

// ---------------------------------------------------------------- commit-gate
group('commit-gate : contenu indexé');
const commit = (dir, command = 'git commit -m "feat: x"', env) => hook('pre-bash',
  { session_id: `grd-cg-${++sid}`, cwd: dir, tool_name: 'Bash', tool_input: { command } }, env);
const LOG = 'console' + '.log("debug");\n';
const r1 = repo('cg-log');
stage(r1, { 'src/a.ts': `export const a = 1;\n${LOG}` });
const logged = commit(r1);
check('console.log indexé dans src/a.ts : refusé', logged.code, 2);
check('message : fichier:ligne', /src\/a\.ts:2/.test(logged.err), true);
check('chaîné après &&', commit(r1, 'git add -A && git commit -m "feat: x"').code, 2);
check('depuis un sous-dossier (cwd)', commit(path.join(r1, 'src')).code, 2);
check('profil minimal : autorisé', commit(r1, undefined, { CC_PROFILE: 'minimal' }).code, 0);
const r1b = repo('cg-dbg');
stage(r1b, { 'lib/b.js': 'function f() {\n  debug' + 'ger;\n}\n' });
check('debugger; indexé : refusé', commit(r1b).code, 2);
const r2 = repo('cg-test');
stage(r2, { 'src/a.test.ts': LOG, 'src/__tests__/b.ts': LOG, 'src/c.spec.js': LOG });
check('console.log dans a.test.ts / __tests__ / .spec : autorisé', commit(r2).code, 0);
const r3 = repo('cg-removed');
stage(r3, { 'src/a.ts': `export const a = 1;\n${LOG}` });
git(r3, 'commit', '-q', '-m', 'init');
stage(r3, { 'src/a.ts': 'export const a = 1;\n' });
check('console.log retiré (ligne -) : autorisé', commit(r3).code, 0);
const r4 = repo('cg-msg');
stage(r4, { 'src/a.ts': 'export const a = 1;\n' });
const badMsg = commit(r4, 'git commit -m "update stuff"');
check('message non conventionnel : refusé', [badMsg.code, /non conventionnel/.test(badMsg.err)], [2, true]);
check("message entre apostrophes non conventionnel : refusé", commit(r4, "git commit -m 'wip'").code, 2);
check('feat(scope)!: … autorisé', commit(r4, 'git commit -m "feat(api)!: drop v1"').code, 0);
check('fix: … autorisé', commit(r4, "git commit -m 'fix: handle null'").code, 0);
check('sans -m : autorisé', commit(r4, 'git commit').code, 0);
check('-F fichier : autorisé', commit(r4, 'git commit -F msg.txt').code, 0);
check('message par heredoc $(cat <<EOF) : autorisé',
  commit(r4, "git commit -m \"$(cat <<'EOF'\nupdate stuff\nEOF\n)\"").code, 0);
check('`git commit` cité dans un echo : ignoré', commit(r4, 'echo "git commit -m bad"').code, 0);
check('pas un dépôt git : autorisé', commit(mk('plain'), 'git commit -m "bad message"').code, 0);
const r5 = repo('cg-todo');
stage(r5, { 'src/a.ts': 'export const a = 1; // TO' + 'DO: cache\n' });
const todo = commit(r5);
let todoJson = null;
try { todoJson = JSON.parse(todo.out).hookSpecificOutput.hookEventName; } catch { /* reste null */ }
check('TODO ajouté : avertissement JSON, pas de refus', [todo.code, /TODO/.test(todo.out), todoJson], [0, true, 'PreToolUse']);
check('aucune erreur interne', internalError(todo), false);

const hasGofmt = spawnSync('sh', ['-c', 'command -v gofmt'], { encoding: 'utf8' }).status === 0;
if (!hasGofmt) console.log('    SKIP gofmt absent : tests Go sautés');
else {
  const r6 = repo('cg-go');
  stage(r6, { 'main.go': 'package main\nfunc main(){}\n' });
  const dirty = commit(r6);
  check('.go indexé non gofmt : refusé', [dirty.code, /main\.go/.test(dirty.err), /gofmt -w/.test(dirty.err)], [2, true, true]);
  stage(r6, { 'main.go': 'package main\n\nfunc main() {}\n' });
  check('.go indexé propre : autorisé', commit(r6).code, 0);
  // Le contenu INDEXÉ compte, pas l'arbre de travail.
  fs.writeFileSync(path.join(r6, 'main.go'), 'package main\nfunc main(){}\n');
  check('arbre de travail sale, index propre : autorisé', commit(r6).code, 0);
}

// ---------------------------------------------------------------- dispatcher
group('Dispatcher : ordre des modules');
const logCmd = hook('pre-bash', { session_id: `grd-e2e-${++sid}`, cwd: r4, tool_name: 'Bash', tool_input: { command: 'git log' } });
check('compress réécrit toujours `git log` (updatedInput)', [logCmd.code, /updatedInput/.test(logCmd.out)], [0, true]);
const devRun = hook('pre-bash', { session_id: `grd-e2e-${++sid}`, cwd: proj, tool_name: 'Bash', tool_input: { command: 'next dev' } });
check('serveur refusé : jamais réécrit', [devRun.code, /updatedInput/.test(devRun.out)], [2, false]);
check('commande anodine : aucune erreur interne', internalError(hook('pre-bash',
  { session_id: `grd-e2e-${++sid}`, cwd: proj, tool_name: 'Bash', tool_input: { command: 'ls' } })), false);

group('bash-hygiene : glob après un changement de dossier (régression)');
const { unmatchedGlobs } = require('./hooks/lib/bash-hygiene');
const emptyDir = fs.mkdtempSync(path.join(TMP, 'glob-'));
check('glob sans correspondance toujours signalé', unmatchedGlobs('ls *.zzz', emptyDir), ['*.zzz']);
check('après `cd x &&` : silence', unmatchedGlobs('cd sub && ls *.zzz', emptyDir), []);
check('après `pushd x;` : silence', unmatchedGlobs('pushd sub; ls *.zzz', emptyDir), []);
check('`cd` cité dans un message : pas une commande', unmatchedGlobs('git commit -m "cd x" && ls *.zzz', emptyDir), ['*.zzz']);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n  Gardes : ${pass} réussis, ${fail} échoués sur ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
