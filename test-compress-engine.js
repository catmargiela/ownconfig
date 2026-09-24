#!/usr/bin/env node
'use strict';
/**
 * Tests of the token-saver engine behind the compression wrapper:
 * ts_adapter.py (isolation, contract), engine selection in wrap.js
 * (CCX_COMPRESS_ENGINE, fallbacks, exit codes, streams) and quality gates.
 * Launched by `node test.js`; usable alone: `node test-compress-engine.js`.
 *
 * Everything runs with a temporary HOME. Tests that need python >= 3.10 are
 * reported as skipped (never silently passed) when it is missing.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const LIB = path.join(ROOT, 'hooks', 'lib', 'compress');
const WRAP = path.join(LIB, 'wrap.js');
const VENDOR = path.join(ROOT, 'vendor', 'token-saver');
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-eng-')));
const ENV = { ...process.env, HOME, CC_PROFILE: 'standard', CCX_DISABLED: '', CCX_COMPRESS: '',
  CCX_COMPRESS_ENGINE: '', SHELL: '/bin/sh' };
process.env.CCX_COMPRESS_ENGINE = '';
let pass = 0, fail = 0, skip = 0;

function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
/** CI sets CCX_TEST_REQUIRE_PYTHON=1: there, a skip is a failure. */
function skipped(label, why) {
  if (process.env.CCX_TEST_REQUIRE_PYTHON === '1') return check(`${label} (${why})`, 'ignoré', 'exécuté');
  skip++;
  return console.log(`    SKIP ${label} (${why})`);
}

const { eligible, parse } = require('./hooks/lib/compress/policy');
const { compress } = require('./hooks/lib/compress/engine');
const { compressWithPython, runAdapter, pythonCandidates, ADAPTER } = require('./hooks/lib/compress/python');

// The interpreter python.js will actually use (CCX_PYTHON, then fixed system paths; never PATH).
const PYBIN = pythonCandidates().find((p) => (spawnSync(p, ['-c', 'import sys; print(sys.version_info >= (3, 10))'],
  { encoding: 'utf8' }).stdout || '').trim() === 'True') || null;
const PY = Boolean(PYBIN);
const needPy = (label, fn) => (PY ? fn() : skipped(label, 'aucun python >= 3.10 (CCX_PYTHON ou chemins système)'));
const realTs = path.join(os.homedir(), '.token-saver');
const realTsBefore = fs.existsSync(realTs);

