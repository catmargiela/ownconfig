#!/usr/bin/env node
'use strict';
/**
 * Tests de la compression des sorties Bash (hooks/lib/compress/).
 * Lancé par `node test.js` ; utilisable seul : `node test-compress.js`.
 *
 * Tout ce qui s'exécute (dispatcher, wrapper) tourne avec un HOME temporaire :
 * rien n'est écrit dans le vrai ~/.claude.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const LIB = path.join(ROOT, 'hooks', 'lib', 'compress');
const DISPATCH = path.join(ROOT, 'hooks', 'dispatch.js');
const WRAP = path.join(LIB, 'wrap.js');
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-cmp-')));
const ENV = { ...process.env, HOME, CC_PROFILE: 'standard', CCX_DISABLED: '', CCX_COMPRESS: '', CCX_DEBUG: '1' };
let pass = 0, fail = 0;

function group(name) { console.log(`\n  ${name}`); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}

// ---------------------------------------------------------------- modules
group('Compression : chargement des modules');
const files = ['index.js', 'policy.js', 'engine.js', 'text.js', 'stats.js',
  ...fs.readdirSync(path.join(LIB, 'processors')).map((f) => path.join('processors', f))];
for (const f of files) {
  let err = null;
  try { if (f !== 'wrap.js') require(path.join(LIB, f)); } catch (e) { err = e.message; }
  check(`${f} se charge`, err, null);
}
const { eligible } = require('./hooks/lib/compress/policy');
const { compress } = require('./hooks/lib/compress/engine');
const processors = require('./hooks/lib/compress/processors');
check('generic en dernier dans le registre', processors.list[processors.list.length - 1].name, 'generic');

// ---------------------------------------------------------------- régressions sécurité
group('Compression : injection par saut de ligne (régression)');
const { rewrite } = require('./hooks/lib/compress/index');
const NL_INJECT = "git log 'foo\ntouch /tmp/ccx_should_not_exist #'";
check('saut de ligne entre apostrophes refusé par la politique', eligible(NL_INJECT).ok, false);
check('retour chariot refusé', eligible("git log 'a\rb'").ok, false);
check('séparateurs de ligne Unicode (NEL, LS, PS) refusés',
  ['\u0085', '\u2028', '\u2029'].map((c) => eligible(`git log 'a${c}b'`).ok), [false, false, false]);
check('rewrite() refuse une commande multi-ligne', rewrite(NL_INJECT), null);
const nlRun = spawnSync('node', [DISPATCH, 'pre-bash'], {
  input: JSON.stringify({ session_id: 'nl-inject', cwd: HOME, tool_name: 'Bash', tool_input: { command: NL_INJECT } }),
  encoding: 'utf8', env: ENV,
});
check('dispatcher : commande multi-ligne jamais réécrite', /updatedInput/.test(nlRun.stdout || ''), false);

group('Garde Bash : apostrophes fidèles au shell (régression)');
const { stripQuoted } = require('./hooks/lib/pre-bash');
const RM = 'r' + 'm -rf x';
check("`'a\\'` se ferme au second ' : la suite reste analysée",
  stripQuoted(`ls 'a\\' ; ${RM} ; echo '`).includes(RM), true);
check('contenu cité toujours neutralisé', stripQuoted(`git commit -m '${RM}'`).includes(RM), false);
check('guillemets : \\" échappé', stripQuoted(`echo "a \\" ${RM}"`).includes(RM), false);
const qRun = spawnSync('node', [DISPATCH, 'pre-bash'], {
  input: JSON.stringify({ session_id: 'quote-bypass', cwd: HOME, tool_name: 'Bash', tool_input: { command: `ls 'a\\' ; ${RM} ; echo '` } }),
  encoding: 'utf8', env: ENV,
});
check('dispatcher : rm -rf après une apostrophe piégée déclenche le gate (exit 2)', qRun.status, 2);

// ---------------------------------------------------------------- policy
group('Compression : liste blanche');
const ALLOWED = ['git status', 'git log', 'git -C sub diff HEAD~3', '/usr/bin/git show HEAD', 'go test ./...', 'go vet ./...',
  'go build ./cmd/app', 'npx tsc --noEmit', 'bunx tsc', 'npx eslint src', 'golangci-lint run ./...', 'npx next build',
  'bun run build', 'npm run build', 'pnpm build', 'bun test', 'npx vitest run', 'npx jest', 'cargo clippy', 'cargo test',
  'docker ps -a', 'docker images', 'docker build -t app .', 'docker compose logs api', 'docker compose -f dev.yml ps',
  'ls -la', "find . -name '*.ts'", 'tree -L 2', 'rg -n "fetch config" src', 'grep -rn TODO src', 'gh pr checks',
  'gh run list', 'git log --follow -- a.ts'];
for (const c of ALLOWED) check(`réécrite : ${c}`, eligible(c).ok, true);
const REFUSED = ['git push', 'git commit -m x', 'git checkout .', 'rm -rf dist', 'git status && git log', 'git log; ls',
  'git log || true', 'ls | head', 'ls > out.txt', 'ls 2> err.txt', 'ls &> all.txt', 'ls < in', 'ls &', 'git log\nls',
  'echo $(id)', 'ls `id`', 'git log "$(id)"', 'cat <<EOF', 'diff <(ls) <(ls)', 'CCX_RAW=1 git log', 'FOO=1 go test',
  'sudo ls', 'tail -f app.log', 'watch ls', 'top', 'npx vitest', 'docker compose up', 'docker compose logs -f',
  'docker compose logs --follow api', 'gh pr list --json number', 'kubectl get pods -o json', 'git status --porcelain',
  'git log --format=%h', 'go test -json ./...', 'eslint --fix .', 'find . -delete', 'find . -exec rm {} +',
  'rg --pre ./x foo', 'git -c core.pager=x log', 'npm run build -- --x', 'npx jest -u', "ls 'a\\' ; rm -rf x ; echo '",
  '/tmp/x/git status', 'node wrap.js Z2l0', 'ls # commentaire', 'python3', 'gh run view --log', 'docker build --push .'];
for (const c of REFUSED) check(`non réécrite : ${JSON.stringify(c)}`, eligible(c).ok, false);

// ---------------------------------------------------------------- dispatcher
group('Compression : intégration au dispatcher');
const pb = (command, env = {}, extra = {}) => {
  const r = spawnSync('node', [DISPATCH, 'pre-bash'], {
    input: JSON.stringify({ session_id: 'cmp-test', hook_event_name: 'PreToolUse', cwd: ROOT, tool_name: 'Bash',
      tool_input: { command, description: 'd', ...extra } }),
    encoding: 'utf8', env: { ...ENV, ...env },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reste null */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
};
const rw = pb('git log');
const updated = rw.json && rw.json.hookSpecificOutput && rw.json.hookSpecificOutput.updatedInput;
check('git log : sortie 0', rw.code, 0);
check('updatedInput.command → wrap.js + base64', /^node '.*wrap\.js' [A-Za-z0-9+/=]+ # 'git log'$/.test(updated && updated.command), true);
check('autres champs de tool_input conservés', updated && updated.description, 'd');
check('aucune décision de permission', /permissionDecision/.test(rw.out), false);
check('hookEventName PreToolUse', rw.json && rw.json.hookSpecificOutput.hookEventName, 'PreToolUse');
check('aucune erreur interne', /\[ccx:/.test(rw.err), false);
const forced = pb('git push --force origin main');
check('refus pre-bash conservé : sortie 2', forced.code, 2);
check('commande refusée jamais réécrite', /updatedInput/.test(forced.out), false);
check('git push : ni refus ni réécriture', [pb('git push').code, pb('git push').out], [0, '']);
check('profil minimal : pas de réécriture', pb('git log', { CC_PROFILE: 'minimal' }).out, '');
check('CCX_DISABLED=1 : pas de réécriture', pb('git log', { CCX_DISABLED: '1' }).out, '');
check('CCX_COMPRESS=off : pas de réécriture', pb('git log', { CCX_COMPRESS: 'off' }).out, '');
check('préfixe CCX_RAW=1 : pas de réécriture', pb('CCX_RAW=1 git log').out, '');
check('commande en arrière-plan : pas de réécriture', pb('git log', {}, { run_in_background: true }).out, '');
const both = pb('ls *.nomatch-ext');
check('avertissement + réécriture dans UN seul JSON',
  [Boolean(both.json && both.json.hookSpecificOutput.additionalContext), Boolean(both.json && both.json.hookSpecificOutput.updatedInput)],
  [true, true]);

// ---------------------------------------------------------------- wrapper
group('Compression : wrapper');
const b64 = (c) => Buffer.from(c, 'utf8').toString('base64');
const wrap = (command, cwd = ROOT, extraArgs = []) => {
  const r = spawnSync('node', [...extraArgs, WRAP, b64(command)], { cwd, encoding: 'utf8', env: { ...ENV, SHELL: '/bin/sh' } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const big = path.join(HOME, 'big');
fs.mkdirSync(big);
for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(big, `file-${String(i).padStart(3, '0')}.${['ts', 'md', 'go'][i % 3]}`), '');
const small = path.join(HOME, 'small');
fs.mkdirSync(small);
for (const f of ['a.ts', 'b.ts', 'c.md']) fs.writeFileSync(path.join(small, f), '');

const direct = spawnSync('/bin/sh', ['-c', 'ls'], { cwd: small, encoding: 'utf8' }).stdout;
check('petite sortie : identique à la commande seule', wrap('ls', small).out, direct);
const found = wrap('find . -type f', big);
check('grosse sortie : compressée + pied de page', [found.code, /\[ccx: sortie compressée \d+→\d+ car\. \(listing\) — CCX_RAW=1 find \. -type f pour la sortie brute\]\n$/.test(found.out)], [0, true]);
const notRepo = wrap('git log', HOME);
check('échec : code de sortie conservé (git hors dépôt → 128)', notRepo.code, 128);
check('échec : erreur sur stderr, stdout vide', [/not a git repository/i.test(notRepo.err), notRepo.out], [true, '']);
const mixed = wrap(`ls ${big} /nonexistent-ccx-dir`, HOME);
check('sortie compressée + échec : code ≠ 0 conservé', mixed.code !== 0, true);
check('stderr reste sur stderr', [/nonexistent-ccx-dir/.test(mixed.err), /nonexistent-ccx-dir/.test(mixed.out.split('\n').slice(0, -2).join('\n'))], [true, false]);
check('échec compressé : pied de page présent', /\[ccx: sortie compressée/.test(mixed.out), true);
const raw = spawnSync('/bin/sh', ['-c', 'find . -type f'], { cwd: big, encoding: 'utf8' }).stdout;
const preload = path.join(HOME, 'throw.js');
fs.writeFileSync(preload, `require(${JSON.stringify(path.join(LIB, 'engine.js'))}).compress = () => { throw new Error('boom'); };\n`);
const broken = wrap('find . -type f', big, ['-r', preload]);
check('erreur interne → sortie brute intacte, même code', [broken.out === raw, broken.code], [true, 0]);
check('commande non éligible : exécutée telle quelle', [wrap('echo bonjour').out, wrap('echo bonjour').code], ['bonjour\n', 0]);
check('signal → 128 + n', wrap('kill -TERM $$').code, 143);
const bad = spawnSync('node', [WRAP, '***'], { encoding: 'utf8', env: ENV });
check('base64 illisible → sortie 2, message', [bad.status, /illisible/.test(bad.stderr)], [2, true]);

// ---------------------------------------------------------------- stats
group('Compression : statistiques');
const statsFile = path.join(HOME, '.claude', 'state', 'ccx', 'compress-stats.jsonl');
const rows = fs.existsSync(statsFile) ? fs.readFileSync(statsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const last = rows.find((r) => r.cmd === 'find' && r.after < r.before);
check('une ligne JSONL par commande enveloppée', rows.length >= 3, true);
check('champs exacts, aucun contenu de sortie', last && Object.keys(last).sort(), ['after', 'before', 'cmd', 'exit', 'processor', 'ts']);
check('commande réduite aux deux premiers mots', rows.some((r) => r.cmd === 'git log'), true);
check('aucun nom de fichier stocké', /file-\d{3}/.test(fs.readFileSync(statsFile, 'utf8')), false);
fs.writeFileSync(statsFile, '{"x":1}\n'.repeat(140000));
spawnSync('node', ['-e', `require(${JSON.stringify(path.join(LIB, 'stats.js'))}).record({ ts: 't' })`], { env: ENV });
check('fichier élagué au-delà de 1 Mo', fs.statSync(statsFile).size < 1024 * 1024, true);

// ---------------------------------------------------------------- récupération
group('Compression : récupération des lignes critiques');
const buried = [...Array(400)].map((_, i) => `line ${i}`);
buried[200] = 'Error: connection refused on port 5432';
const gen = compress('git log', buried.join('\n'), { exitCode: 1, processor: 'git' });
check('échec sans handlesFailure → generic', gen.processor, 'generic');
check('erreur au milieu conservée', gen.text.includes('Error: connection refused on port 5432'), true);
const lostByProcessor = compress('ls', 'x\n'.repeat(10) + 'fatal: disk quota exceeded\n' + 'y\n'.repeat(3000),
  { exitCode: 2, processor: 'generic' });
check('ligne critique présente après compression', lostByProcessor.text.includes('fatal: disk quota exceeded'), true);
const commitBody = [...Array(60)].map((_, i) => `commit ${String(i).padStart(40, 'a')}\nAuthor: A <a@example.com>\nDate:   x\n\n    fix: error handling ${i}\n\n    body mentions a failure and EXISTS\n`).join('\n');
check('git en succès : pas de fausse récupération (messages de commit)',
  /récupérée/.test(compress('git log', commitBody, { exitCode: 0, processor: 'git' }).text), false);
check('sortie non raccourcie → brute', compress('git status', 'On branch main\n', { exitCode: 0, processor: 'git' }).changed, false);

// ---------------------------------------------------------------- qualité
group('Compression : seuils de qualité par processeur');
const FIXTURES = [
  ...require('./tests/compress/fixtures-vcs-tests'),
  ...require('./tests/compress/fixtures-build-lint'),
  ...require('./tests/compress/fixtures-misc'),
];
for (const f of FIXTURES) {
  const verdict = eligible(f.cmd);
  const r = compress(f.cmd, f.input, { exitCode: f.exitCode, stream: f.stream || 'stdout', processor: verdict.processor });
  const saved = Math.round(100 * (1 - r.text.length / f.input.length));
  const missing = f.mustPreserve.filter((s) => !f.input.includes(s) || !r.text.includes(s));
  check(`${f.name} (${verdict.processor}, exit ${f.exitCode}) : ${saved} % ≥ ${f.minSavingsPercent} %, rien de perdu`,
    [verdict.ok, missing, saved >= f.minSavingsPercent], [true, [], true]);
}

fs.rmSync(HOME, { recursive: true, force: true });
console.log(`\n  compression : ${pass} réussis, ${fail} échoués sur ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
