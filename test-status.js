#!/usr/bin/env node
'use strict';
/**
 * Tests of the status-line savings segment, the quota alert and config-doctor.
 * Launched by `node test.js`; usable alone: `node test-status.js`.
 * Everything runs under a temporary HOME: the real ~/.claude is never read or written.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-st-')));
const STATE = path.join(HOME, '.claude', 'state', 'ccx');
const ENV = { ...process.env, HOME, CC_PROFILE: 'standard', CCX_DISABLED: '', CCX_QUOTA_ALERT: '', CCX_QUOTA_WARN: '' };
const ANSI = /\x1b\[[0-9;]*m/g;
let pass = 0, fail = 0;

function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
const hasJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;
fs.mkdirSync(STATE, { recursive: true });

// ---------------------------------------------------------------- status line
group('Barre de statut : économies et limites');
const statusline = (payload) => {
  const r = spawnSync('bash', [path.join(ROOT, 'bin', 'statusline.sh')], { input: JSON.stringify(payload), encoding: 'utf8', env: ENV });
  return { code: r.status, out: (r.stdout || '').replace(ANSI, ''), err: r.stderr || '' };
};
if (!hasJq) console.log('    --   jq absent : tests de la barre de statut sautés');
else {
  const rows = [
    { session: 'sess-a', before: 9000, after: 1000 }, { session: 'sess-a', before: 500, after: 500 },
    { session: 'sess-b', before: 90000, after: 1000 }, { before: 50000, after: 10 },
  ];
  fs.writeFileSync(path.join(STATE, 'compress-stats.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n{bad\n');
  const base = { workspace: { current_dir: HOME }, cost: { total_cost_usd: 0.1, total_duration_ms: 60000 } };
  const a = statusline({ ...base, session_id: 'sess-a' });
  check('économies de la session seule (sess-b et lignes sans session exclues)', [a.code, /⇣8\.0k/.test(a.out), /⇣8[0-9]/.test(a.out)], [0, true, false]);
  check('session sans compression : aucun segment ⇣', statusline({ ...base, session_id: 'sess-z' }).out.includes('⇣'), false);
  check('session_id non sûr : ignoré, sortie 0', [statusline({ ...base, session_id: '$(id)' }).code, statusline({ ...base, session_id: '$(id)' }).out.includes('⇣')], [0, false]);
  check('aucune limite reçue : limits.json jamais écrit', fs.existsSync(path.join(STATE, 'limits.json')), false);
  statusline({ ...base, rate_limits: { five_hour: { used_percentage: 83.5, resets_at: 2000000000 }, seven_day: { used_percentage: 12 } } });
  let limits = null;
  try { limits = JSON.parse(fs.readFileSync(path.join(STATE, 'limits.json'), 'utf8')); } catch { /* reste null */ }
  check('limites copiées pour le hook', limits, { five_hour: { pct: 83.5, resets_at: 2000000000 }, seven_day: { pct: 12, resets_at: null } });
  statusline({ ...base, rate_limits: { five_hour: { used_percentage: 90, resets_at: 2000000000123 }, seven_day: { used_percentage: 5, resets_at: '2026-09-30T00:00:00Z' } } });
  try { limits = JSON.parse(fs.readFileSync(path.join(STATE, 'limits.json'), 'utf8')); } catch { limits = null; }
  check('resets_at en ms converti, non numérique écarté sans perdre le pourcentage', limits,
    { five_hour: { pct: 90, resets_at: 2000000000 }, seven_day: { pct: 5, resets_at: null } });
  check('aucun fichier temporaire laissé', fs.readdirSync(STATE).filter((f) => f.includes('.json.')), []);
}

// ---------------------------------------------------------------- quota alert
group('Alerte de quota');
const { crossings, thresholds, untilReset } = require('./hooks/lib/quota-alert');
const now = 1000000;
const lim = (pct, resets_at = now + 3600) => ({ five_hour: { pct, resets_at } });
check('79 % : rien', crossings(lim(79), {}, now, [80, 95]), []);
check('82 % : seuil 80', crossings(lim(82), {}, now, [80, 95]).map((c) => [c.key, c.level, c.pct]), [['five_hour', 80, 82]]);
check('82 % déjà annoncé pour cette fenêtre : rien', crossings(lim(82), { five_hour: { resets_at: now + 3600, level: 80 } }, now, [80, 95]), []);
check('96 % après 80 : seuil 95', crossings(lim(96), { five_hour: { resets_at: now + 3600, level: 80 } }, now, [80, 95]).map((c) => c.level), [95]);
check('nouvelle fenêtre : ré-annoncé', crossings(lim(85, now + 9000), { five_hour: { resets_at: now + 3600, level: 95 } }, now, [80, 95]).length, 1);
check('fenêtre déjà réinitialisée : ignorée', crossings(lim(99, now - 1), {}, now, [80, 95]), []);
check('pourcentage absent ou non numérique : ignoré', crossings({ five_hour: { pct: '90' }, seven_day: null }, {}, now), []);
check('CCX_QUOTA_WARN invalide → 80,95', (process.env.CCX_QUOTA_WARN = 'abc', thresholds()), [80, 95]);
check('CCX_QUOTA_WARN=90,70 → trié', (process.env.CCX_QUOTA_WARN = '90,70', thresholds()), [70, 90]);
delete process.env.CCX_QUOTA_WARN;
check('délai : 1 h 40', untilReset(now + 6000, now), '1 h 40');
check('délai : 3 j 2 h', untilReset(now + 3 * 86400 + 7200, now), '3 j 2 h');

