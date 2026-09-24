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
const files = ['index.js', 'policy.js', 'policy-families.js', 'engine.js', 'python.js', 'select.js', 'text.js', 'stats.js',
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

group('Compression : familles token-saver (lecture, build, test)');
const FAMILY_ALLOWED = ['kubectl get pods', 'kubectl -n prod get pods -o wide', 'kubectl describe pod api-1',
  'kubectl logs api-1 --tail 200', 'kubectl logs -p api-1', 'kubectl top pods -A', 'helm list -A', 'helm status app',
  'helm template ./chart', 'helm history app', 'terraform plan', 'terraform -chdir=infra plan', 'terraform validate',
  'terraform fmt -check', 'terraform show', 'tofu plan', 'pulumi preview', 'cdktf synth', 'cdktf diff',
  'ansible-playbook site.yml --check', 'cargo fmt --check', 'npm ci', 'pnpm install --frozen-lockfile',
  'bun install --frozen-lockfile', 'yarn install --immutable', 'npm ls', 'npm outdated', 'npm audit', 'pnpm outdated',
  'yarn audit', 'bun pm ls', 'pip list', 'pip3 freeze', 'pip check', 'poetry show', 'uv pip list', 'mvn test',
  'mvn clean verify', 'gradle build', './gradlew :app:test', './mvnw package', 'just --list', 'mise ls',
  'nix flake show', 'nix flake check', 'jq .name package.json', "yq '.services' compose.yaml",
  'systemctl status nginx', 'journalctl -u nginx -n 200', 'docker logs api --tail 100', 'df -h', 'du -sh .',
  'free -m', 'ps aux', 'uname -a'];
for (const c of FAMILY_ALLOWED) check(`réécrite : ${c}`, eligible(c).ok, true);
const FAMILY_REFUSED = [
  // injection around an allowed command
  'kubectl get pods; rm -rf x', 'terraform plan && terraform apply', 'helm list | sh', 'kubectl get pods || true',
  'kubectl get pods > pods.txt', 'terraform plan $(id)', 'KUBECONFIG=x kubectl get pods', "kubectl get 'a\nb'",
  "jq '.a\n' f.json", 'kubectl get pods &',
  // kubectl: writes, interactive, streaming
  'kubectl delete pod x', 'kubectl apply -f x.yaml', 'kubectl create ns x', 'kubectl exec -it api -- sh',
  'kubectl port-forward svc/api 8080:80', 'kubectl edit deploy api', 'kubectl rollout restart deploy/api',
  'kubectl scale deploy api --replicas=0', 'kubectl logs -f api', 'kubectl logs api --follow', 'kubectl logs -pf api',
  'kubectl get pods -w', 'kubectl get pods --watch', 'kubectl get secret -o json', 'kubectl --kubeconfig x get pods',
  'kubectl get --raw /api', 'kubectl get pods --as admin',
  // helm
  'helm install app ./chart', 'helm upgrade app ./chart', 'helm uninstall app', 'helm rollback app 1',
  'helm template ./chart --post-renderer ./x', 'helm list -o json',
  // terraform / tofu / pulumi / cdktf / ansible
  'terraform apply', 'terraform apply -auto-approve', 'terraform destroy', 'terraform init', 'terraform import a b',
  'terraform plan -out=tf.plan', 'terraform plan -json', 'terraform fmt', 'terraform state rm a', 'tofu apply',
  'pulumi up', 'pulumi destroy', 'pulumi preview --refresh', 'cdktf deploy', 'ansible-playbook site.yml',
  'ansible-playbook site.yml --check --ask-pass', 'ansible-playbook site.yml --check --step',
  // package managers: installs of new code, global, fixes
  'npm install left-pad', 'npm i -g x', 'npm install', 'npm i', 'npm ci -g', 'npm audit fix', 'pnpm install',
  'pnpm add x', 'pnpm install --frozen-lockfile x', 'bun install', 'bun add x', 'yarn install', 'yarn add x',
  'npm ls -g', 'pip install x', 'pip uninstall x', 'poetry install', 'uv pip install x', 'cargo fmt',
  // jvm, task runners, nix
  'mvn deploy', 'mvn install', 'mvn exec:java', 'mvn', 'gradle publish', './gradlew bootRun',
  './gradlew test --continuous', 'gradle build --scan', 'just deploy', 'just', 'mise install', 'mise use node@22',
  'nix flake update', 'nix run .', 'nix flake check --commit-lock-file',
  // jq / yq: in place, no file, environment
  'jq -i .a f.json', 'yq -i .a f.yaml', 'yq --inplace .a f.yaml', 'jq .a', 'jq -n env', 'jq env f.json',
  "jq '$ENV.HOME' f.json", "yq 'strenv(HOME)' f.yaml",
  // system
  'systemctl restart nginx', 'systemctl stop nginx', 'journalctl -f', 'journalctl --follow', 'journalctl -xef',
  'journalctl --vacuum-size=1G', 'docker logs -f api', 'docker logs --follow api', 'docker logs -tf api',
  // excluded families
  'curl https://example.com', 'wget https://example.com', 'ssh host ls', 'scp a host:b', 'psql -c x', 'env',
  'printenv', 'cat package.json', 'aws s3 ls'];
for (const c of FAMILY_REFUSED) check(`non réécrite : ${JSON.stringify(c)}`, eligible(c).ok, false);
check('familles sans processeur Node dédié → generic (token-saver en premier)',
  ['kubectl get pods', 'terraform plan', 'mvn test', 'npm ci', 'jq .a f.json'].map((c) => eligible(c).processor),
  ['generic', 'generic', 'generic', 'generic', 'generic']);
check('docker logs → processeur Node docker', eligible('docker logs api').processor, 'docker');

group('Compression : revue de sécurité (régressions)');
const REVIEW = {
  // ps must never print the environment of other processes (secrets)
  'ps : environnement refusé': {
    ok: ['ps aux', 'ps axu', 'ps -o pid,command', 'ps -o user,pid,etime', 'ps -p 123', 'ps -ax'],
    refused: ['ps eww', 'ps e', 'ps auxe', 'ps aux e', 'ps -e', 'ps -ef', 'ps -eww', 'ps -axe', 'ps -o environ',
      'ps -o pid,env', 'ps -O env', 'ps -oenv', 'ps -o=environ', 'ps --format env', 'ps --format=pid,environ', 'ps -o'],
  },
  // yq writes files with -i, -s, --split-exp
  'yq : écriture refusée': {
    ok: ['yq .a f.yaml', 'yq e .a f.yaml', "yq '.services' compose.yaml other.yaml"],
    refused: ['yq -s .a f.yaml', "yq -s '.name' f.yaml", 'yq --split-exp .a f.yaml', 'yq --split-exp=.a f.yaml',
      'yq --split-exp-file x f.yaml', 'yq -n .a', 'yq -i .a f.yaml', 'yq --inplace .a f.yaml', 'yq -is .a f.yaml',
      'yq env f.yaml', "yq 'strenv(A)' f.yaml", "yq '$ENV.A' f.yaml", 'yq .a'],
  },
  // maven / gradle: code or configuration from outside the project
  'mvn / gradle : extensions, settings, init scripts, propriétés JVM refusés': {
    ok: ['mvn test', 'mvn clean verify -DskipITs', './gradlew :app:test', 'gradle build --offline',
      'mvn test -DskipTests', 'mvn test -DskipTests=true', 'mvn test -Dtest=FooTest#bar', 'mvn -Pci verify'],
    refused: ['mvn -Dmaven.ext.class.path=x.jar test', 'mvn -D maven.ext.class.path=x.jar test',
      'mvn test -Dmaven.ext.class.path=/tmp/x.jar', 'mvn -s s.xml test', 'mvn --settings=s.xml test', 'mvn -ss.xml test',
      'mvn -gs g.xml test', 'mvn --global-settings g.xml test', 'mvn -t t.xml test', 'mvn --toolchains=t.xml test',
      'gradle --init-script i.gradle build', 'gradle --init-script=i.gradle build', 'gradle -I i.gradle build',
      './gradlew -Ii.gradle test', 'gradle -c s.gradle build', 'gradle --settings-file s.gradle build',
      'gradle -g /tmp/h build', 'gradle --gradle-user-home=/tmp/h build', './gradlew -g/tmp/h test',
      'gradle build -Dorg.gradle.jvmargs=-javaagent:/tmp/evil.jar', 'gradle -Dorg.gradle.jvmargs=x build',
      './gradlew test -Pfoo=bar', 'gradle build --system-prop=a=b', 'gradle build --project-prop a=b',
      'mvn test -Duser.home=/tmp/evil', 'mvn test -D user.home=/tmp/evil', 'mvn test --define=user.home=/tmp/evil',
      'mvn test -DargLine=-javaagent:/tmp/evil.jar', 'mvn test -Dtest=$(id)', 'mvn -P ci verify'],
  },
  // docker: never another daemon
  'docker : autre démon refusé': {
    ok: ['docker logs api', 'docker logs api --tail 100', 'docker ps', 'docker compose logs api'],
    refused: ['docker logs -H tcp://x api', 'docker logs --host=tcp://x api', 'docker logs --host tcp://x api',
      'docker logs --context prod api', 'docker logs -c x api', 'docker logs -Htcp://x api', 'docker ps -H tcp://x',
      'docker ps --context prod', 'docker images --host tcp://x', 'docker build --context prod .',
      'docker compose --context prod logs', 'docker -H x ps', 'docker --context prod logs api',
      'docker-compose --host tcp://x ps', 'docker logs --config /tmp/c api'],
  },
};
for (const [name, { ok, refused }] of Object.entries(REVIEW)) {
  for (const c of ok) check(`${name} — réécrite : ${c}`, eligible(c).ok, true);
  for (const c of refused) check(`${name} — non réécrite : ${JSON.stringify(c)}`, eligible(c).ok, false);
}

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
check('grosse sortie : compressée + pied de page', [found.code, /\[ccx: sortie compressée \d+→\d+ car\. \(node:listing\) — CCX_RAW=1 find \. -type f pour la sortie brute\]\n$/.test(found.out)], [0, true]);
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
const broken = spawnSync('node', ['-r', preload, WRAP, b64('find . -type f')],
  { cwd: big, encoding: 'utf8', env: { ...ENV, SHELL: '/bin/sh', CCX_COMPRESS_ENGINE: 'node' } });
check('erreur interne → sortie brute intacte, même code', [broken.stdout === raw, broken.status], [true, 0]);
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
check('champs exacts, aucun contenu de sortie', last && Object.keys(last).sort(), ['after', 'before', 'cmd', 'engine', 'exit', 'processor', 'ts']);
check('moteur et processeur enregistrés', last && [last.engine, last.processor], ['node', 'node:listing']);
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
