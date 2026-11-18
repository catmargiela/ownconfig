#!/usr/bin/env node
'use strict';
/**
 * `bin/hud-data.js` (what the `hud` plugin reads outside the engine) and the
 * short status line it switches on. Launched by `node test.js`; usable alone.
 * Temporary HOME and vault: the real ones are never touched.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-hud-')));
const HOME = path.join(TMP, 'home');
const VAULT = path.join(TMP, 'vault');
const STATE = path.join(HOME, '.claude', 'state', 'ccx');
const ENV = { ...process.env, HOME, CC_VAULT: VAULT, CC_VAULT_DISABLED: '' };
const ANSI = /\x1b\[[0-9;]*m/g;
fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync(path.join(VAULT, 'Claude', 'Projets'), { recursive: true });

let pass = 0, fail = 0;
const say = (line) => process.stdout.write(`${line}\n`);
const group = (name) => say(`\n  ${name}`);
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  say(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
function data(...args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'hud-data.js'), ...args], { encoding: 'utf8', env: ENV, timeout: 20000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { code: r.status, json };
}

const repo = path.join(TMP, 'acme-shop');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'cart.ts'), '');
fs.writeFileSync(path.join(VAULT, 'Claude', 'Projets', 'Acme.md'), `---
type: projet
chemin: ${repo}
---

# Acme

## Décisions

- Le panier est dans \`src/cart.ts\`, l'ancien dans \`src/basket.ts\`.

## Pièges

- Rien pour l'instant.
`);

group('hud-data : mémoire');
const first = data('sess-1', repo);
const m = first.json && first.json.memory;
check('sortie 0, JSON lisible', [first.code, Boolean(first.json)], [0, true]);
check('page trouvée par son dossier, injectée en entier', m && [m.name, m.hasPage, m.mode, m.injected > 0], ['Acme', true, 'entier', true]);
check('sections de la page', m && m.sections, ['Décisions', 'Pièges']);
check('référence disparue comptée', m && m.staleRefs, 1);
const none = data('sess-1', path.join(TMP, 'nowhere'));
check('dossier sans page : dit, sans erreur', none.json && [none.json.memory.hasPage, none.json.memory.staleRefs], [false, 0]);
const off = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'hud-data.js'), 'sess-1', repo],
  { encoding: 'utf8', env: { ...ENV, CC_VAULT_DISABLED: '1' }, timeout: 20000 });
check('vault inactif : mémoire absente, raison donnée, sortie 0',
  [off.status, JSON.parse(off.stdout).memory, /inactif/.test(JSON.parse(off.stdout).memoryNote)], [0, null, true]);

group('hud-data : session de travail');
check('aucune session ouverte', first.json.work && [first.json.work.isOpen, first.json.work.previous], [false, null]);
fs.writeFileSync(path.join(STATE, 'sess-1.worksession.json'),
  JSON.stringify({ sid: 'sess-1', project: 'Acme', cwd: repo, startedAt: '2026-11-18T10:00:00.000Z', base: { cost: 1.5, added: 10, removed: 2 } }));
fs.writeFileSync(path.join(STATE, 'sess-1.cost.json'), JSON.stringify({ cost: 4, added: 130, removed: 10 }));
const open = data('sess-1', repo).json.work;
check('session ouverte : début, base et lignes depuis le début', [open.isOpen, open.startedAt, open.baseUsd, open.added, open.removed],
  [true, '2026-11-18T10:00:00.000Z', 1.5, 120, 8]);
fs.writeFileSync(path.join(STATE, 'worksessions.jsonl'), [
  { type: 'start', sid: 'sess-0', project: 'Acme', cwd: repo, startedAt: '2026-11-17T09:00:00.000Z', base: { cost: 0, added: 0, removed: 0 } },
  { type: 'end', sid: 'sess-0', opened: true, project: 'Acme', startedAt: '2026-11-17T09:00:00.000Z', endedAt: '2026-11-17T11:00:00.000Z', cost: 2.5, added: 40, removed: 3, bilan: 'Fait :\n- panier' },
].map((e) => JSON.stringify(e)).join('\n') + '\n');
const prev = data('sess-1', repo).json.work.previous;
check('session précédente du projet : fermée, coût et bilan', prev && [prev.isClosed, prev.usd, prev.bilan], [true, 2.5, 'Fait :\n- panier']);
const bad = data('$(id)', repo);
check('identifiant de session non sûr : ni session ni marqueur, sortie 0',
  [bad.code, bad.json.work, fs.readdirSync(STATE).some((f) => f.includes('$'))], [0, null, false]);

group('Barre de statut courte quand le HUD est dessiné');
const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
if (!hasJq) say('    --   jq absent : tests de la barre de statut sautés');
else {
  const payload = (sid) => JSON.stringify({
    session_id: sid, workspace: { current_dir: repo }, model: { display_name: 'Fable 5' }, effort: { level: 'medium' },
    context_window: { used_percentage: 42 }, cost: { total_cost_usd: 3.42, total_duration_ms: 60000, total_lines_added: 12, total_lines_removed: 3 },
    rate_limits: { five_hour: { used_percentage: 23, resets_at: 2000000000 } },
  });
  const line = (sid) => {
    const r = spawnSync('bash', [path.join(ROOT, 'bin', 'statusline.sh')], { input: payload(sid), encoding: 'utf8', env: ENV });
    return { code: r.status, out: (r.stdout || '').replace(ANSI, '') };
  };
  const full = line('sess-9');
  check('sans HUD : barre complète', [full.code, /42%/.test(full.out), /\$3\.42/.test(full.out), /5h 23%/.test(full.out)], [0, true, true, true]);
  check('hud-data laisse le marqueur de la conversation', fs.existsSync(path.join(STATE, 'sess-1.hud.json')), true);
  const short = line('sess-1');
  check('avec HUD : dossier et modèle seulement', [short.code, /acme-shop/.test(short.out), /Fable 5 medium/.test(short.out)], [0, true, true]);
  check('avec HUD : ni jauge, ni coût, ni limites, ni lignes', /42%|\$3\.42|5h|\+12/.test(short.out), false);
  let snap = null;
  try { snap = JSON.parse(fs.readFileSync(path.join(STATE, 'sess-1.cost.json'), 'utf8')); } catch { /* stays null */ }
  check('avec HUD : le coût reste écrit pour /startsession', snap, { cost: 3.42, added: 12, removed: 3 });
}

fs.rmSync(TMP, { recursive: true, force: true });
say(`\n  HUD : ${pass} réussis, ${fail} échoués sur ${pass + fail}`);
process.exit(fail ? 1 : 0);