// ---------------------------------------------------------------- adapter
group('Adaptateur ts_adapter.py');
const adapter = (input, env = {}, cwd = HOME) => {
  const r = spawnSync(PYBIN, ['-I', '-B', ADAPTER], { input, encoding: 'utf8', cwd, timeout: 10000,
    env: { PATH: process.env.PATH, HOME, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reste null */ }
  return { code: r.status, json, out: r.stdout };
};
const commits = [...Array(60)].map((_, i) => `commit ${String(i).padStart(40, 'a')}\nAuthor: A <a@example.com>\nDate:   x\n\n    feat: change ${i}\n`).join('\n');
const req = (o) => JSON.stringify({ command: 'git log', exit_code: 0, stdout: commits, stderr: '', ...o });

needPy('adaptateur : contrat JSON', () => {
  const ok = adapter(req());
  check('réponse JSON valide, sortie 0', [ok.code, ok.json && ok.json.ok], [0, true]);
  check('champs du contrat', ok.json && ['ok', 'processor', 'stdout', 'stderr', 'redacted'].every((k) => k in ok.json), true);
  check('processeur git, sortie raccourcie', [ok.json.processor, ok.json.stdout.length < commits.length], ['git', true]);
  check('stderr vide reste vide', ok.json.stderr, '');
  check('réponse ASCII uniquement', /^[\x20-\x7e]*$/.test(ok.out), true);
  for (const [label, input] of [['JSON illisible', '{bad'], ['objet attendu', '[1]'], ['commande vide', req({ command: ' ' })],
    ['exit_code non entier', req({ exit_code: '1' })], ['stdout non texte', req({ stdout: 3 })], ['entrée vide', '']]) {
    const r = adapter(input);
    check(`exception → ok:false, sortie 0 : ${label}`, [r.code, r.json && r.json.ok], [0, false]);
  }
});

needPy('adaptateur : isolation', () => {
  const fake = path.join(HOME, 'fakehome');
  const marker = path.join(HOME, 'user-processor-ran');
  fs.mkdirSync(path.join(fake, '.token-saver', 'processors'), { recursive: true });
  fs.writeFileSync(path.join(fake, '.token-saver', 'config.json'), '{"enabled": false}');
  fs.writeFileSync(path.join(fake, '.token-saver', 'processors', 'evil.py'), `open(${JSON.stringify(marker)}, "w").write("x")\n`);
  const proj = path.join(HOME, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, '.token-saver.json'), '{"enabled": false}');
  const r = adapter(req(), { HOME: fake, TOKEN_SAVER_ENABLED: 'false', TOKEN_SAVER_USER_PROCESSORS_DIR: path.dirname(marker) }, proj);
  check('config ~/.token-saver, projet et TOKEN_SAVER_* ignorés', [r.json && r.json.ok, r.json && r.json.processor], [true, 'git']);
  check('processeur utilisateur jamais importé', fs.existsSync(marker), false);
  const clean = spawnSync(PYBIN, ['-I', '-B', ADAPTER], { input: req(), encoding: 'utf8', env: { PATH: process.env.PATH, HOME } });
  check('aucun fichier écrit sous le HOME temporaire (hors fixtures)', fs.readdirSync(HOME).sort(), ['fakehome', 'proj']);
  check('pas de ~/.token-saver sous le HOME temporaire', fs.existsSync(path.join(HOME, '.token-saver')), false);
  check('adaptateur relancé : même résultat', JSON.parse(clean.stdout).stdout, r.json.stdout);
  const pyc = spawnSync('find', [VENDOR, '-name', '__pycache__'], { encoding: 'utf8' }).stdout.trim();
  check('aucun bytecode écrit dans vendor/', pyc, '');
  const mods = spawnSync(PYBIN, ['-I', '-B', '-c', `import runpy, sys, io
sys.stdin = io.TextIOWrapper(io.BytesIO(${JSON.stringify(req())}.encode()))
sys.stdout = io.TextIOWrapper(io.BytesIO())
try:
    runpy.run_path(${JSON.stringify(ADAPTER)}, run_name="__main__")
except SystemExit:
    pass
bad = [m for m in sys.modules if m.split(".")[-1] in ("telemetry", "tracker", "stats", "delta_store", "updater", "version_check", "sqlite3")]
sys.__stdout__.write(",".join(bad))`], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME } });
  check('aucun module disque/réseau chargé (stats, tracker, delta, updater, sqlite3)', [mods.status, mods.stdout], [0, '']);
});

// A real old interpreter when the machine has one (macOS ships 3.9), otherwise a
// modern one whose reported version is lowered to 3.9: the adapter checks
// sys.version_info at run time, so both exercise the same refusal path.
const old = spawnSync('/usr/bin/python3', ['-c', 'import sys; print(sys.version_info < (3, 10))'], { encoding: 'utf8' });
const oldRun = !old.error && old.stdout.trim() === 'True'
  ? { bin: '/usr/bin/python3', args: ['-I', '-B', ADAPTER] }
  : PYBIN && { bin: PYBIN, args: ['-I', '-B', '-c',
    `import sys, runpy; sys.version_info = (3, 9, 0, "final", 0); runpy.run_path(${JSON.stringify(ADAPTER)}, run_name="__main__")`] };
if (oldRun) {
  const r = spawnSync(oldRun.bin, oldRun.args, { input: req(), encoding: 'utf8', env: { PATH: '/usr/bin', HOME } });
  let answer = null;
  try { answer = JSON.parse(r.stdout).ok; } catch { /* reste null */ }
  check('python < 3.10 : ok:false, jamais d’exception', [r.status, answer], [0, false]);
} else skipped('python < 3.10 : ok:false', 'aucun interpréteur pour simuler python < 3.10');

require('./tests/compress/engine-wrap')({ ROOT, WRAP, HOME, ENV, PY, check, skipped, group, runAdapter });
require('./tests/compress/engine-quality')({ PY, check, skipped, group, eligible, parse, compress, compressWithPython, runAdapter });

check('~/.token-saver réel jamais créé', !realTsBefore && fs.existsSync(realTs), false);
fs.rmSync(HOME, { recursive: true, force: true });
console.log(`\n  moteur de compression : ${pass} réussis, ${fail} échoués, ${skip} ignorés sur ${pass + fail + skip}\n`);
process.exit(fail ? 1 : 0);
