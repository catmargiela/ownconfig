'use strict';
/**
 * Engine selection through wrap.js: CCX_COMPRESS_ENGINE, interpreter
 * resolution (never PATH), python crashing / lying / hanging / too old, exit
 * codes, streams, stats.
 * Called by test-compress-engine.js with its helpers.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = function engineWrap({ WRAP, HOME, ENV, PY, check, skipped, group, runAdapter }) {
  group('Sélection du moteur (wrap.js)');
  const big = path.join(HOME, 'big');
  fs.mkdirSync(big);
  for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(big, `file-${String(i).padStart(3, '0')}.ts`), '');
  const noise = path.join(HOME, 'noise.txt');
  const lines = [...Array(600)].map((_, i) => `worker ${i}: processed batch ${i} in ${i % 97} ms`);
  lines[300] = 'FATAL: disk quota exceeded on /var/lib/data';
  fs.writeFileSync(noise, `${lines.join('\n')}\n`);

  const b64 = (c) => Buffer.from(c, 'utf8').toString('base64');
  const statsFile = path.join(HOME, '.claude', 'state', 'ccx', 'compress-stats.jsonl');
  const lastStat = () => {
    const rows = fs.readFileSync(statsFile, 'utf8').trim().split('\n');
    return JSON.parse(rows[rows.length - 1]);
  };
  const wrap = (command, env = {}) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [WRAP, b64(command)], { cwd: HOME, encoding: 'utf8', env: { ...ENV, ...env } });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '', ms: Date.now() - t0 };
  };
  const footerOf = (out) => (out.match(/\(((?:ts|node):[a-z_]+)\) — CCX_RAW=1/) || [])[1] || null;

  // A fake interpreter, reached ONLY through CCX_PYTHON (absolute path).
  const fakePython = (name, script) => {
    const file = path.join(HOME, `fake-python-${name}`);
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
    fs.chmodSync(file, 0o755);
    return file;
  };

  const DU = `du -a ${big}`;
  const node = wrap(DU, { CCX_COMPRESS_ENGINE: 'node' });
  check('CCX_COMPRESS_ENGINE=node : moteur Node', [node.code, footerOf(node.out), lastStat().engine], [0, 'node:generic', 'node']);
  if (PY) {
    const auto = wrap(DU);
    check('auto + python disponible : token-saver pour une commande sans processeur Node dédié',
      [auto.code, /^ts:/.test(footerOf(auto.out)), lastStat().engine], [0, true, 'python']);
    const forced = wrap(`find ${big} -type f`, { CCX_COMPRESS_ENGINE: 'python' });
    check('CCX_COMPRESS_ENGINE=python : token-saver même avec un processeur Node dédié',
      [forced.code, footerOf(forced.out)], [0, 'ts:file_listing']);
  } else skipped('auto / python forcé → token-saver', 'aucun python >= 3.10');
  const dedicated = wrap(`find ${big} -type f`);
  check('auto : processeur Node dédié (find) → moteur Node', footerOf(dedicated.out), 'node:listing');

  group('Interpréteur Python : jamais trouvé par le PATH');
  const req = { command: 'du -a x', exit_code: 0, stdout: 'x\n'.repeat(3000), stderr: '' };
  check('aucun interpréteur candidat → null (repli Node)', runAdapter(req, []), null);
  check('interpréteur inexistant → null (repli Node)', runAdapter(req, [path.join(HOME, 'no-python')]), null);
  const marker = path.join(HOME, 'path-shim-ran');
  const shimDir = path.join(HOME, 'shim-bin');
  fs.mkdirSync(shimDir);
  fs.writeFileSync(path.join(shimDir, 'python3'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\necho '{"ok": true, "processor": "shim", "stdout": "", "stderr": ""}'\n`);
  fs.chmodSync(path.join(shimDir, 'python3'), 0o755);
  const shimPath = `${shimDir}:${ENV.PATH}`;
  const shimmed = wrap(DU, { PATH: shimPath });
  check('python3 placé en tête du PATH : jamais exécuté', [shimmed.code, fs.existsSync(marker), footerOf(shimmed.out) === 'ts:shim'],
    [0, false, false]);
  const relative = wrap(DU, { PATH: shimPath, CCX_PYTHON: 'python3' });
  check('CCX_PYTHON relatif ignoré : le python3 du PATH n’est pas exécuté', [relative.code, fs.existsSync(marker)], [0, false]);
  const notExec = path.join(HOME, 'not-executable');
  fs.writeFileSync(notExec, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
  const nx = wrap(DU, { CCX_PYTHON: notExec });
  check('CCX_PYTHON non exécutable ignoré', [nx.code, fs.existsSync(marker)], [0, false]);
  if (PY) {
    const tooOld = fakePython('old', 'cat >/dev/null; echo \'{"ok": false, "error": "RuntimeError: python >= 3.10 required"}\'');
    const next = wrap(DU, { CCX_PYTHON: tooOld });
    check('CCX_PYTHON trop ancien → candidat système suivant (token-saver)', [next.code, /^ts:/.test(footerOf(next.out))], [0, true]);
  } else skipped('trop ancien → candidat suivant', 'aucun python >= 3.10');

  const FAKES = {
    crash: 'exit 3',
    garbage: 'echo "not json"',
    notok: 'echo \'{"ok": false, "error": "boom"}\'',
    types: 'echo \'{"ok": true, "stdout": 42, "stderr": ""}\'',
    longer: 'cat >/dev/null; printf \'{"ok": true, "processor": "x", "stdout": "%040000d", "stderr": ""}\' 0',
    liar: 'cat >/dev/null; echo \'{"ok": true, "processor": "x", "stdout": "all good\\\\n", "stderr": "", "exit_code": 0}\'',
  };
  for (const [name, script] of Object.entries(FAKES)) {
    const r = wrap(DU, { CCX_PYTHON: fakePython(name, script) });
    if (name === 'liar') {
      check('python qui « réussit » : sortie utilisée, pied de page ts:', footerOf(r.out), 'ts:x');
      continue;
    }
    check(`python ${name} → repli Node, code conservé`, [r.code, footerOf(r.out)], [0, 'node:generic']);
  }
  const slow = wrap(DU, { CCX_PYTHON: fakePython('slow', 'sleep 30') });
  check('python bloqué → coupé à 5 s, repli Node (sans essayer les suivants)',
    [slow.code, footerOf(slow.out), slow.ms >= 4500 && slow.ms < 9000], [0, 'node:generic', true]);

  group('Moteur token-saver : codes de sortie et flux');
  const failing = `grep -h . ${noise} /nonexistent-ccx-file`;
  const liar = wrap(failing, { CCX_PYTHON: fakePython('liar2', FAKES.liar), CCX_COMPRESS_ENGINE: 'python' });
  check('réponse python qui prétend exit 0 : code de la commande conservé (2)', [liar.code, footerOf(liar.out)], [2, 'ts:x']);
  check('réponse python non fiable : ligne critique remise par la récupération Node',
    liar.out.includes('FATAL: disk quota exceeded on /var/lib/data'), true);
  if (!PY) return skipped('flux et récupération avec le vrai moteur', 'aucun python >= 3.10');
  const real = wrap(failing, { CCX_COMPRESS_ENGINE: 'python' });
  check('échec : code conservé (2), compressé par token-saver', [real.code, /^ts:/.test(footerOf(real.out))], [2, true]);
  const body = real.out.split('\n').filter((l) => !l.startsWith('[ccx: sortie compressée')).join('\n');
  check('stderr reste sur stderr', [/nonexistent-ccx-file/.test(real.err), /nonexistent-ccx-file/.test(body)], [true, false]);
  check('ligne critique enfouie au milieu conservée', real.out.includes('FATAL: disk quota exceeded on /var/lib/data'), true);
  check('stats : moteur python, processeur ts:*', [lastStat().engine, /^ts:/.test(lastStat().processor), lastStat().exit],
    ['python', true, 2]);
};
