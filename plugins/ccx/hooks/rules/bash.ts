/**
 * pre-bash, ported from ccx (hooks/lib/pre-bash.js):
 *  1. hard deny (every profile): hook bypass, force-push, pipe-to-shell;
 *  2. fact-forcing (standard, strict): a destructive command must first be
 *     preceded by its targets and a rollback plan, once per command.
 */
import { stripHeredocs, stripQuoted, unquoteFlags } from '../shell'

type Destructive = { re: RegExp; what: string }

const DESTRUCTIVE: readonly Destructive[] = [
  { re: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])\b/, what: 'suppression récursive forcée' },
  { re: /\bgit\s+reset\s+--hard\b/, what: 'git reset --hard (perte des modifications locales)' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, what: 'git clean -f (suppression des fichiers non suivis)' },
  { re: /\bdd\s+if=/, what: 'dd (écriture disque brute)' },
  { re: /\bmkfs(\.|\s)/, what: 'formatage de système de fichiers' },
  { re: /\bchmod\s+-R\s+777\b/, what: 'chmod -R 777 (permissions dangereuses)' },
  { re: /\b(prisma\s+migrate\s+reset|drizzle-kit\s+drop|supabase\s+db\s+reset)\b/, what: 'reset de base de données' },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/, what: 'publication de paquet (irréversible)' },
]

/**
 * Checked on the RAW command: destructive SQL nearly always sits in quotes
 * (`psql -c "delete from users"`). Text commands are left out by TEXT_CONTEXT.
 */
const RAW_DESTRUCTIVE: readonly Destructive[] = [
  { re: /\b(drop\s+table|drop\s+database|delete\s+from|truncate\s+table)\b/i, what: 'commande SQL destructive' },
]

/** Commands whose argument is text, not code to run. */
const TEXT_CONTEXT = /^\s*(git\s+commit|git\s+tag|echo|printf|gh\s+(pr|issue)\s+(create|comment)|cat\s*<<)/

const NO_VERIFY_MSG = [
  '[Bloqué] Contournement des hooks git (`--no-verify`, `HUSKY=0`, `core.hooksPath`).',
  '',
  "Ces hooks sont la dernière barrière avant que du code cassé n'entre dans",
  "l'historique. S'ils échouent, corriger ce qu'ils signalent.",
  '',
  "Si le hook lui-même est en cause, le dire à l'utilisateur et lui laisser la décision.",
].join('\n')

/** `--no-verify` and every abbreviation git accepts (`--no-v`, `--no-verif`…). */
const NO_VERIFY = '--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?(?![\\w-])'
const GIT_WRITE = '(commit|push|merge|rebase|pull|am|cherry-pick|revert)'

const HOOK_BYPASS: readonly RegExp[] = [
  new RegExp(`\\bgit\\s+(push|merge|rebase|pull|am|cherry-pick|revert)\\b[^|;&]*\\s${NO_VERIFY}`),
  // Inline prefix: only when HUSKY=0 (and other assignments) directly precede git.
  /(^|[;&|]\s*|\s)HUSKY=0\s+(\w+=\S*\s+)*git\s/,
  // Exported: applies to every later command of the script.
  new RegExp(`\\bexport\\s+HUSKY=0\\b[\\s\\S]*\\bgit\\s+${GIT_WRITE}\\b`),
]

/** Hooks redirected through configuration: `-c`, `git config`, or GIT_CONFIG_* variables. */
const HOOKS_PATH: readonly RegExp[] = [
  /\bgit\b[^|;&]*\s-c\s*['"]?core\.hookspath\s*=/i,
  /\bgit\s+config\b[^|;&]*\score\.hookspath\s+\S/i,
  /\bGIT_CONFIG_PARAMETERS=/,
  /\bGIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)=/i,
]

type Rule = { re: RegExp; msg: string }

const HARD_DENY: readonly Rule[] = [
  ...[...HOOK_BYPASS, ...HOOKS_PATH].map(re => ({ re, msg: NO_VERIFY_MSG })),
  {
    re: new RegExp(`\\bgit\\s+commit\\b[^|;&]*\\s(${NO_VERIFY}|-n\\b)`),
    msg: [
      '[Bloqué] `git commit --no-verify` désactive les hooks de pré-commit.',
      '',
      "Ces hooks sont la dernière barrière avant que du code cassé n'entre dans",
      "l'historique. S'ils échouent, corriger ce qu'ils signalent.",
      '',
      "Si le hook lui-même est en cause, le dire à l'utilisateur et lui laisser la décision.",
    ].join('\n'),
  },
  {
    re: /\bgit\s+push\b[^|;&]*\s(--force|-f)(\s|$)/,
    msg: [
      "[Bloqué] `git push --force` réécrit l'historique distant.",
      '',
      "  → Préférer `--force-with-lease`, qui refuse d'écraser le travail d'un autre.",
      "  → Sur une branche partagée ou `main`, demander l'accord explicite de l'utilisateur.",
    ].join('\n'),
  },
  {
    re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
    msg: [
      "[Bloqué] Télécharger un script et l'exécuter directement (`curl … | sh`).",
      '',
      "Le contenu n'est jamais inspecté et peut changer entre deux exécutions.",
      '',
      "  → Télécharger dans un fichier, lire le script, puis l'exécuter.",
    ].join('\n'),
  },
]

/** Deny message for a hook bypass, force-push or pipe-to-shell, or null. */
export function hardDeny(raw: string): string | null {
  const cmd = stripQuoted(unquoteFlags(raw))
  const rule = HARD_DENY.find(r => r.re.test(cmd))
  if (rule) return rule.msg
  // A fully quoted `-c "core.hooksPath=…"` vanishes from the stripped command:
  // check the raw one too, outside text arguments (commit messages, echo).
  const bare = stripHeredocs(raw)
  return !TEXT_CONTEXT.test(bare) && HOOKS_PATH.some(re => re.test(bare)) ? NO_VERIFY_MSG : null
}

export type DestructiveHit = { what: string; key: string }

/** The destructive operation `raw` performs and its once-per-session key, or null. */
export function findDestructive(raw: string): DestructiveHit | null {
  const cmd = stripQuoted(unquoteFlags(raw))
  // Raw rules keep the quotes (SQL passed to a client) but skip heredoc bodies.
  const rawNoHeredoc = stripHeredocs(raw)
  const hit =
    DESTRUCTIVE.find(d => d.re.test(cmd)) ??
    (TEXT_CONTEXT.test(rawNoHeredoc) ? undefined : RAW_DESTRUCTIVE.find(d => d.re.test(rawNoHeredoc)))
  return hit ? { what: hit.what, key: cmd.trim().slice(0, 200) } : null
}

export function destructiveMsg(what: string): string {
  return [
    '[Fact-Forcing Gate] Commande destructive détectée : ' + what + '.',
    '',
    'Avant de la lancer, énoncer :',
    '',
    "1. La liste exacte des fichiers ou données qu'elle va modifier ou supprimer",
    "2. La procédure de rollback, en une ligne (ou dire clairement qu'il n'y en a pas)",
    "3. L'instruction de l'utilisateur qui justifie cette commande, citée mot pour mot",
    '',
    'Énoncer les faits, puis relancer la même commande (elle passera).',
  ].join('\n')
}
