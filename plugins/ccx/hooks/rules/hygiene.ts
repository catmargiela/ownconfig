/**
 * bash-hygiene, ported from ccx (hooks/lib/bash-hygiene.js). Warns, NEVER denies:
 *   1. unquoted glob with no match: zsh fails (« no matches found »);
 *   2. `ssh host "…'…'…"`: nested quotes, re-read by the remote shell;
 *   3. `$?` or `&&` after a pipe without `pipefail`;
 *   4. a long `sleep N`: wait for a condition, not a duration.
 * Directory reads are the caller's: `globCandidates` names the words to check,
 * `findings` takes those that matched nothing.
 */
import { stripHeredocs, stripQuoted } from '../shell'

/** Shell pattern (`*` only) → RegExp on a file name. */
export function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp('^' + body + '$')
}

/**
 * Unquoted words carrying `*` worth checking. Conservative: no expansion
 * ($, `, {, ~), no escape, no `**`, no arithmetic; none after a `cd`, where
 * the glob is evaluated in another directory than the session's.
 */
export function globCandidates(cmd: string): string[] {
  const stripped = stripQuoted(cmd)
  if (/(^|[;&|(]\s*)(cd|pushd)\s/.test(stripped)) return []
  const words = stripped.split(/[\s;&|()<>]+/).filter(Boolean)
  return words.filter(
    w =>
      w.includes('*') &&
      !/[$`{}~\\'"]/.test(w) &&
      !w.includes('**') &&
      // `$((3*4))` split becomes `3*4`: arithmetic, not a glob.
      (w === '*' || !/^[\d*+\-/%]+$/.test(w)),
  )
}

export type GlobQuery = { dir: string; pattern: RegExp; isHiddenSkipped: boolean } | null

/**
 * Where a candidate must match: its directory (relative to `cwd`) and name
 * pattern. Only the last segment may hold `*`; otherwise null (cannot tell,
 * so it counts as matched).
 */
export function globQuery(token: string, cwd: string): GlobQuery {
  const cut = token.lastIndexOf('/')
  const dir = cut < 0 ? '.' : token.slice(0, cut) || '/'
  if (/[*?[]/.test(dir)) return null
  const name = token.slice(cut + 1)
  const full = dir.startsWith('/') ? dir : `${cwd.replace(/\/+$/, '')}/${dir}`
  // As zsh without GLOB_DOTS: `*` does not catch hidden files.
  return { dir: full, pattern: globToRegExp(name), isHiddenSkipped: !name.startsWith('.') }
}

/** `ssh … "…'…"` or `ssh … '…"…'`, outside heredoc bodies. */
export function nestedSshQuotes(cmd: string): boolean {
  const text = stripHeredocs(cmd)
  return /\bssh\b[^|;&\n]*?\s"[^"]*'[^"]*"/.test(text) || /\bssh\b[^|;&\n]*?\s'[^']*"[^']*'/.test(text)
}

/** Exit status read after a pipe, without `pipefail` nor `PIPESTATUS`. */
export function pipeStatus(cmd: string): boolean {
  const raw = stripHeredocs(cmd)
  if (/pipefail|PIPESTATUS|pipestatus/.test(raw)) return false
  const stripped = stripQuoted(cmd)
  const pipe = /(^|[^|])\|(?![|&])/
  if (!pipe.test(stripped)) return false
  // `$?` after the first pipe (even inside a string: `echo "rc=$?"`).
  const firstPipe = raw.search(/(^|[^|])\|(?![|&])/)
  if (firstPipe >= 0 && raw.slice(firstPipe).includes('$?')) return true
  // `a | b && c`: c depends on b's status, not a's.
  return stripped.split(/[;\n]/).some(seg => {
    const p = seg.search(pipe)
    return p >= 0 && /&&|\|\|/.test(seg.slice(p + 2))
  })
}

const SLEEP_UNITS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400 }

/** Longest `sleep N` wait, in seconds. */
export function longestSleep(cmd: string): number {
  let max = 0
  for (const m of stripQuoted(cmd).matchAll(/\bsleep\s+(\d+(?:\.\d+)?)([smhd]?)\b/g)) {
    max = Math.max(max, Number(m[1]) * (SLEEP_UNITS[m[2] ?? ''] ?? 1))
  }
  return max
}

export type Finding = { id: 'glob' | 'ssh' | 'pipe' | 'sleep'; msg: string }

/** Findings for `cmd`, given the glob candidates that matched nothing. */
export function findings(cmd: string, unmatched: readonly string[]): Finding[] {
  const out: Finding[] = []
  if (unmatched.length) {
    out.push({
      id: 'glob',
      msg: `Glob non cité sans correspondance (${unmatched.slice(0, 3).join(', ')}) : zsh échoue avec « no matches found » au lieu de passer le motif. Le citer ('${unmatched[0]}') s'il est destiné à la commande (find -name, grep --include).`,
    })
  }
  if (nestedSshQuotes(cmd)) {
    out.push({
      id: 'ssh',
      msg: "Commande ssh avec quotes imbriquées : elle est réinterprétée par le shell distant. Plus sûr : `ssh hôte 'bash -s' <<'EOF'` … `EOF`, ou copier un script (scp) puis l'exécuter.",
    })
  }
  if (pipeStatus(cmd)) {
    out.push({
      id: 'pipe',
      msg: 'Statut de sortie lu après un pipe sans `set -o pipefail` : `$?` et `&&` reflètent la DERNIÈRE commande du pipe (head, tail, grep), pas celle en amont. Ajouter `set -o pipefail;` ou tester la commande seule.',
    })
  }
  const wait = longestSleep(cmd)
  if (wait >= 5) {
    out.push({
      id: 'sleep',
      msg: `\`sleep\` de ${wait} s : attendre une durée fixe gaspille du temps ou échoue trop tôt. Préférer l'outil Monitor ou une boucle qui attend une condition (fichier présent, port ouvert, statut prêt).`,
    })
  }
  return out
}

/** Key under which a finding for `cmd` is warned once per session. */
export function hygieneKey(finding: Finding, cmd: string): string {
  return `${finding.id}|${String(cmd).trim().slice(0, 200)}`
}

export function hygieneMsg(fresh: readonly Finding[]): string {
  return ['[Hygiène Bash]', ...fresh.map(f => '  - ' + f.msg)].join('\n')
}
