/**
 * Shell text helpers shared by the Bash rules, ported verbatim from ccx
 * (hooks/lib/pre-bash.js and hooks/lib/shell-segments.js).
 */

/**
 * Blank out heredoc bodies before any analysis: a heredoc holding text with
 * apostrophes desynchronises quote pairing in `stripQuoted`, surfacing
 * patterns the executed command does not contain. A heredoc body is data.
 */
export function stripHeredocs(cmd: string): string {
  const text = String(cmd)
  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g
  let out = ''
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index < cursor) continue
    const tag = m[2]
    const lineEnd = text.indexOf('\n', m.index + m[0].length)
    if (lineEnd < 0) break
    const bodyStart = lineEnd + 1
    // Body ends at the tag alone on its line (indentation tolerated for `<<-`).
    const rel = text.slice(bodyStart).search(new RegExp('^\\s*' + tag + '\\s*$', 'm'))
    const bodyEnd = rel < 0 ? text.length : bodyStart + rel
    out += text.slice(cursor, bodyStart)
    cursor = bodyEnd
    re.lastIndex = bodyEnd
  }
  return out + text.slice(cursor)
}

/** Index of the quote closing the one opened at `start`, or -1. */
function closingQuote(s: string, start: number): number {
  const q = s[start]
  if (q === "'") return s.indexOf("'", start + 1)
  for (let j = start + 1; j < s.length; j += 1) {
    if (s[j] === '\\') {
      j += 1
      continue
    }
    if (s[j] === '"') return j
  }
  return -1
}

/**
 * Left-to-right scan faithful to the shell: nothing is escaped between
 * apostrophes, `\` escapes between double quotes, `\'` outside quotes is a
 * literal apostrophe. A quote never closed is left as is (its content stays
 * analysed, out of caution).
 */
function scanQuotes(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      out += s.slice(i, i + 2)
      i += 2
      continue
    }
    if (c !== "'" && c !== '"') {
      out += c
      i += 1
      continue
    }
    const end = closingQuote(s, i)
    if (end < 0) return out + s.slice(i)
    out += c + c
    i = end + 1
  }
  return out
}

/** Empty quoted strings: a commit message saying « drop table » is not SQL. */
export function stripQuoted(cmd: string): string {
  return scanQuotes(stripHeredocs(cmd))
}

/**
 * An option quoted on its own (`"--no-verify"`, `'-c'`) is still an option
 * for the shell: unquote it before stripping quoted text.
 */
export function unquoteFlags(command: string): string {
  return command.replace(/(^|\s)(['"])(-[\w.-]+(?:=[^'"\s]*)?)\2(?=\s|$)/g, '$1$3')
}

/** Prefixes that do not change the command launched. */
const WRAPPERS: ReadonlySet<string> = new Set(['env', 'exec', 'command', 'builtin', 'nohup', 'time', 'sudo'])

/** Drop `VAR=x` assignments, neutral prefixes and redirections. */
export function cleanWords(text: string): string[] {
  const raw = text.trim().replace(/^[({\s]+/, '').replace(/[)}\s]+$/, '').split(/\s+/).filter(Boolean)
  const words: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const w = raw[i] ?? ''
    if (/^\d*[<>]+$/.test(w)) {
      i += 1 // `> file`: target skipped
      continue
    }
    if (/^\d*[<>]/.test(w)) continue // `>file`, `2>/dev/null`
    words.push(w)
  }
  let start = 0
  for (let w = words[start]; w !== undefined; w = words[start]) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w)) start += 1
    else if (start > 0 && WRAPPERS.has(words[start - 1] ?? '') && w.startsWith('-')) start += 1
    else break
  }
  return words.slice(start)
}

export type Segment = { words: string[]; isBackground: boolean }

/** Simple commands of a command line; `isBackground` for one ended by a lone `&`. */
export function segments(cmd: string): Segment[] {
  const text = stripQuoted(String(cmd || ''))
    .replace(/\d*>&\d*-?/g, ' ') // 2>&1, >&2: not a control operator
    .replace(/&>>?/g, ' > ')
    .replace(/\|&/g, '|')
  const parts = text.split(/(&&|\|\||[;\n|&])/)
  const out: Segment[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const words = cleanWords(parts[i] ?? '')
    if (words.length) out.push({ words, isBackground: parts[i + 1] === '&' })
  }
  return out
}
