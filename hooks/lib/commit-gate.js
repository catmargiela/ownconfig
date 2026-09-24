'use strict';
/**
 * PreToolUse / Bash — commit-gate, sur toute commande qui lance `git commit`.
 *
 * Contrôles rapides sur le contenu INDEXÉ uniquement (`git diff --cached`) :
 *   1. `console.log(` ou `debugger;` ajoutés dans un .ts/.tsx/.js/.jsx hors tests ;
 *   2. fichiers .go indexés non conformes à gofmt (si gofmt est installé) ;
 *   3. message `-m` hors conventional commits (sauté sans `-m` : éditeur, `-F`,
 *      message construit par substitution).
 * Un TODO/FIXME ajouté ne fait qu'avertir.
 *
 * Contrôle de contenu : le refus se répète tant que le contenu ne change pas,
 * sans boucle possible puisque corriger le contenu change le verdict. Toute
 * erreur (pas un dépôt, git lent, gofmt absent) laisse passer en silence.
 */
const path = require('path');
const { enabled, deny, warn, readState, writeState } = require('./util');
const { segments, shellWords, WRAPPERS } = require('./shell-segments');
const { deadline, toplevel, stagedDiff, gofmtDirty } = require('./staged-diff');

const CONVENTIONAL = /^(feat|fix|refactor|docs|test|chore|perf|build|ci|style|revert)(\([\w./-]+\))?!?: .+/;
const JS = /\.(m|c)?[jt]sx?$/;
const JS_TEST = /(\.(test|spec)\.|(^|\/)__tests__\/)/;
const MAX_LISTED = 10;
/** Options globales de git suivies d'une valeur. */
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/** Index du sous-commande git après les options globales, et `-C` éventuel. */
function gitSubcommand(words) {
  if (path.basename(words[0] || '') !== 'git') return null;
  let dir = null;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '-C') dir = words[i + 1];
    i += GIT_VALUE_OPTS.has(words[i]) ? 2 : 1;
  }
  return { sub: words[i], dir };
}

/**
 * Dossier où le premier `git commit` s'exécute, ou null (pas de commit, ou
 * dossier indéterminable : chemin cité, variable).
 */
function commitDir(cmd, cwd) {
  let dir = cwd;
  for (const { words } of segments(cmd)) {
    if (words[0] === 'cd') {
      const target = words[1];
      if (!target || /["'$`~]/.test(target)) return null;
      dir = path.resolve(dir, target);
      continue;
    }
    const git = gitSubcommand(words);
    if (!git || git.sub !== 'commit') continue;
    if (git.dir === undefined || (git.dir && /["'$`~]/.test(git.dir))) return null;
    return git.dir ? path.resolve(dir, git.dir) : dir;
  }
  return null;
}

/** Valeur du premier `-m` du premier `git commit`, ou null (absent, dynamique). */
function commitMessage(cmd) {
  const tokens = shellWords(cmd);
  if (!tokens) return null;
  let words = [];
  for (const t of [...tokens, { op: true }]) {
    if (!t.op) { words.push(t); continue; }
    const msg = messageOf(words);
    if (msg !== undefined) return msg;
    words = [];
  }
  return null;
}

/** undefined : pas un `git commit` ; null : commit sans -m exploitable. */
function messageOf(tokens) {
  let start = 0;
  while (start < tokens.length && (/^[A-Za-z_]\w*=/.test(tokens[start].value) || WRAPPERS.has(tokens[start].value))) start += 1;
  const words = tokens.slice(start);
  const git = gitSubcommand(words.map((w) => w.value));
  if (!git || git.sub !== 'commit') return undefined;
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i].value;
    // `-m msg`, `--message msg`, `-am msg`
    if (w === '--message' || /^-[a-zA-Z]*m$/.test(w)) {
      const next = words[i + 1];
      return !next || next.op || next.dynamic ? null : next.value;
    }
    // `--message=msg`, `-mmsg`
    const inline = /^--message=([\s\S]*)$/.exec(w) || /^-m([\s\S]+)$/.exec(w);
    if (inline) return words[i].dynamic ? null : inline[1];
  }
  return null;
}

function consoleHits(added) {
  return added.filter(({ file, text }) => JS.test(file) && !JS_TEST.test(file)
    && !/^\s*(\/\/|\*|\/\*)/.test(text)
    && (/\bconsole\.log\s*\(/.test(text) || /(^|[^\w.])debugger\s*;/.test(text)));
}

function listed(hits) {
  const lines = hits.slice(0, MAX_LISTED).map((h) => `  ${h.file}:${h.line}  ${h.text.trim().slice(0, 80)}`);
  if (hits.length > MAX_LISTED) lines.push(`  … et ${hits.length - MAX_LISTED} autre(s)`);
  return lines;
}

function denyMsg({ logs, dirtyGo, badMessage }) {
  const out = ['[Commit-gate] Commit refusé : le contenu indexé ne passe pas les contrôles.', ''];
  if (logs.length) {
    out.push('console.log / debugger ajoutés :', ...listed(logs),
      '  → Les retirer (ou passer par le logger du projet), puis `git add` ces fichiers.', '');
  }
  if (dirtyGo.length) {
    out.push('Fichiers Go non formatés (gofmt) :', ...dirtyGo.slice(0, MAX_LISTED).map((f) => `  ${f}`),
      `  → \`gofmt -w ${dirtyGo.slice(0, 3).join(' ')}\`, puis \`git add\` ces fichiers.`, '');
  }
  if (badMessage !== null) {
    out.push(`Message non conventionnel : « ${badMessage.slice(0, 80)} »`,
      '  → Format `type(scope): description`, type parmi feat, fix, refactor, docs, test,',
      '    chore, perf, build, ci, style, revert.', '');
  }
  out.push('Corriger, puis relancer le commit.');
  return out.join('\n');
}

/** TODO/FIXME ajoutés : avertissement une fois par ligne et par session. */
function warnTodos(input, added) {
  const todos = added.filter(({ text }) => /\b(TODO|FIXME)\b/.test(text));
  if (!todos.length) return;
  const seen = readState(input.session_id, 'commit-todo', {});
  const fresh = todos.filter((t) => !seen[`${t.file}|${t.text.trim()}`]);
  if (!fresh.length) return;
  const next = { ...seen };
  for (const t of fresh) next[`${t.file}|${t.text.trim()}`] = 1;
  writeState(input.session_id, 'commit-todo', next);
  warn(['[Commit-gate] TODO/FIXME ajouté(s) dans ce commit — à suivre ou à résoudre :', ...listed(fresh)].join('\n'));
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  if (input?.tool_name && input.tool_name !== 'Bash') return;
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string' || !/\bcommit\b/.test(cmd)) return;
  const dir = commitDir(cmd, input.cwd || process.cwd());
  if (!dir) return;

  const left = deadline();
  const top = toplevel(dir, left);
  if (!top) return;
  const diff = stagedDiff(top, left);
  if (!diff) return;

  const logs = consoleHits(diff.added);
  const goFiles = diff.files.filter((f) => f.endsWith('.go'));
  const dirtyGo = gofmtDirty(top, goFiles, left) || [];
  const message = commitMessage(cmd);
  const firstLine = message === null ? null : message.split('\n')[0].trim();
  const badMessage = firstLine !== null && !CONVENTIONAL.test(firstLine) ? firstLine : null;

  if (logs.length || dirtyGo.length || badMessage !== null) deny(denyMsg({ logs, dirtyGo, badMessage }));
  warnTodos(input, diff.added);
}

module.exports = { run, commitDir, commitMessage, consoleHits, CONVENTIONAL };
