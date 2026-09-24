'use strict';
/**
 * Output-compression eligibility.
 *
 * A command is rewritten ONLY when it is one plain invocation of an allowlisted
 * read-only or build tool. The rules of the families added with the
 * token-saver engine (kubectl, helm, terraform, package managers…) live in
 * policy-families.js. The rewrite hides the command behind the wrapper, so
 * a false positive here would launder a command past the permission flow: when
 * in doubt, refuse. Refusing only means "not compressed", never "blocked".
 *
 *   eligible(command) -> { ok, processor, reason }
 */
const { stripQuoted } = require('../pre-bash');
const families = require('./policy-families');

const MAX_LEN = 1000;
const MAX_WORDS = 60;

/** Characters that change the meaning of an unquoted word: refused outright. */
const UNSAFE_BARE = /[|&;<>()`$\\\n\r]/;
/** Characters refused inside double quotes: expansions and escapes. */
const UNSAFE_DOUBLE = /[$`\\\n\r]/;
/**
 * Any control character, INCLUDING newline and carriage return, anywhere in the
 * command — even inside single quotes. A quoted newline is harmless to the shell
 * but ends the `# '<original>'` comment of the rewritten command, which would
 * turn the rest of the line into an unchecked command.
 */
const CONTROL = /[\x00-\x1f\x7f\u0085\u2028\u2029]/;

/** Read a double-quoted string starting after the opening quote. */
function readDouble(cmd, start) {
  const end = cmd.indexOf('"', start);
  if (end < 0) return null;
  const value = cmd.slice(start, end);
  return UNSAFE_DOUBLE.test(value) ? null : { value, next: end + 1 };
}

/**
 * Shell-accurate split for the tiny subset we accept: plain words, single
 * quotes (fully literal), double quotes without expansion or escape. Anything
 * else — operators, substitutions, backslashes, comments — returns null.
 */
function splitWords(cmd) {
  const words = [];
  let cur = null;
  for (let i = 0; i < cmd.length;) {
    const c = cmd[i];
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) return null;
      cur = (cur || '') + cmd.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      const r = readDouble(cmd, i + 1);
      if (!r) return null;
      cur = (cur || '') + r.value;
      i = r.next;
    } else if (c === ' ' || c === '\t') {
      if (cur !== null) words.push(cur);
      cur = null;
      i++;
    } else {
      if (UNSAFE_BARE.test(c) || (c === '#' && cur === null)) return null;
      cur = (cur || '') + c;
      i++;
    }
  }
  if (cur !== null) words.push(cur);
  return words;
}

/** Second, independent barrier: the shared quote stripper must see no operator. */
function skeletonClean(cmd) {
  return !/[|&;<>()`\n\r]|\$[({']/.test(stripQuoted(cmd));
}

/**
 * Only standard binary directories are reduced to the bare name: `/tmp/x/git`
 * could be any program, and naming it `git` must not make it eligible.
 */
const TRUSTED_BIN = /^\/(usr\/bin|bin|usr\/local\/bin|opt\/homebrew\/bin|usr\/local\/go\/bin)\/[^/]+$/;

/** Words of a plain command, leading absolute binary path reduced to its name. */
function parse(command) {
  const cmd = String(command || '').trim();
  if (!cmd || cmd.length > MAX_LEN || CONTROL.test(cmd) || /<<|<\(|\$\(|`/.test(cmd)) return null;
  if (!skeletonClean(cmd)) return null;
  const words = splitWords(cmd);
  if (!words || !words.length || words.length > MAX_WORDS) return null;
  if (TRUSTED_BIN.test(words[0])) words[0] = words[0].split('/').pop();
  return words;
}

/** Flags whose output is structured, streaming, interactive or side-effecting. */
const REFUSED_PREFIX = ['--json', '--jq', '--template', '--porcelain', '--format', '--pretty=format',
  '--pretty=tformat', '--output', '--out-', '--message-format', '--watch', '--fix', '--web',
  '--interactive', '--reporter', '--update', '--null', '--exec', '--push'];
const REFUSED_EXACT = new Set(['-json', '-exec', '-execdir', '-ok', '-okdir', '-delete', '-print0',
  '-fprint', '-fprint0', '-fprintf', '-fls', '-toolexec', '-z', '--pre', '--pre-glob', '--log',
  '--log-failed']);
const STRUCTURED_O = /^(json|yaml|jsonpath|go-template|template)/;

function refusedArg(arg, next) {
  const a = arg.toLowerCase();
  if (REFUSED_EXACT.has(a) || REFUSED_EXACT.has(a.split('=')[0])) return true;
  if (REFUSED_PREFIX.some((p) => a.startsWith(p))) return true;
  if (a === '-o' && STRUCTURED_O.test(String(next || '').toLowerCase())) return true;
  return /^-o(json|yaml|jsonpath)/.test(a);
}

const has = (args, ...flags) => args.some((a) => flags.includes(a));

/** `npx tsc`, `bunx eslint` — the runner with no option of its own. */
function viaRunner(words, tool) {
  if (words[0] === tool) return words.slice(1);
  if ((words[0] === 'npx' || words[0] === 'bunx') && words[1] === tool) return words.slice(2);
  return null;
}

