'use strict';
/**
 * Quality gates, token-saver engine vs Node engine.
 *
 *  1. Six fixtures of the usual stack (git diff, eslint, docker build, cargo
 *     from token-saver's own audit scenarios; go test and next build from
 *     tests/compress/, upstream has none). For each: does the Python engine
 *     keep every must-keep string AND save at least the Node engine minus 5
 *     points? `pythonQualifies` records the measured answer, so an upstream
 *     update that changes it fails here and forces a new routing decision.
 *     Invariant: auto mode never sends a command to Python where it does not
 *     qualify, and whatever auto picks keeps every must-keep string.
 *  2. Families without a dedicated Node processor (kubectl, terraform, mvn):
 *     the result auto mode prints keeps everything and meets its saving floor.
 *  3. The Node critical-line recovery on top of Python: an error line that an
 *     upstream processor drops comes back.
 */
const { bestResult, engineOrder, compressWithNode } = require('../../hooks/lib/compress/select');

const pick = (list, name) => {
  const f = list.find((x) => x.name === name);
  if (!f) throw new Error(`fixture introuvable : ${name}`);
  return f;
};

const upstream = require('./fixtures-upstream');
const STACK = [
  { ...upstream[0], pythonQualifies: true },
  { ...upstream[1], pythonQualifies: false },
  { ...upstream[2], pythonQualifies: true },
  { ...upstream[3], pythonQualifies: true },
  { ...pick(require('./fixtures-vcs-tests'), 'go test failure buried in the middle'), pythonQualifies: false },
  { ...pick(require('./fixtures-build-lint'), 'next build success'), pythonQualifies: false },
];

const saving = (text, input) => Math.round(100 * (1 - text.length / input.length));
const rawOf = (f) => (f.stream === 'stderr' ? { stdout: '', stderr: f.input } : { stdout: f.input, stderr: '' });
const missing = (f, text) => f.mustPreserve.filter((s) => !f.input.includes(s) || !text.includes(s));

module.exports = function engineQuality({ PY, check, skipped, group, eligible, parse, compressWithPython, runAdapter }) {
  group('Qualité : token-saver face au moteur Node (pile habituelle)');
  if (!PY) return skipped('portes de qualité', 'python3 >= 3.10 absent');
  for (const f of STACK) {
    const { processor } = eligible(f.cmd);
    const raw = rawOf(f);
    const node = compressWithNode(f.cmd, processor, raw, f.exitCode);
    const py = compressWithPython(parse(f.cmd).join(' '), processor, raw, f.exitCode);
    const nodeText = node.stdout + node.stderr;
    const pyText = py ? py.stdout + py.stderr : '';
    const lost = py ? missing(f, pyText) : ['python indisponible'];
    const qualifies = lost.length === 0 && saving(pyText, f.input) >= saving(nodeText, f.input) - 5;
    const auto = bestResult(f.cmd, processor, raw, f.exitCode, f.input.length);
    const autoText = auto ? auto.stdout + auto.stderr : f.input;
    console.log(`         ${f.name} : node ${saving(nodeText, f.input)} %, token-saver ${saving(pyText, f.input)} %` +
      `${lost.length ? ` (perd ${JSON.stringify(lost)})` : ''} → auto : ${auto ? auto.engine : 'brut'}`);
    check(`${f.name} : token-saver qualifié = ${f.pythonQualifies} (mesuré)`, qualifies, f.pythonQualifies);
    check(`${f.name} : auto n'utilise token-saver que s'il est qualifié`, !(auto && auto.engine === 'python') || qualifies, true);
    check(`${f.name} : sortie auto garde toutes les chaînes obligatoires`, missing(f, autoText), []);
  }

  group('Qualité : familles sans processeur Node dédié (auto → token-saver d’abord)');
  for (const f of require('./fixtures-families')) {
    const { ok, processor } = eligible(f.cmd);
    const raw = rawOf(f);
    const auto = bestResult(f.cmd, processor, raw, f.exitCode, f.input.length);
    const node = compressWithNode(f.cmd, processor, raw, f.exitCode);
    const text = auto ? auto.stdout + auto.stderr : f.input;
    const s = saving(text, f.input);
    console.log(`         ${f.name} : auto ${auto ? auto.name : 'brut'} ${s} %, node ${saving(node.stdout + node.stderr, f.input)} %`);
    check(`${f.name} : éligible, ordre auto python → node`, [ok, engineOrder(processor)], [true, ['python', 'node']]);
    check(`${f.name} : rien de perdu, ${s} % ≥ ${f.minSavingsPercent} %, ≥ node − 5`,
      [missing(f, text), s >= f.minSavingsPercent, s >= saving(node.stdout + node.stderr, f.input) - 5], [[], true, true]);
  }

  group('Récupération Node au-dessus de token-saver');
  const tests = [...Array(150)].map((_, i) => `=== RUN   TestX${i}\n    x_test.go:${i}: setup done\n--- PASS: TestX${i} (0.00s)`);
  tests[70] = '=== RUN   TestQueue61\n    date_test.go:42: Error: parseDate failed, got 1 want 2\n--- FAIL: TestQueue61 (0.00s)';
  const input = `${tests.join('\n')}\nFAIL\nFAIL\texample.com/app\t0.5s\n`;
  const LINE = 'date_test.go:42: Error: parseDate failed, got 1 want 2';
  const upstreamOnly = runAdapter({ command: 'go test -v ./...', exit_code: 1, stdout: input, stderr: '' });
  const secured = compressWithPython('go test -v ./...', 'gotest', { stdout: input, stderr: '' }, 1);
  check('le processeur upstream `test` perd la ligne d’erreur (défaut constaté)', upstreamOnly && upstreamOnly.stdout.includes(LINE), false);
  check('la récupération Node la remet, sous le marqueur', [secured.stdout.includes(LINE), /\[ccx: 1 ligne d'erreur récupérée\]/.test(secured.stdout)], [true, true]);
  return undefined;
};
