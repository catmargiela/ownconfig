/**
 * dev-server-guard, ported from ccx (hooks/lib/dev-server-guard.js). A dev
 * server or watcher never ends: in the foreground it blocks the tool call until
 * the timeout and its output is lost. Quoted text is ignored; each link of a
 * `&&`, `;`, `|` chain is examined; a link ended by `&` is already detached.
 */
import { segments } from '../shell'

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const RUNNERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'pnpx'])
const DEV_SCRIPT = /^(dev|start|serve|watch)(:[\w:.-]+)?$/
/** Package-manager options followed by a value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--prefix', '-C', '--dir', '--filter', '-F', '--cwd', '-w', '--workspace', '-p', '--package',
])

const base = (w: string): string => String(w).replace(/^.*\//, '')

/** Index of the first word that is not an option (option values skipped). */
function skipFlags(words: readonly string[], i: number): number {
  let j = i
  for (let w = words[j]; w !== undefined && w.startsWith('-'); w = words[j]) j += VALUE_FLAGS.has(w) ? 2 : 1
  return j
}

function packageManager(pm: string, words: readonly string[], depth: number): string | null {
  const i = skipFlags(words, 1)
  const sub = words[i]
  if (!sub) return null
  if (['exec', 'dlx', 'x'].includes(sub)) return longRunning(words.slice(skipFlags(words, i + 1)), depth + 1)
  if (sub === 'run' || sub === 'run-script') {
    const j = skipFlags(words, i + 1)
    if (!words[j]) return null
    if (DEV_SCRIPT.test(words[j])) return `${pm} run ${words[j]}`
    // `npm run tauri dev`: the script is named after a binary.
    return longRunning(words.slice(j), depth + 1)
  }
  if (DEV_SCRIPT.test(sub)) return `${pm} ${sub}`
  // `pnpm vite`, `yarn next dev`, `bun vite`: a binary launched directly.
  return pm === 'npm' ? null : longRunning(words.slice(i), depth + 1)
}

function composeUp(args: readonly string[]): boolean {
  const up = args.indexOf('up')
  if (up < 0) return false
  const isDetached = args
    .slice(up + 1)
    .some(a => a === '--detach' || a === '--wait' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(a))
  return !isDetached
}

const hasAny = (args: readonly string[], ...flags: string[]): boolean =>
  args.some(a => flags.includes(a) || flags.some(f => a.startsWith(`${f}=`)))

/** Rules per binary: true when the invocation does not end. */
const BINARIES: Readonly<Record<string, (a: readonly string[]) => boolean>> = {
  next: a => a[0] === 'dev' || a[0] === 'start',
  vite: a => !a[0] || a[0].startsWith('-') || ['dev', 'serve', 'preview'].includes(a[0]),
  go: a => a[0] === 'run',
  air: () => true,
  nodemon: () => true,
  tauri: a => a[0] === 'dev',
  cargo: a => (a[0] === 'tauri' && a[1] === 'dev') || a[0] === 'watch',
  docker: a => a[0] === 'compose' && composeUp(a.slice(1)),
  'docker-compose': a => composeUp(a),
  tsc: a => hasAny(a, '--watch', '-w'),
  jest: a => hasAny(a, '--watch', '--watchAll'),
  vitest: a => a[0] !== 'run' && (a[0] === 'watch' || a[0] === 'dev' || hasAny(a, '--watch', '-w')),
  node: a => hasAny(a, '--watch'),
}

const isPython = (bin: string): boolean => /^python(\d+(\.\d+)?)?$/.test(bin)

/** Description of the never-ending command, or null. */
export function longRunning(words: readonly string[], depth = 0): string | null {
  const [first, ...args] = words
  if (first === undefined || depth > 3) return null
  const bin = base(first)
  if (RUNNERS.has(bin)) return longRunning(words.slice(skipFlags(words, 1)), depth + 1)
  if (PACKAGE_MANAGERS.has(bin)) return packageManager(bin, words, depth)
  if (isPython(bin)) {
    const m = args.indexOf('-m')
    return m >= 0 && args[m + 1] === 'http.server' ? `${bin} -m http.server` : null
  }
  const rule = Object.hasOwn(BINARIES, bin) ? BINARIES[bin] : undefined
  if (!rule || !rule(args)) return null
  if (bin === 'docker' || bin === 'docker-compose') return `${bin === 'docker' ? 'docker compose' : bin} up`
  return [bin, ...args.slice(0, 2)].join(' ').trim()
}

/** First foreground link that never ends, or null. */
export function findLongRunning(cmd: string): string | null {
  for (const seg of segments(cmd)) {
    if (seg.isBackground) continue
    const hit = longRunning(seg.words)
    if (hit) return hit
  }
  return null
}

export function devServerMsg(what: string): string {
  const isCompose = /compose/.test(what)
  return [
    `[Bloqué] \`${what}\` ne se termine pas : au premier plan, il bloque l'appel`,
    "d'outil jusqu'au timeout, et sa sortie est perdue.",
    '',
    isCompose
      ? '  → Ajouter `-d` (`docker compose up -d`), puis lire les logs avec `docker compose logs --tail 50`.'
      : '  → Relancer la même commande avec `run_in_background: true`, puis lire sa sortie avec',
    isCompose
      ? "  → Ou relancer avec `run_in_background: true` et suivre la sortie avec l'outil Monitor."
      : "    l'outil Monitor (ou la sortie de la tâche de fond) pour attendre « ready ».",
    '  → Pour une vérification ponctuelle, préférer une commande qui se termine :',
    '    `next build`, `vite build`, `vitest run`, `tsc --noEmit`, `go build`, `go test`.',
  ].join('\n')
}
