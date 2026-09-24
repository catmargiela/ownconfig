#!/usr/bin/env node
'use strict';
/**
 * Tests of the hook-bypass refusals, loop-guard, delivery-check, turn-timer and
 * the Go/Rust part of the Stop quality gate.
 * Launched by `node test.js`; usable alone: `node test-port.js`.
 * Temporary HOME and vault: the real ~/.claude is never touched, and no real
 * desktop notification is ever sent (threshold set out of reach).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DISPATCH = path.join(__dirname, 'hooks', 'dispatch.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-port-')));
const HOME = path.join(TMP, 'home');
const VAULT = path.join(TMP, 'vault');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(VAULT, { recursive: true });
const ENV = { ...process.env, HOME, CC_VAULT: VAULT, CC_PROFILE: 'standard', CCX_DISABLED: '', CCX_COMPRESS: 'off',
  CC_CONTEXT_MONITOR: 'off', CCX_NOTIFY_AFTER: '99999999', CCX_NO_TYPECHECK: '', CCX_DELIVERY_CHECK: '', CCX_LOOP_GUARD: '' };
let pass = 0, fail = 0, skip = 0;

function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
function hook(event, input, env = {}) {
  const r = spawnSync(process.execPath, [DISPATCH, event], { input: JSON.stringify(input), encoding: 'utf8', env: { ...ENV, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reste null */ }
  return { code: r.status, err: r.stderr || '', out: r.stdout || '', json };
}
const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
let sid = 0;
const bash = (command, id = `port-${++sid}`) => hook('pre-bash', { session_id: id, cwd: TMP, tool_name: 'Bash', tool_input: { command } });

// ---------------------------------------------------------------- hook bypass
group('Contournement des hooks git');
for (const c of ['git push --no-verify origin x', 'git merge --no-verify main', 'git rebase --no-verify main',
  'git pull --no-verify', 'HUSKY=0 git commit -m "feat: x"', 'cd a && HUSKY=0 git push',
  'git -c core.hooksPath=/dev/null commit -m x', 'git -c "core.hooksPath=/dev/null" push', 'git -c CORE.HOOKSPATH=x merge y',
  'git config core.hooksPath /tmp/h', 'git config --local core.hooksPath .nohooks']) {
  check(`refusé : ${c}`, bash(c).code, 2);
}
for (const c of ['git push -n origin x', 'git push origin x', 'git config core.hooksPath', 'git config --get core.hooksPath',
  'echo "HUSKY=0 git commit"', 'git commit -m "docs: explain --no-verify on push"', 'git log --oneline']) {
  check(`autorisé : ${c}`, bash(c).code, 0);
}

// ---------------------------------------------------------------- loop-guard
group('Détection de boucle (loop-guard)');
const { step, LOOP_AT } = require('./hooks/lib/loop-guard');
let st = null;
const fires = [];
for (let i = 0; i < 6; i++) { const r = step(st, 'go test ./...'); st = r.state; fires.push(r.fire); }
check(`une seule alerte, au ${LOOP_AT}e appel identique`, fires, [false, false, false, true, false, false]);
check('espaces normalisés : même commande', step(step(null, 'go  test ./...').state, 'go test ./...').count, 2);
check('autre commande : compteur remis à 1', step(st, 'go vet ./...').count, 1);
const loopSid = 'port-loop';
const runs = [1, 2, 3, 4, 5].map(() => bash('ls -la', loopSid));
check('e2e : muet puis alerte au 4e, jamais bloquant', runs.map((r) => [r.code, /\[Boucle\]/.test(r.out)]),
  [[0, false], [0, false], [0, false], [0, true], [0, false]]);
check('e2e : note visible par le modèle', /\[Boucle\]/.test(runs[3].json && runs[3].json.hookSpecificOutput.additionalContext), true);
check('CCX_LOOP_GUARD=off : muet', [1, 2, 3, 4].map(() => hook('pre-bash',
  { session_id: 'port-loop-off', cwd: TMP, tool_name: 'Bash', tool_input: { command: 'ls' } }, { CCX_LOOP_GUARD: 'off' }).out).join(''), '');

// ---------------------------------------------------------------- delivery-check
group('Excuses en fin de réponse (delivery-check)');
const { findPhrases, lastAssistantText } = require('./hooks/lib/delivery-check');
const keys = (t) => findPhrases(t).map((p) => p.key);
check('FR : bug préexistant', keys('Le test rouge est un bug préexistant.'), ['preexisting']);
check('EN : pre-existing + skipping tests', keys('This is pre-existing; skipping the tests for now.'), ['preexisting', 'skip-tests']);
check('FR : hors périmètre / devrait marcher', keys('Hors périmètre. Ça devrait maintenant marcher.'), ['unrelated', 'should-work']);
check('réponse prouvée : rien', keys('Tests : 152 réussis, 0 échoués (node test.js).'), []);
check('déjà signalé dans la session : ignoré', findPhrases('bug préexistant', { preexisting: 1 }).length, 0);
const transcript = path.join(TMP, 't.jsonl');
const line = (role, text) => JSON.stringify({ message: { role, content: [{ type: 'text', text }] } });
fs.writeFileSync(transcript, [line('user', 'fix it'), line('assistant', 'old: skipping tests'), '{bad',
  line('assistant', 'Corrigé. Le reste est un bug préexistant.'), line('user', 'tool result')].join('\n') + '\n');
