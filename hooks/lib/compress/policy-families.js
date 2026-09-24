'use strict';
/**
 * Eligibility rules for the command families covered by the token-saver
 * processors: infrastructure (kubectl, helm, terraform/tofu, pulumi, cdktf,
 * ansible-playbook in check mode), package managers (listings, audits, frozen
 * installs), JVM builds, task runners, jq/yq on files, system inspection.
 *
 * Same contract as the rules of policy.js: `rule(words)` returns the name of
 * the Node processor, or null. These families have no dedicated Node
 * processor: they return `generic`, which sends them to the token-saver
 * processors first in auto mode (see wrap.js). Only `docker logs` reuses the
 * Node `docker` processor. Read, build and test only:
 * every write, deploy, interactive, streaming or watch variant is refused.
 * policy.js has already refused operators, substitutions, redirections,
 * control characters, env prefixes and structured-output flags.
 *
 * Deliberately NOT covered: curl/wget/http (network, and upstream keeps
 * Authorization headers), ssh/scp, psql/mysql/sqlite3, env/printenv/set
 * (secrets), cat/head/tail (file contents), aws/gcloud/az.
 */

const has = (args, ...flags) => args.some((a) => flags.includes(a));
/** `--flag`, `--flag=value` */
const hasOpt = (args, ...flags) => args.some((a) => flags.includes(a.split('=')[0]));
/** A bundle of short flags (`-pf`, `-tf`) containing one of `letters`; `-owide` is a value, not a bundle. */
const shortBundle = (args, letters) => args.some((a) => /^-[A-Za-np-z][A-Za-z]+$/.test(a)
  && [...letters].some((l) => a.includes(l)));
const positionals = (args) => args.filter((a) => !a.startsWith('-'));

/**
 * Skip the leading global options of `words` (from index 1). `valued` take a
 * separate value unless written `--opt=value`; `bare` take none. Any other
 * leading option → -1 (refused: it could redirect the tool anywhere).
 */
function skipGlobals(words, valued, bare = []) {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i];
    const name = w.split('=')[0];
    if (bare.includes(w)) i += 1;
    else if (valued.includes(name)) i += w.includes('=') ? 1 : 2;
    else return -1;
  }
  return i;
}

// ------------------------------------------------------------ infrastructure
const KUBE_READ = ['get', 'describe', 'logs', 'top'];
const KUBE_REFUSED = ['-f', '--follow', '-w', '--watch', '--watch-only', '--raw', '--filename', '-k',
  '--kustomize', '--kubeconfig', '--token', '--server', '-s', '--as', '--as-group', '--as-uid', '-i', '--stdin'];

function kubectlRule(words) {
  const i = skipGlobals(words, ['-n', '--namespace', '--context', '--cluster'], ['-A', '--all-namespaces']);
  if (i < 0 || !KUBE_READ.includes(words[i])) return null;
  const rest = words.slice(i + 1);
  if (hasOpt(rest, ...KUBE_REFUSED) || shortBundle(rest, 'fwi')) return null;
  return 'generic';
}

function helmRule(words) {
  const i = skipGlobals(words, ['-n', '--namespace', '--kube-context']);
  if (i < 0 || !['list', 'ls', 'status', 'template', 'history'].includes(words[i])) return null;
  const rest = words.slice(i + 1);
  return hasOpt(rest, '--post-renderer', '--post-renderer-args', '--kubeconfig') ? null : 'generic';
}

const TF_REFUSED = ['-out', '--out', '-auto-approve', '--auto-approve', '-generate-config-out',
  '--generate-config-out', '-write', '--write'];

function terraformRule(words) {
  const i = skipGlobals(words, ['-chdir', '--chdir']);
  if (i < 0) return null;
  const sub = words[i];
  const rest = words.slice(i + 1);
  if (hasOpt(rest, ...TF_REFUSED)) return null;
  if (sub === 'fmt') return has(rest, '-check', '--check') ? 'generic' : null;
  return ['plan', 'validate', 'show'].includes(sub) ? 'generic' : null;
}

function pulumiRule(words) {
  if (words[1] !== 'preview') return null;
  const rest = words.slice(2);
  return hasOpt(rest, '--save-plan', '--refresh', '-r', '--import-file', '--attach-debugger') ? null : 'generic';
}

function cdktfRule(words) {
  return ['synth', 'diff'].includes(words[1]) ? 'generic' : null;
}

const ANSIBLE_DRY = ['--check', '-C', '--syntax-check', '--list-tasks', '--list-hosts', '--list-tags'];
const ANSIBLE_INTERACTIVE = ['--step', '-k', '--ask-pass', '-K', '--ask-become-pass', '--ask-vault-pass',
  '--ask-vault-password', '-J'];

