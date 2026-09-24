'use strict';
/**
 * PreToolUse / Bash — dev-server-guard.
 *
 * Un serveur de dev ou un watcher ne se termine jamais : lancé au premier plan,
 * il bloque l'appel d'outil jusqu'au timeout, puis sa sortie est perdue. Il
 * doit tourner en tâche de fond (`run_in_background: true`), sortie lue ensuite.
 *
 * Refus (standard, strict) quand `run_in_background` n'est pas vrai. Le texte
 * cité est ignoré ; chaque maillon d'une chaîne `&&`, `;`, `|` est examiné. Un
 * maillon terminé par `&` est déjà détaché par le shell : il passe.
 */
const { enabled, deny } = require('./util');
const { segments } = require('./shell-segments');

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const DEV_SCRIPT = /^(dev|start|serve|watch)(:[\w:.-]+)?$/;
/** Options de gestionnaire de paquets suivies d'une valeur. */
const VALUE_FLAGS = new Set(['--prefix', '-C', '--dir', '--filter', '-F', '--cwd', '-w', '--workspace', '-p', '--package']);

const base = (w) => String(w).replace(/^.*\//, '');

/** Index du premier mot qui n'est pas une option (valeurs d'options sautées). */
function skipFlags(words, i) {
  let j = i;
  while (j < words.length && words[j].startsWith('-')) j += VALUE_FLAGS.has(words[j]) ? 2 : 1;
  return j;
}

function packageManager(pm, words, depth) {
  const i = skipFlags(words, 1);
  const sub = words[i];
  if (!sub) return null;
  if (['exec', 'dlx', 'x'].includes(sub)) return longRunning(words.slice(skipFlags(words, i + 1)), depth + 1);
  if (sub === 'run' || sub === 'run-script') {
    const j = skipFlags(words, i + 1);
    if (!words[j]) return null;
    if (DEV_SCRIPT.test(words[j])) return `${pm} run ${words[j]}`;
    // `npm run tauri dev` : le script porte le nom d'un binaire.
    return longRunning(words.slice(j), depth + 1);
  }
  if (DEV_SCRIPT.test(sub)) return `${pm} ${sub}`;
  // `pnpm vite`, `yarn next dev`, `bun vite` : binaire lancé directement.
  return pm === 'npm' ? null : longRunning(words.slice(i), depth + 1);
}

function composeUp(args) {
  const up = args.indexOf('up');
  if (up < 0) return false;
  const detached = args.slice(up + 1).some((a) =>
    a === '--detach' || a === '--wait' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(a));
  return !detached;
}

const hasAny = (args, ...flags) => args.some((a) => flags.includes(a) || flags.some((f) => a.startsWith(`${f}=`)));

/** Règles par binaire : renvoient true quand l'invocation ne se termine pas. */
const BINARIES = {
  next: (a) => a[0] === 'dev' || a[0] === 'start',
  vite: (a) => !a[0] || a[0].startsWith('-') || ['dev', 'serve', 'preview'].includes(a[0]),
  go: (a) => a[0] === 'run',
  air: () => true,
  nodemon: () => true,
  tauri: (a) => a[0] === 'dev',
  cargo: (a) => (a[0] === 'tauri' && a[1] === 'dev') || a[0] === 'watch',
  docker: (a) => a[0] === 'compose' && composeUp(a.slice(1)),
  'docker-compose': (a) => composeUp(a),
  tsc: (a) => hasAny(a, '--watch', '-w'),
  jest: (a) => hasAny(a, '--watch', '--watchAll'),
  vitest: (a) => a[0] !== 'run' && (a[0] === 'watch' || a[0] === 'dev' || hasAny(a, '--watch', '-w')),
  node: (a) => hasAny(a, '--watch'),
};

function isPython(bin) { return /^python(\d+(\.\d+)?)?$/.test(bin); }

/** Description de la commande sans fin, ou null. */
function longRunning(words, depth = 0) {
  if (!words.length || depth > 3) return null;
  const bin = base(words[0]);
  const args = words.slice(1);
  if (RUNNERS.has(bin)) return longRunning(words.slice(skipFlags(words, 1)), depth + 1);
  if (PACKAGE_MANAGERS.has(bin)) return packageManager(bin, words, depth);
  if (isPython(bin)) {
    const m = args.indexOf('-m');
    return m >= 0 && args[m + 1] === 'http.server' ? `${bin} -m http.server` : null;
  }
  const rule = BINARIES[bin];
  if (!rule || !rule(args)) return null;
  if (bin === 'docker' || bin === 'docker-compose') return `${bin === 'docker' ? 'docker compose' : bin} up`;
  return [bin, ...args.slice(0, 2)].join(' ').trim();
}

/** Premier maillon au premier plan qui ne se termine pas, ou null. */
function findLongRunning(cmd) {
  for (const seg of segments(cmd)) {
    if (seg.background) continue;
    const hit = longRunning(seg.words);
    if (hit) return hit;
  }
  return null;
}

function denyMsg(what) {
  const compose = /compose/.test(what);
  return [
    `[Bloqué] \`${what}\` ne se termine pas : au premier plan, il bloque l'appel`,
    "d'outil jusqu'au timeout, et sa sortie est perdue.",
    '',
    compose
      ? '  → Ajouter `-d` (`docker compose up -d`), puis lire les logs avec `docker compose logs --tail 50`.'
      : '  → Relancer la même commande avec `run_in_background: true`, puis lire sa sortie avec',
    compose
      ? '  → Ou relancer avec `run_in_background: true` et suivre la sortie avec l\'outil Monitor.'
      : "    l'outil Monitor (ou la sortie de la tâche de fond) pour attendre « ready ».",
    '  → Pour une vérification ponctuelle, préférer une commande qui se termine :',
    '    `next build`, `vite build`, `vitest run`, `tsc --noEmit`, `go build`, `go test`.',
  ].join('\n');
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  if (input?.tool_name && input.tool_name !== 'Bash') return;
  const ti = input?.tool_input || {};
  if (typeof ti.command !== 'string' || ti.run_in_background === true) return;
  const hit = findLongRunning(ti.command);
  if (hit) deny(denyMsg(hit));
}

module.exports = { run, findLongRunning, longRunning };
