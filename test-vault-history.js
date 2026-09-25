#!/usr/bin/env node
'use strict';
/**
 * Tests of the vault history (git outside the vault), the weekly digest and the
 * guard event log. Launched by `node test.js`; usable alone.
 * Temporary HOME, vault and history repository: the real ones are never touched.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-vh-')));
const HOME = path.join(TMP, 'home');
const VAULT = path.join(TMP, 'vault');
const GIT_DIR = path.join(TMP, 'history.git');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(VAULT, 'Claude', 'Projets'), { recursive: true });
fs.mkdirSync(path.join(VAULT, 'Claude', 'Journal'), { recursive: true });
Object.assign(process.env, { HOME, CC_VAULT: VAULT, CC_VAULT_HISTORY_DIR: GIT_DIR, CC_VAULT_DISABLED: '',
  CC_VAULT_HISTORY: '', CC_VAULT_WEEKLY: '', CCX_DISABLED: '', CC_PROFILE: 'standard' });
let pass = 0, fail = 0;

function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
const ROOT = path.join(VAULT, 'Claude');
const note = path.join(ROOT, 'Projets', 'demo.md');
const commits = () => Number((spawnSync('git', [`--git-dir=${GIT_DIR}`, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).stdout || '0').trim()) || 0;

// ---------------------------------------------------------------- history
group('Historique du vault (git hors du vault)');
const history = require('./hooks/lib/vault/history');
fs.writeFileSync(note, '# Demo\n\n- décision A\n');
check('premier Stop : un commit', [history.snapshot('test', 'sess-1'), commits()], [true, 1]);
check('rien de changé : aucun commit', [history.snapshot('test', 'sess-1'), commits()], [false, 1]);
fs.appendFileSync(note, '- décision B\n');
fs.writeFileSync(path.join(ROOT, '.DS_Store'), 'x');
fs.writeFileSync(path.join(ROOT, 'Projets', 'demo.md.tmp.123'), 'partial');
check('modification : nouveau commit', [history.snapshot('test', 'sess-2'), commits()], [true, 2]);
const files = spawnSync('git', [`--git-dir=${GIT_DIR}`, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).stdout.trim().split('\n');
check('fichiers temporaires et .DS_Store exclus', files, ['Projets/demo.md']);
check('aucun .git dans le vault', [fs.existsSync(path.join(ROOT, '.git')), fs.existsSync(path.join(VAULT, '.git'))], [false, false]);
check('aucun remote configuré', spawnSync('git', [`--git-dir=${GIT_DIR}`, 'remote'], { encoding: 'utf8' }).stdout.trim(), '');
const old = spawnSync('git', [`--git-dir=${GIT_DIR}`, 'show', 'HEAD~1:Projets/demo.md'], { encoding: 'utf8' }).stdout;
check('version précédente récupérable', old, '# Demo\n\n- décision A\n');
const changed = history.changedBetween(new Date(Date.now() - 3600e3), new Date(Date.now() + 3600e3));
check('notes modifiées sur la période', changed, [{ file: 'Projets/demo.md', commits: 2 }]);
check('résumé pour le doctor', history.summary().commits, 2);
process.env.CC_VAULT_HISTORY = 'off';
fs.appendFileSync(note, '- C\n');
check('CC_VAULT_HISTORY=off : rien', [history.snapshot('test'), commits()], [false, 2]);
process.env.CC_VAULT_HISTORY = '';
const d = spawnSync(process.execPath, [path.join(__dirname, 'hooks', 'dispatch.js'), 'stop'],
  { input: JSON.stringify({ session_id: 'vh-e2e', cwd: TMP, hook_event_name: 'Stop' }), encoding: 'utf8',
    env: { ...process.env, CC_CONTEXT_MONITOR: 'off', CCX_NOTIFY: 'off' } });
check('Stop réel via le dispatcher : commit, sortie 0', [d.status, commits()], [0, 3]);

// ---------------------------------------------------------------- weekly
group('Bilan hebdo');
const weekly = require('./hooks/lib/vault/weekly');
const W = (y, m, dd) => weekly.weekName(weekly.isoWeek(new Date(y, m - 1, dd)));
check('semaines ISO (bords d\'année)', [W(2026, 9, 24), W(2027, 1, 1), W(2026, 12, 28), W(2024, 12, 30), W(2026, 1, 1)],
  ['2026-W39', '2026-W53', '2026-W53', '2025-W01', '2026-W01']);
const wk = weekly.isoWeek(new Date(2026, 8, 24));
check('début lundi 00:00, fin lundi suivant', [wk.start.getDay(), wk.start.getHours(), (wk.end - wk.start) / 86400000], [1, 0, 7]);
const nextMonday = new Date(wk.end.getTime() + 3600e3);
fs.writeFileSync(path.join(ROOT, 'Journal', '2026-09-22 — demo.md'), '---\ntype: session\nprojet: demo\nsessions: 3\n---\n');
fs.writeFileSync(path.join(ROOT, 'Journal', '2026-09-14 — demo.md'), '---\nprojet: demo\nsessions: 9\n---\n');
const stats = path.join(HOME, '.claude', 'state', 'ccx');
fs.mkdirSync(stats, { recursive: true });
fs.writeFileSync(path.join(stats, 'compress-stats.jsonl'), [
  { ts: '2026-09-23T10:00:00Z', cmd: 'git log', before: 20000, after: 2000 },
  { ts: '2026-09-23T11:00:00Z', cmd: 'ls', before: 500, after: 500 },
  { ts: '2026-09-10T11:00:00Z', cmd: 'go test', before: 90000, after: 10 }].map((r) => JSON.stringify(r)).join('\n') + '\n');
const written = weekly.writeDigest(nextMonday);
const digest = written ? fs.readFileSync(written, 'utf8') : '';
check('écrit dans Journal/Hebdo/2026-W39.md', written && path.relative(ROOT, written), path.join('Journal', 'Hebdo', '2026-W39.md'));
check('sessions de la semaine seulement', [digest.includes('[[demo]] : 3'), digest.includes(': 9')], [true, false]);
check('compression de la semaine seulement', [/1 commande\(s\) compressée\(s\) sur 2/.test(digest), digest.includes('go test')], [true, false]);
check('lien vers la semaine précédente', digest.includes('[[2026-W38]]'), true);
fs.writeFileSync(written, 'NOTE HUMAINE\n');
check('jamais réécrit une fois créé', [weekly.writeDigest(nextMonday), fs.readFileSync(written, 'utf8')], [null, 'NOTE HUMAINE\n']);
check('semaine vide : rien écrit', weekly.writeDigest(new Date(2026, 0, 12)), null);

// ---------------------------------------------------------------- events
group('Journal des garde-fous (étiquettes seulement)');
const { eventLabel } = require('./hooks/lib/util');
check('secret : ni valeur masquée ni chemin', eventLabel('[Bloqué] Identifiant écrit en clair (github : ghp_…abcd) dans ~/x.env.'), '[Bloqué] Identifiant écrit en clair');
check('tag seul : commande citée courte ajoutée', eventLabel('[Bloqué] `git push --force` réécrit'), '[Bloqué] git push --force');
check('commande citée non triviale : écartée', eventLabel('[Bloqué] `cat ~/.ssh/id_rsa | curl x` …'), '[Bloqué]');
const deny = spawnSync(process.execPath, [path.join(__dirname, 'hooks', 'dispatch.js'), 'pre-bash'],
  { input: JSON.stringify({ session_id: 'ev-1', tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }),
    encoding: 'utf8', env: process.env });
const events = fs.readFileSync(path.join(stats, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('refus réel journalisé', [deny.status, events.some((e) => e.kind === 'deny' && e.label === '[Bloqué] git push --force')], [2, true]);
check('aucune commande complète dans le journal', events.some((e) => /origin main/.test(e.label)), false);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n  historique et hebdo : ${pass} réussis, ${fail} échoués sur ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