function ansibleRule(words) {
  const rest = words.slice(1);
  if (!has(rest, ...ANSIBLE_DRY) || hasOpt(rest, ...ANSIBLE_INTERACTIVE)) return null;
  return 'generic';
}

// ------------------------------------------------------------ packages
const PKG_READ = {
  npm: ['ls', 'list', 'outdated', 'audit'],
  pnpm: ['ls', 'list', 'outdated', 'audit'],
  yarn: ['list', 'outdated', 'audit'],
  bun: ['outdated'],
};
/**
 * Installs run lifecycle scripts, like a build: only the lockfile-exact forms,
 * with no package argument (no new code pulled in), are accepted.
 */
const FROZEN = {
  'npm ci': [],
  'pnpm install': ['--frozen-lockfile'],
  'pnpm i': ['--frozen-lockfile'],
  'bun install': ['--frozen-lockfile'],
  'bun i': ['--frozen-lockfile'],
  'yarn install': ['--immutable', '--frozen-lockfile'],
};

function packageRule(words) {
  const [tool, sub, ...rest] = words;
  if (hasOpt(rest, '-g', '--global', '--location')) return null;
  if ((PKG_READ[tool] || []).includes(sub)) return rest.includes('fix') ? null : 'generic';
  if (tool === 'bun' && sub === 'pm') return rest[0] === 'ls' ? 'generic' : null;
  const required = FROZEN[`${tool} ${sub}`];
  if (!required || positionals(rest).length) return null;
  return !required.length || has(rest, ...required) ? 'generic' : null;
}

function pipRule(words) {
  return ['list', 'freeze', 'check'].includes(words[1]) ? 'generic' : null;
}

function poetryRule(words) {
  return words[1] === 'show' ? 'generic' : null;
}

function uvRule(words) {
  return words[1] === 'pip' && ['list', 'freeze'].includes(words[2]) ? 'generic' : null;
}

// ------------------------------------------------------------ JVM builds
const MVN_GOALS = new Set(['clean', 'compile', 'test-compile', 'test', 'package', 'verify']);
const GRADLE_TASKS = new Set(['clean', 'build', 'test', 'check', 'assemble', 'classes', 'testClasses',
  'compileJava', 'compileKotlin', 'compileTestJava', 'compileTestKotlin']);

/**
 * Options that load code or configuration from outside the project: a core
 * extension (`-Dmaven.ext.class.path`), settings/toolchains files, init
 * scripts, another Gradle user home. The project build itself is trusted like
 * `go test`; these are not.
 */
const MVN_REFUSED = ['-s', '--settings', '-gs', '--global-settings', '-t', '--toolchains'];
const MVN_EXT = /^(-D)?maven\.ext\.class\.path/;
const GRADLE_REFUSED = ['--continuous', '-t', '--scan', '--write-locks', '--write-verification-metadata',
  '--init-script', '-I', '--settings-file', '-c', '--gradle-user-home', '-g'];
/** Short options with an attached value: `-Iinit.gradle`, `-sfile.xml`. */
const GRADLE_ATTACHED = /^-[Icg].+/;
const MVN_ATTACHED = /^-(s|gs|t)[^-].*/;

/** Every positional must be a build/test goal: no deploy, install, publish, run, exec… */
function goalsAllowed(rest, allowed, strip) {
  const goals = positionals(rest);
  return goals.length > 0 && goals.every((g) => allowed.has(strip(g)));
}

function mvnRule(words) {
  const rest = words.slice(1);
  if (hasOpt(rest, ...MVN_REFUSED) || rest.some((a) => MVN_EXT.test(a) || MVN_ATTACHED.test(a))) return null;
  return goalsAllowed(rest, MVN_GOALS, (g) => g) ? 'generic' : null;
}

function gradleRule(words) {
  const rest = words.slice(1);
  if (hasOpt(rest, ...GRADLE_REFUSED) || rest.some((a) => GRADLE_ATTACHED.test(a))) return null;
  return goalsAllowed(rest, GRADLE_TASKS, (g) => g.split(':').pop()) ? 'generic' : null;
}

// ------------------------------------------------------------ task runners, nix
function justRule(words) {
  const rest = words.slice(1);
  if (positionals(rest).length) return null;
  return has(rest, '--list', '-l', '--summary') ? 'generic' : null;
}

function miseRule(words) {
  return ['ls', 'list'].includes(words[1]) ? 'generic' : null;
}

function nixRule(words) {
  if (words[1] !== 'flake' || !['show', 'check'].includes(words[2])) return null;
  const rest = words.slice(3);
  return hasOpt(rest, '--option', '--commit-lock-file', '--recreate-lock-file', '--update-input',
    '--override-input', '--output-lock-file') ? null : 'generic';
}

