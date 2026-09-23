#!/usr/bin/env node
'use strict';
/**
 * Tests des thèmes versionnés (themes/*.json) et du vérificateur bin/theme-check.js.
 * Lancé par `node test.js` ; utilisable seul : `node test-themes.js`.
 * Tout tourne avec un HOME temporaire : rien n'est écrit dans le vrai ~/.claude.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkTheme, parseColor, contrast } = require('./bin/theme-check');

const THEMES = path.join(__dirname, 'themes');
let pass = 0, fail = 0;
function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}

group('Thèmes : fichiers versionnés');
const files = fs.readdirSync(THEMES).filter((f) => f.endsWith('.json'));
check('au moins un thème', files.length > 0, true);
for (const f of files) {
  const r = checkTheme(JSON.parse(fs.readFileSync(path.join(THEMES, f), 'utf8')));
  check(`${f} : aucune erreur`, r.errors, []);
  check(`${f} : contraste texte suffisant`, r.warnings, []);
}

group('Thèmes : vérificateur');
check('hex long', parseColor('#97CE4C'), [151, 206, 76]);
check('hex court', parseColor('#fff'), [255, 255, 255]);
check('rgb()', parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
check('ansi256 accepté (non RVB)', parseColor('ansi256(180)'), null);
check('ansi:<nom> accepté', parseColor('ansi:cyanBright'), null);
const bad = (v) => { try { parseColor(v); return false; } catch { return true; } };
check('couleurs invalides refusées', ['#12', 'rgb(300,0,0)', 'blue', 'ansi:purple', 'ansi256(999)'].map(bad), [true, true, true, true, true]);
check('contraste noir/blanc = 21', Math.round(contrast([0, 0, 0], [255, 255, 255])), 21);
const base = { name: 'x', base: 'dark', overrides: { text: '#ffffff' } };
check('thème minimal valide', checkTheme(base).errors, []);
check('clé inconnue signalée', checkTheme({ ...base, overrides: { textColor: '#fff' } }).errors.length, 1);
check('base inconnue signalée', checkTheme({ ...base, base: 'solarized' }).errors.length, 1);
check('overrides absent signalé', checkTheme({ name: 'x', base: 'dark' }).errors.length, 1);
check('contraste faible averti', checkTheme({ ...base, overrides: { text: '#444444', userMessageBackground: '#333333' } }).warnings.length, 1);
const cli = spawnSync('node', [path.join(__dirname, 'bin', 'theme-check.js'), ...files.map((f) => path.join(THEMES, f))], { encoding: 'utf8' });
check('CLI : sortie 0 sur les thèmes du dépôt', cli.status, 0);

group('Thèmes : installation');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-th-'));
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const dry = spawnSync('node', [path.join(__dirname, 'install.js'), '--dry-run'], { encoding: 'utf8', env: { ...process.env, HOME } }).stdout || '';
for (const f of files) {
  check(`dry-run : lien ${f}`, dry.includes(`${path.join(HOME, '.claude', 'themes', f)} -> ${path.join(THEMES, f)}`), true);
}
check('dry-run : rien écrit', fs.existsSync(path.join(HOME, '.claude', 'themes')), false);
fs.rmSync(HOME, { recursive: true, force: true });

console.log(`\n  thèmes : ${pass} réussis, ${fail} échoués sur ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