const prompt = (env = {}) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'dispatch.js'), 'prompt'], {
    input: JSON.stringify({ session_id: 'quota-t', hook_event_name: 'UserPromptSubmit', prompt: 'x' }),
    encoding: 'utf8', env: { ...ENV, ...env },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reste null */ }
  return { code: r.status, out: r.stdout, json };
};
fs.writeFileSync(path.join(STATE, 'limits.json'), JSON.stringify({ five_hour: { pct: 86, resets_at: Math.floor(Date.now() / 1000) + 5400 } }));
check('profil minimal : muet', prompt({ CC_PROFILE: 'minimal' }).out, '');
check('CCX_QUOTA_ALERT=off : muet', prompt({ CCX_QUOTA_ALERT: 'off' }).out, '');
const first = prompt();
const spec = first.json && first.json.hookSpecificOutput;
check('86 % : message utilisateur', [first.code, /Fenêtre 5 h à 86 %/.test(first.json && first.json.systemMessage)], [0, true]);
check('86 % : même note au modèle (UserPromptSubmit)', [spec && spec.hookEventName, /86 %/.test(spec && spec.additionalContext)], ['UserPromptSubmit', true]);
check('jamais de décision ni de blocage', /decision|permissionDecision/.test(first.out), false);
check('deuxième message : plus d’alerte', prompt().out, '');
fs.writeFileSync(path.join(STATE, 'limits.json'), '{bad');
check('limits.json illisible : muet, sortie 0', [prompt({ CCX_QUOTA_WARN: '1' }).code, prompt({ CCX_QUOTA_WARN: '1' }).out], [0, '']);

// ---------------------------------------------------------------- config-doctor
group('config-doctor');
const vault = path.join(HOME, 'vault');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(vault);
const inst = spawnSync(process.execPath, [path.join(ROOT, 'install.js')], { encoding: 'utf8', env: { ...ENV, CC_VAULT: vault } });
check('installation dans le HOME temporaire', inst.status, 0);
const doctor = () => {
  const r = spawnSync(process.execPath, [path.join(HOME, '.claude', 'bin', 'config-doctor.js'), '--json'], { encoding: 'utf8', env: ENV });
  let res = [];
  try { res = JSON.parse(r.stdout); } catch { /* reste vide */ }
  const by = Object.fromEntries(res.map((x) => [x.label, x.level]));
  return { code: r.status, by };
};
const fresh = doctor();
check('installation fraîche : liens, hooks, dispatcher OK', [fresh.by.Liens, fresh.by['Hooks enregistrés'], fresh.by.Dispatcher], ['OK', 'OK', 'OK']);
check('plugin absent : avertissement seulement, sortie 0', [fresh.by['Plugin rebenga'], fresh.code], ['WARN', 0]);
const settingsFile = path.join(HOME, '.claude', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const moved = JSON.parse(JSON.stringify(settings));
moved.hooks.Stop = [...moved.hooks.Stop, ...moved.hooks.SessionStart];
delete moved.hooks.SessionStart;
fs.writeFileSync(settingsFile, JSON.stringify(moved));
check('hook sous le mauvais événement : FAIL', doctor().by['Hooks enregistrés'], 'FAIL');
settings.hooks.Stop.push(settings.hooks.Stop[0]);
fs.writeFileSync(settingsFile, JSON.stringify(settings));
check('hook en double : FAIL, sortie 1', [doctor().by['Hooks enregistrés'], doctor().code], ['FAIL', 1]);
fs.writeFileSync(settingsFile, '{bad');
check('settings.json illisible : FAIL', doctor().by['settings.json'], 'FAIL');
fs.unlinkSync(path.join(HOME, '.claude', 'CLAUDE.md'));
check('lien retiré : FAIL', doctor().by.Liens, 'FAIL');
check('doctor en lecture seule : lien non recréé', fs.existsSync(path.join(HOME, '.claude', 'CLAUDE.md')), false);

fs.rmSync(HOME, { recursive: true, force: true });
console.log(`\n  statut, quota, doctor : ${pass} réussis, ${fail} échoués sur ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
