#!/usr/bin/env node
'use strict';
/**
 * Work sessions (/startsession, /endsession) and vault history.
 * Launched by `node test.js`; usable alone. Temporary HOME, vault and history
 * repository: the real ones are never touched.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-ws-')));
const HOME = path.join(TMP, 'home');
const VAULT = path.join(TMP, 'vault');
const GIT_DIR = path.join(TMP, 'history.git');
const ROOT = path.join(VAULT, 'Claude');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'Projets'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'Journal'), { recursive: true });
Object.assign(process.env, { HOME, CC_VAULT: VAULT, CC_VAULT_HISTORY_DIR: GIT_DIR, CC_VAULT_DISABLED: '',
  CC_VAULT_HISTORY: '', CCX_DISABLED: '', CC_PROFILE: 'standard' });

let pass = 0, fail = 0;
const group = (name) => console.log(`\n  ${name}`);
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const { STATE_DIR, writeState } = require('./hooks/lib/util');
const ws = require('./hooks/lib/vault/worksession');
const history = require('./hooks/lib/vault/history');

const repo = path.join(TMP, 'acme-shop');
fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feat/cart\n');
const journalOf = () => path.join(ROOT, 'Journal', fs.readdirSync(path.join(ROOT, 'Journal')).find((f) => f.endsWith('— acme-shop.md')) || 'absent');
const at = (h, m) => new Date(2026, 10, 16, h, m);

// ---------------------------------------------------------------- status line
group('Barre de statut : coût de la conversation enregistré');
const statusline = (payload) => spawnSync('bash', [path.join(__dirname, 'bin', 'statusline.sh')],
  { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, HOME } });
const HAS_JQ = spawnSync('jq', ['--version']).status === 0;
if (HAS_JQ) {
  const payload = { workspace: { current_dir: repo }, session_id: 'sess-line',
    cost: { total_cost_usd: 1.2345, total_duration_ms: 60000, total_lines_added: 12, total_lines_removed: 3 } };
  statusline(payload);
  check('fichier <session>.cost.json écrit', ws.costOf('sess-line'), { cost: 1.2345, added: 12, removed: 3 });
  statusline({ ...payload, session_id: '../evil' });
  check('identifiant de session non sûr : rien écrit', fs.readdirSync(STATE_DIR).filter((f) => f.endsWith('.cost.json')), ['sess-line.cost.json']);
  check('aucun fichier temporaire laissé', fs.readdirSync(STATE_DIR).some((f) => /cost\.json\./.test(f)), false);
} else console.log('    (jq absent : barre de statut non testée)');

// ---------------------------------------------------------------- start / end
group('Session de travail : ouverture et fermeture');
writeState('sess-1', 'cost', { cost: 2, added: 100, removed: 10 });
const s1 = ws.start('sess-1', repo, at(14, 2));
check('première session : projet, branche, pas de précédent', [s1.project, s1.branch, s1.previous], ['acme-shop', 'feat/cart', null]);
check('texte d\'ouverture', ws.describeStart(s1).split('\n')[0], 'Session ouverte — acme-shop · lun. 16/11 à 14:02 · branche feat/cart');
writeState('sess-1', 'cost', { cost: 8.125, added: 512, removed: 106 });
const e1 = ws.end('sess-1', repo, 'Fait :\n- panier livré\nReste :\n- tests du paiement [[Page]] <!-- x -->', at(17, 40));
check('ouverte en cours de conversation : seule la différence compte', [e1.cost, e1.added, e1.removed], [6.125, 412, 96]);
check('texte de fermeture : heures, durée, coût, lignes',
  ws.describeEnd(e1).split('\n')[0], 'Session fermée — acme-shop · 14:02 → 17:40 (3 h 38 · 6,13 $ · +412 / −96 lignes)');
const j1 = read(journalOf());
check('journal : bloc balisé avec chiffres et bilan', [
  j1.includes('<!-- claude:worksession:sess-1:start -->\n## Session de travail 14:02 → 17:40\n3 h 38 · 6,13 $ · +412 / −96 lignes'),
  j1.includes('- panier livré'), j1.includes('[[Page]]'), j1.includes('<!-- x -->')], [true, true, false, false]);
ws.end('sess-1', repo, 'Fait :\n- panier livré, corrigé', at(17, 45));
check('fermée deux fois : bloc réécrit, pas doublé', [(read(journalOf()).match(/claude:worksession:sess-1:start/g) || []).length, read(journalOf()).includes('corrigé')], [1, true]);

group('Session suivante : ce qui a été fait avant');
const s2 = ws.start('sess-2', repo, at(9, 0));
check('précédente fermée : heures, coût et bilan rappelés', [s2.previous.closed, s2.previous.cost, s2.previous.bilan.includes('corrigé')], [true, 6.125, true]);
check('texte : dernière fois', /Dernière fois \(lun\. 16\/11, 14:02 → 17:45, 3 h 43 · 6,13 \$ · \+412 \/ −96 lignes\) :\nFait :/.test(ws.describeStart(s2)), true);
writeState('sess-2', 'cost', { cost: 3.5, added: 5, removed: 0 });
const s3 = ws.start('sess-3', repo, at(11, 0));
check('précédente non fermée : signalée avec son dernier coût connu', [s3.previous.closed, s3.previous.cost], [false, 3.5]);
check('texte : non fermée', ws.describeStart(s3).includes('non fermée par /endsession — dernier coût connu : 3,50 $'), true);
check('un autre projet ne voit pas ces sessions', ws.start('sess-4', path.join(TMP, 'other-repo'), at(11, 5)).previous, null);

group('Session relancée, compteur remis à zéro');
writeState('sess-r', 'cost', { cost: 1, added: 0, removed: 0 });
ws.start('sess-r', repo, at(9, 0));
ws.end('sess-r', repo, 'premier tour', at(10, 0));
ws.start('sess-r', repo, at(14, 0));
const reopened = ws.previous('acme-shop', 'sess-y');
check('même conversation rouverte après une fermeture : vue comme ouverte, pas fermée à 10 h',
  [reopened.closed, ws.describeStart({ project: 'acme-shop', startedAt: at(15, 0).toISOString(), branch: '', previous: reopened, recent: [] }).includes('14:00) non fermée')], [false, true]);
ws.end('sess-r', repo, 'second tour', at(16, 0));
const closedAgain = ws.previous('acme-shop', 'sess-y');
check('refermée : la fin retenue est celle du second tour', [closedAgain.closed, closedAgain.bilan, closedAgain.endedAt > closedAgain.startedAt], [true, 'second tour', true]);
writeState('sess-z', 'cost', { cost: 9, added: 50, removed: 5 });
ws.start('sess-z', repo, at(16, 30));
writeState('sess-z', 'cost', { cost: 2, added: 7, removed: 1 });
const restarted = ws.end('sess-z', repo, '', at(17, 0));
check('compteur de coût reparti de zéro : compté en entier, jamais 0 $', [restarted.cost, restarted.added, restarted.removed], [2, 7, 1]);
const leaked = ws.end('sess-k', repo, `Fait :\n- clé posée : ${'ghp_' + 'a1B2c3D4e5'.repeat(4)}\n- fini`, at(17, 5));
check('secret dans le bilan : retiré avant écriture', [leaked.bilan.includes('ghp_'), leaked.bilan.includes('[secret retiré]'), read(journalOf()).includes('ghp_')], [false, true, false]);

group('Cas limites');
writeState('sess-5', 'cost', { cost: 4, added: 1, removed: 1 });
const e5 = ws.end('sess-5', repo, '', at(12, 0));
check('fermeture sans ouverture : chiffres de toute la conversation, et c\'est dit',
  [e5.opened, e5.cost, ws.describeEnd(e5).includes('pas de /startsession')], [false, 4, true]);
const e6 = ws.end('sess-6', repo, '', at(12, 5));
check('barre de statut jamais passée : coût inconnu, pas zéro', [e6.cost, ws.describeEnd(e6).includes('coût inconnu')], [null, true]);
check('bilan plafonné', ws.end('sess-7', repo, 'x'.repeat(5000), at(12, 6)).bilan.length, 1500);
fs.appendFileSync(ws.LEDGER, 'pas du json\n');
check('ligne illisible dans le registre : ignorée', ws.previous('acme-shop', 'zzz') !== null, true);
const cli = (args, input) => spawnSync(process.execPath, [path.join(__dirname, 'bin', 'work-session.js'), ...args], { input: input || '', encoding: 'utf8', cwd: repo });
check('CLI : identifiant invalide ou absent → sortie 2, rien sur stdout',
  [cli(['start', '${CLAUDE_SESSION_ID}']), cli(['end']), cli(['autre', 'sess-9'])].map((r) => [r.status, r.stdout]), [[2, ''], [2, ''], [2, '']]);
const run = cli(['end', 'sess-8', '--json'], 'Fait :\n- \x1b[31mcli\n');
check('CLI : bilan lu sur stdin, séquences d\'échappement neutralisées', [run.status, JSON.parse(run.stdout).bilan], [0, 'Fait :\n- ?[31mcli']);
process.env.CC_VAULT_DISABLED = '1';
const off = spawnSync(process.execPath, [path.join(__dirname, 'bin', 'work-session.js'), 'end', 'sess-off'], { input: '', encoding: 'utf8', cwd: repo, env: process.env });
check('vault désactivé : coût rendu quand même, journal non écrit', [off.status, off.stdout.includes('Journal non écrit')], [0, true]);
process.env.CC_VAULT_DISABLED = '';

// ---------------------------------------------------------------- history
group('Historique du vault (git hors du vault)');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const gitH = (args) => spawnSync('git', [`--git-dir=${GIT_DIR}`, ...args], { encoding: 'utf8' }).stdout.trim();
const commits = () => Number(gitH(['rev-list', '--count', 'HEAD']) || 0);
const note = path.join(ROOT, 'Projets', 'demo.md');
if (HAS_GIT) {
  fs.writeFileSync(note, '# Demo\n\n- décision A\n');
  check('premier passage : un commit', [history.snapshot('test', 'sess-1'), commits()], [true, 1]);
  check('rien de changé : aucun commit', [history.snapshot('test', 'sess-1'), commits()], [false, 1]);
  fs.appendFileSync(note, '- décision B\n');
  fs.writeFileSync(path.join(ROOT, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(ROOT, 'Projets', 'demo.md.tmp.123'), 'partial');
  check('modification : nouveau commit', [history.snapshot('test', 'sess-2'), commits()], [true, 2]);
  check('fichiers temporaires exclus', gitH(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter((f) => /tmp|DS_Store/.test(f)), []);
  check('aucun .git dans le vault, aucun remote', [fs.existsSync(path.join(ROOT, '.git')), fs.existsSync(path.join(VAULT, '.git')), gitH(['remote'])], [false, false, '']);
  check('version précédente récupérable', gitH(['show', 'HEAD~1:Projets/demo.md']), '# Demo\n\n- décision A');
  fs.mkdirSync(path.join(HOME, 'bin'), { recursive: true });
  const marker = path.join(TMP, 'filter-ran');
  fs.writeFileSync(path.join(HOME, '.gitconfig'), `[filter "evil"]\n\tclean = touch ${marker}; cat\n`);
  fs.writeFileSync(path.join(ROOT, '.gitattributes'), '* filter=evil\n');
  fs.appendFileSync(note, '- décision filtrée\n');
  const inherited = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  Object.assign(process.env, { GIT_DIR: path.join(TMP, 'elsewhere.git'), GIT_WORK_TREE: TMP });
  check('.gitattributes hostile + filtre dans ~/.gitconfig + GIT_DIR hérité : commit fait, filtre jamais lancé',
    [history.snapshot('test', 'sess-3'), fs.existsSync(marker), fs.existsSync(path.join(TMP, 'elsewhere.git'))], [true, false, false]);
  for (const [k, val] of Object.entries(inherited)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
  fs.unlinkSync(path.join(ROOT, '.gitattributes'));
  history.snapshot('test', 'sess-3');
  const n0 = commits();
  check('résumé pour le doctor', history.summary().commits, n0);
  process.env.CC_VAULT_HISTORY = 'off';
  fs.appendFileSync(note, '- C\n');
  check('CC_VAULT_HISTORY=off : rien', [history.snapshot('test'), commits()], [false, n0]);
  process.env.CC_VAULT_HISTORY = '';
  const d = spawnSync(process.execPath, [path.join(__dirname, 'hooks', 'dispatch.js'), 'stop'],
    { input: JSON.stringify({ session_id: 'vh-e2e', cwd: TMP, hook_event_name: 'Stop' }), encoding: 'utf8',
      env: { ...process.env, CC_CONTEXT_MONITOR: 'off', CCX_NOTIFY: 'off' }, timeout: 20000 });
  check('fin de réponse réelle via le dispatcher : commit, sortie 0', [d.status, commits()], [0, n0 + 1]);
  const broken = spawnSync(process.execPath, [path.join(__dirname, 'hooks', 'dispatch.js'), 'stop'],
    { input: JSON.stringify({ session_id: 'vh-bad', cwd: TMP, hook_event_name: 'Stop' }), encoding: 'utf8',
      env: { ...process.env, CC_VAULT_HISTORY_DIR: path.join(note, 'history.git'), CC_CONTEXT_MONITOR: 'off', CCX_NOTIFY: 'off' }, timeout: 20000 });
  check('dépôt d\'historique inutilisable : la fin de réponse passe quand même', broken.status, 0);
  const linked = path.join(TMP, 'vault-link');
  fs.mkdirSync(linked);
  fs.symlinkSync(path.join(TMP, 'acme-shop'), path.join(linked, 'Claude'));
  const viaLink = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require('./hooks/lib/vault/history').snapshot('test')))"],
    { cwd: __dirname, encoding: 'utf8', env: { ...process.env, CC_VAULT: linked, CC_VAULT_HISTORY_DIR: path.join(TMP, 'link.git') } });
  check('dossier Claude/ qui est un lien : rien enregistré', [viaLink.stdout, fs.existsSync(path.join(TMP, 'link.git'))], ['false', false]);
} else console.log('    (git absent : historique non testé)');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n  sessions de travail, historique : ${pass} réussis, ${fail} échoués sur ${pass + fail}`);
process.exit(fail ? 1 : 0);