check('dernier message assistant lu en fin de transcript', lastAssistantText(transcript), 'Corrigé. Le reste est un bug préexistant.');
check('transcript absent : vide, sans erreur', lastAssistantText(path.join(TMP, 'nope.jsonl')), '');
const stop = (id, env) => hook('stop', { session_id: id, cwd: TMP, hook_event_name: 'Stop', transcript_path: transcript }, env);
const s1 = stop('port-deliv');
check('Stop : avertissement pour toi, sortie 0', [s1.code, /\[Livraison\].*préexistant/.test(s1.json && s1.json.systemMessage)], [0, true]);
check('Stop suivant : plus répété', stop('port-deliv').out, '');
check('CCX_DELIVERY_CHECK=off : muet', stop('port-deliv-off', { CCX_DELIVERY_CHECK: 'off' }).out, '');

// ---------------------------------------------------------------- turn-timer
group('Notification de fin de réponse (turn-timer)');
const { duration } = require('./hooks/lib/turn-timer');
check('durées', [duration(42), duration(192), duration(3600)], ['42 s', '3 min 12', '60 min 00']);
const turnFile = path.join(HOME, '.claude', 'state', 'ccx', 'port-turn.turn.json');
hook('prompt', { session_id: 'port-turn', hook_event_name: 'UserPromptSubmit', prompt: 'x' });
const started = fs.existsSync(turnFile) && typeof JSON.parse(fs.readFileSync(turnFile, 'utf8')).start === 'number';
check(process.platform === 'darwin' ? 'macOS : début du tour enregistré' : 'hors macOS : rien enregistré', started, process.platform === 'darwin');
hook('stop', { session_id: 'port-turn', cwd: TMP, hook_event_name: 'Stop' });
check('Stop sous le seuil : état vidé, aucune notification', fs.existsSync(turnFile) ? JSON.parse(fs.readFileSync(turnFile, 'utf8')) : {}, {});

// ---------------------------------------------------------------- Go / Rust
group('Gate qualité Go (gofmt, go vet)');
if (!has('go') || !has('gofmt')) { skip++; console.log('    SKIP go absent'); } else {
  const mod = path.join(TMP, 'gomod');
  fs.mkdirSync(path.join(mod, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(mod, 'go.mod'), 'module example.com/m\n\ngo 1.21\n');
  const bad = path.join(mod, 'pkg', 'a.go');
  fs.writeFileSync(bad, 'package pkg\nimport "fmt"\nfunc F(){   fmt.Printf("%d\\n", "x") }\n');
  hook('post-edit', { session_id: 'port-go', tool_name: 'Edit', tool_input: { file_path: bad } });
  const r = hook('stop', { session_id: 'port-go', cwd: mod, hook_event_name: 'Stop' });
  check('gofmt appliqué en silence', fs.readFileSync(bad, 'utf8').includes('func F() {'), true);
  check('go vet : gate bloquant avec la ligne en cause', [r.code, /a\.go:\d+:\d+: .*Printf/.test(r.err)], [2, true]);
  fs.writeFileSync(bad, 'package pkg\n\nimport "fmt"\n\nfunc F() { fmt.Printf("%s\\n", "x") }\n');
  hook('post-edit', { session_id: 'port-go-ok', tool_name: 'Edit', tool_input: { file_path: bad } });
  check('code sain : Stop passe', hook('stop', { session_id: 'port-go-ok', cwd: mod, hook_event_name: 'Stop' }).code, 0);
  hook('post-edit', { session_id: 'port-go-off', tool_name: 'Edit', tool_input: { file_path: bad } });
  fs.writeFileSync(bad, 'package pkg\n\nimport "fmt"\n\nfunc F() { fmt.Printf("%d\\n", "x") }\n');
  check('CCX_NO_TYPECHECK=1 : go vet sauté', hook('stop', { session_id: 'port-go-off', cwd: mod, hook_event_name: 'Stop' },
    { CCX_NO_TYPECHECK: '1' }).code, 0);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n  portage : ${pass} réussis, ${fail} échoués, ${skip} ignorés sur ${pass + fail + skip}\n`);
process.exit(fail ? 1 : 0);