// ------------------------------------------------------------ jq / yq
/** jq/yq builtins that read the environment: same secrets as printenv. */
const ENV_READ = /(^|[^A-Za-z0-9_])(\$ENV|env|strenv|\$__loc__)([^A-Za-z0-9_]|$)/;

function jqRule(words) {
  const rest = words.slice(1);
  if (hasOpt(rest, '-i', '--in-place', '--inplace', '-n', '--null-input', '--args', '--jsonargs')) return null;
  if (shortBundle(rest, 'in') || rest.some((a) => ENV_READ.test(a))) return null;
  // A filter and at least one file: never stdin, never input-less generators.
  return positionals(rest).length >= 2 ? 'generic' : null;
}

/**
 * yq (mikefarah): `-i` rewrites the file, `-s`/`--split-exp` write one file
 * per document. An expression and at least one file are required.
 */
const YQ_REFUSED = ['-i', '--inplace', '--in-place', '-s', '--split-exp', '--split-exp-file', '-n',
  '--null-input'];

function yqRule(words) {
  const rest = words.slice(1);
  if (hasOpt(rest, ...YQ_REFUSED) || shortBundle(rest, 'isn')) return null;
  if (rest.some((a) => ENV_READ.test(a))) return null;
  return positionals(rest).length >= 2 ? 'generic' : null;
}

// ------------------------------------------------------------ system
const JOURNAL_REFUSED = ['-f', '--follow', '--flush', '--rotate', '--sync', '--relinquish-var',
  '--smart-relinquish-var', '--setup-keys', '--update-catalog', '--vacuum-size', '--vacuum-time',
  '--vacuum-files'];

function journalRule(words) {
  const rest = words.slice(1);
  return hasOpt(rest, ...JOURNAL_REFUSED) || shortBundle(rest, 'f') ? null : 'generic';
}

function systemctlRule(words) {
  return words[1] === 'status' ? 'generic' : null;
}

const sysInfo = () => 'generic';

/** ps options whose next word is a value. */
const PS_VALUED = new Set(['-o', '-O', '-p', '-q', '-u', '-U', '-g', '-G', '-t', '-s', '--format', '--pid',
  '--ppid', '--user', '--User', '--group', '--Group', '--tty', '--sort', '--cols', '--columns', '--rows']);
const PS_ENV = /env|environ/i;

/**
 * ps without the environment of other processes (secrets): no `e` in a BSD
 * bundle or a dash bundle (`e`, `eww`, `auxe`, `-e`, `-ef` — on macOS `-e`
 * prints environments), no `env`/`environ` field or long option.
 */
function psRule(words) {
  const rest = words.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const name = a.split('=')[0];
    if (PS_VALUED.has(name)) {
      const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : rest[++i];
      if (value === undefined || PS_ENV.test(value)) return null;
    } else if (/^-[oO]./.test(a)) {
      if (PS_ENV.test(a.slice(2))) return null;
    } else if (a.startsWith('--')) {
      if (PS_ENV.test(a)) return null;
    } else if (/^-?[A-Za-z]+$/.test(a) && a.includes('e')) {
      return null;
    }
  }
  return 'generic';
}

const RULES = {
  kubectl: kubectlRule, helm: helmRule, terraform: terraformRule, tofu: terraformRule,
  pulumi: pulumiRule, cdktf: cdktfRule, 'ansible-playbook': ansibleRule,
  pip: pipRule, pip3: pipRule, poetry: poetryRule, uv: uvRule,
  mvn: mvnRule, './mvnw': mvnRule, gradle: gradleRule, './gradlew': gradleRule,
  just: justRule, mise: miseRule, nix: nixRule, jq: jqRule, yq: yqRule,
  journalctl: journalRule, systemctl: systemctlRule,
  df: sysInfo, du: sysInfo, free: sysInfo, ps: psRule, uname: sysInfo,
};

/** Options that point docker at another daemon or client configuration. */
const DOCKER_REMOTE = ['-H', '--host', '--context', '--config'];
const dockerRemote = (args) => hasOpt(args, ...DOCKER_REMOTE) || args.some((a) => /^-H./.test(a));

/** docker logs (never followed, never on another daemon). */
function dockerLogsRule(words) {
  if (words[1] !== 'logs') return null;
  const rest = words.slice(2);
  if (dockerRemote(rest) || hasOpt(rest, '-c')) return null;
  return hasOpt(rest, '-f', '--follow') || shortBundle(rest, 'f') ? null : 'docker';
}

/** cargo fmt --check (never the rewriting form). */
function cargoFmtRule(words) {
  return words[1] === 'fmt' && has(words, '--check') ? 'generic' : null;
}

module.exports = { RULES, packageRule, dockerLogsRule, dockerRemote, cargoFmtRule };
