/**
 * secret-guard, ported from ccx (hooks/lib/secret-guard.js). Hard deny in every
 * profile: a literal credential ends up in a commit, a log or a transcript.
 * The secret is NEVER copied into the message, only its first four characters.
 */

type Pattern = { kind: string; re: RegExp }

const SECRET_PATTERNS: readonly Pattern[] = [
  { kind: 'jeton GitHub (classic)', re: /ghp_[A-Za-z0-9]{30,}/g },
  { kind: 'jeton GitHub (fine-grained)', re: /github_pat_[A-Za-z0-9_]{40,}/g },
  { kind: 'jeton GitHub OAuth', re: /gho_[A-Za-z0-9]{30,}/g },
  { kind: 'clé API Anthropic', re: /sk-ant-[A-Za-z0-9-]{20,}/g },
  { kind: 'clé API (sk-)', re: /sk-[A-Za-z0-9]{32,}/g },
  { kind: "clé d'accès AWS", re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'clé privée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
]

/** Markers of a fake value: docs, examples, templates. */
const PLACEHOLDER_WORDS = /(x{5,}|EXAMPLE|PLACEHOLDER|REDACTED|DUMMY|FAKE|CHANGEME|YOUR_?)/i

/** A body of one repeated character, or very few distinct ones, is not real. */
export function isPlaceholder(value: string): boolean {
  const body = value.replace(/^(ghp_|github_pat_|gho_|sk-ant-|sk-|AKIA)/, '')
  if (PLACEHOLDER_WORDS.test(body)) return true
  return new Set(body.replace(/[-_]/g, '')).size < 6
}

export type SecretHit = { kind: string; masked: string }

/** First non-placeholder secret in `text`, or null. */
export function findSecret(text: string): SecretHit | null {
  if (!text) return null
  for (const { kind, re } of SECRET_PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      if (kind === 'clé privée' || !isPlaceholder(m[0])) return { kind, masked: m[0].slice(0, 4) + '…' }
    }
  }
  return null
}

/** Does the command write a file? Redirection (not /dev/null nor an fd), `tee`, `sed -i`, `dd of=`. */
export function writesFile(cmd: string): boolean {
  const text = String(cmd)
  for (const m of text.matchAll(/>>?\s*([^\s;&|<>()]+)/g)) {
    const target = m[1] ?? ''
    if (!target.startsWith('&') && target !== '/dev/null') return true
  }
  return /\btee\b/.test(text) || /\bsed\b[^|;&]*\s-[a-zA-Z]*i/.test(text) || /\bdd\b[^|;&]*\bof=/.test(text)
}

export function secretMsg(hit: SecretHit, where: string): string {
  return [
    `[Bloqué] Identifiant écrit en clair (${hit.kind} : ${hit.masked}) dans ${where}.`,
    '',
    'Un secret littéral finit dans un commit, un log ou le transcript, et ne se',
    'révoque pas en supprimant la ligne.',
    '',
    "  → Lire la valeur depuis une variable d'environnement (`${GITHUB_TOKEN}`),",
    '    le trousseau, `gh auth token`, ou un script de secrets dédié.',
    '  → Dans un exemple ou un test, utiliser un placeholder : `ghp_xxx`, `<token>`.',
    "  → Si ce secret a déjà été affiché ou écrit ailleurs, le signaler à l'utilisateur :",
    '    il faut le révoquer.',
  ].join('\n')
}

/** Deny message for a Bash command that writes a secret to a file, or null. */
export function checkCommand(command: string): string | null {
  if (!writesFile(command)) return null
  const hit = findSecret(command)
  return hit ? secretMsg(hit, 'une commande qui écrit un fichier') : null
}

/** Deny message for texts an edit puts in `where`, or null. */
export function checkTexts(texts: readonly string[], where: string): string | null {
  for (const text of texts) {
    const hit = findSecret(text)
    if (hit) return secretMsg(hit, where)
  }
  return null
}