function gitRule(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '--no-pager' || words[i] === '-P') i++;
    else if (words[i] === '-C') i += 2;
    else return null; // -c, --exec-path, --git-dir…: configuration can run programs
  }
  return ['status', 'diff', 'show', 'log'].includes(words[i]) ? 'git' : null;
}

function goRule(words) {
  return { build: 'build', test: 'gotest', vet: 'lint' }[words[1]] || null;
}

function jsTestRule(words) {
  if (words[0] === 'bun' && words[1] === 'test') return has(words, '-u') ? null : 'jstest';
  const v = viaRunner(words, 'vitest');
  if (v && v[0] === 'run') return has(v, '-u') ? null : 'jstest';
  const j = viaRunner(words, 'jest');
  if (j) return has(j, '-u') ? null : 'jstest';
  return null;
}

function buildScriptRule(words) {
  const line = words.join(' ');
  if (['bun run build', 'npm run build', 'pnpm build', 'pnpm run build', 'yarn build'].includes(line)) return 'build';
  const next = viaRunner(words, 'next');
  if (next && next[0] === 'build') return 'build';
  const tsc = viaRunner(words, 'tsc');
  if (tsc) return has(tsc, '-w', '--init') ? null : 'build';
  return null;
}

function lintRule(words) {
  const eslint = viaRunner(words, 'eslint');
  if (eslint) return has(eslint, '-f', '-o', '--init') ? null : 'lint';
  if (words[0] === 'golangci-lint' && words[1] === 'run') return 'lint';
  return null;
}

function cargoRule(words) {
  return { build: 'build', check: 'build', clippy: 'lint', test: 'jstest' }[words[1]] || null;
}

const COMPOSE_OPTS = new Set(['-f', '--file', '-p', '--project-name', '--profile', '--env-file',
  '--project-directory', '--ansi', '--progress']);

function composeRule(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (COMPOSE_OPTS.has(args[i])) i += 2;
    else if (COMPOSE_OPTS.has(args[i].split('=')[0])) i += 1;
    else return null;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === 'logs') return has(rest, '-f', '--follow') ? null : 'docker';
  return ['ps', 'build', 'pull'].includes(sub) ? 'docker' : null;
}

function dockerRule(words) {
  // -H/--host/--context/--config anywhere: another daemon, never compressed.
  if (families.dockerRemote(words.slice(1))) return null;
  if (words[0] === 'docker-compose') return composeRule(words.slice(1));
  if (words[1] === 'compose') return composeRule(words.slice(2));
  if (words[1] === 'logs') return families.dockerLogsRule(words);
  if (!['ps', 'images', 'build', 'pull'].includes(words[1])) return null;
  return has(words, '-o') ? null : 'docker';
}

function fsRule(words) {
  if (words[0] === 'ls' || words[0] === 'find') return 'listing';
  if (words[0] === 'tree') return has(words, '-o', '-J', '-X', '-H') ? null : 'listing';
  if (words[0] === 'rg' || words[0] === 'grep') return 'search';
  return null;
}

const GH = ['pr checks', 'pr list', 'issue list', 'run view', 'run list'];

function ghRule(words) {
  if (!GH.includes(`${words[1]} ${words[2]}`)) return null;
  return has(words, '-w') ? null : 'gh';
}

const pkg = families.packageRule;

const RULES = {
  ...families.RULES,
  git: gitRule, go: goRule, bun: (w) => jsTestRule(w) || buildScriptRule(w) || pkg(w),
  npx: (w) => jsTestRule(w) || buildScriptRule(w) || lintRule(w),
  bunx: (w) => jsTestRule(w) || buildScriptRule(w) || lintRule(w),
  vitest: jsTestRule, jest: jsTestRule, npm: (w) => buildScriptRule(w) || pkg(w),
  pnpm: (w) => buildScriptRule(w) || pkg(w), yarn: (w) => buildScriptRule(w) || pkg(w),
  next: buildScriptRule, tsc: buildScriptRule, eslint: lintRule,
  'golangci-lint': lintRule, cargo: (w) => cargoRule(w) || families.cargoFmtRule(w),
  docker: dockerRule, 'docker-compose': dockerRule,
  ls: fsRule, find: fsRule, tree: fsRule, rg: fsRule, grep: fsRule, gh: ghRule,
};

function eligible(command) {
  const words = parse(command);
  if (!words) return { ok: false, reason: 'syntaxe' };
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) return { ok: false, reason: 'variable en tête' };
  if (words.some((w) => w.includes('wrap.js'))) return { ok: false, reason: 'récursion' };
  const rule = Object.prototype.hasOwnProperty.call(RULES, words[0]) ? RULES[words[0]] : null;
  if (!rule) return { ok: false, reason: 'hors liste' };
  if (words.some((w, i) => i > 0 && refusedArg(w, words[i + 1]))) return { ok: false, reason: 'option refusée' };
  const processor = rule(words);
  return processor ? { ok: true, processor } : { ok: false, reason: 'hors liste' };
}

module.exports = { eligible, parse, splitWords };
