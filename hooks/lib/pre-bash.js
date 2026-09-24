'use strict';
/**
 * Neutralise le corps des heredocs avant toute analyse.
 *
 * Indispensable, et pas theorique : un heredoc contenant du texte avec des
 * apostrophes desynchronise l'appariement des quotes de `stripQuoted`, ce qui
 * fait apparaitre des motifs absents de la commande reellement executee. Un
 * script Python redige en francais a suffi a faire bloquer une commande
 * legitime.
 *
 * Le corps d'un heredoc est une donnee, jamais une commande a analyser.
 */
function stripHeredocs(cmd) {
  const text = String(cmd);
  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index < cursor) continue;
    const tag = m[2];
    const lineEnd = text.indexOf('\n', m.index + m[0].length);
    if (lineEnd < 0) break;
    const bodyStart = lineEnd + 1;
    // Fin de corps : le tag seul sur sa ligne (indentation toleree pour `<<-`).
    const rel = text.slice(bodyStart).search(new RegExp('^\\s*' + tag + '\\s*$', 'm'));
    const bodyEnd = rel < 0 ? text.length : bodyStart + rel;
    out += text.slice(cursor, bodyStart);
    cursor = bodyEnd;
    re.lastIndex = bodyEnd;
  }
  return out + text.slice(cursor);
}

/**
 * PreToolUse / Bash
 *
 *  1. Refus dur : contournement de garde-fou (--no-verify), force-push, pipe-to-shell.
 *  2. Fact-forcing : une commande destructive doit être précédée de ses cibles
 *     et d'un plan de rollback.
 */
const { enabled, readState, writeState, deny } = require('./util');

/**
 * Neutralise le contenu des chaînes citées avant analyse : un message de commit
 * qui contient « drop table » ne doit pas déclencher le gate.
 */
function stripQuoted(cmd) {
  return scanQuotes(stripHeredocs(cmd));
}

/**
 * Parcours gauche-droite fidèle au shell : entre apostrophes rien n'est échappé
 * (`'a\'` se ferme au second `'`), entre guillemets `\` échappe, hors quotes `\'`
 * est une apostrophe littérale. Une quote jamais refermée est laissée telle
 * quelle : son contenu reste analysé (prudence).
 */
function scanQuotes(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
    if (c !== "'" && c !== '"') { out += c; i += 1; continue; }
    const end = closingQuote(s, i);
    if (end < 0) return out + s.slice(i);
    out += c + c;
    i = end + 1;
  }
  return out;
}

/** Index de la quote fermante de celle ouverte en `start`, ou -1. */
function closingQuote(s, start) {
  const q = s[start];
  if (q === "'") return s.indexOf("'", start + 1);
  for (let j = start + 1; j < s.length; j += 1) {
    if (s[j] === '\\') { j += 1; continue; }
    if (s[j] === '"') return j;
  }
  return -1;
}

const DESTRUCTIVE = [
  { re: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])\b/, what: 'suppression récursive forcée' },
  { re: /\bgit\s+reset\s+--hard\b/, what: 'git reset --hard (perte des modifications locales)' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, what: 'git clean -f (suppression des fichiers non suivis)' },
  { re: /\bdd\s+if=/, what: 'dd (écriture disque brute)' },
  { re: /\bmkfs(\.|\s)/, what: 'formatage de système de fichiers' },
  { re: /\bchmod\s+-R\s+777\b/, what: 'chmod -R 777 (permissions dangereuses)' },
  { re: /\b(prisma\s+migrate\s+reset|drizzle-kit\s+drop|supabase\s+db\s+reset)\b/, what: 'reset de base de données' },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/, what: 'publication de paquet (irréversible)' },
];

/**
 * Règles évaluées sur la commande BRUTE : le SQL destructif vit presque toujours
 * à l'intérieur de guillemets (`psql -c "delete from users"`), donc le strip des
 * chaînes citées le rendrait invisible. Le prix à payer est le faux positif sur
 * un message de commit, écarté par TEXT_CONTEXT ci-dessous.
 */
const RAW_DESTRUCTIVE = [
  { re: /\b(drop\s+table|drop\s+database|delete\s+from|truncate\s+table)\b/i, what: 'commande SQL destructive' },
];

/** Commandes dont l'argument est du texte, pas du code à exécuter. */
const TEXT_CONTEXT = /^\s*(git\s+commit|git\s+tag|echo|printf|gh\s+(pr|issue)\s+(create|comment)|cat\s*<<)/;

const NO_VERIFY_MSG = [
  '[Bloqué] Contournement des hooks git (`--no-verify`, `HUSKY=0`, `core.hooksPath`).',
  '',
  "Ces hooks sont la dernière barrière avant que du code cassé n'entre dans",
  "l'historique. S'ils échouent, corriger ce qu'ils signalent.",
  '',
  "Si le hook lui-même est en cause, le dire à l'utilisateur et lui laisser la décision.",
].join('\n');

/**
 * Hook bypasses beyond `commit --no-verify`: the same flag on push, merge,
 * rebase, pull, am, cherry-pick, revert (`-n` stays commit-only: it means
 * dry-run for push); husky switched off; hooks redirected through
 * `core.hooksPath` (config keys are case-insensitive), inline or persisted.
 */
/** `--no-verify` and every abbreviation git accepts (`--no-v`, `--no-verif`…). */
const NO_VERIFY = '--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?(?![\\w-])';
const GIT_WRITE = '(commit|push|merge|rebase|pull|am|cherry-pick|revert)';

const HOOK_BYPASS = [
  new RegExp(`\\bgit\\s+(push|merge|rebase|pull|am|cherry-pick|revert)\\b[^|;&]*\\s${NO_VERIFY}`),
  // Inline prefix: only when HUSKY=0 (and other assignments) directly precede git.
  /(^|[;&|]\s*|\s)HUSKY=0\s+(\w+=\S*\s+)*git\s/,
  // Exported: applies to every later command of the script.
  new RegExp(`\\bexport\\s+HUSKY=0\\b[\\s\\S]*\\bgit\\s+${GIT_WRITE}\\b`),
];

/** Hooks redirected through configuration: `-c`, `git config`, or GIT_CONFIG_* variables. */
const HOOKS_PATH = [
  /\bgit\b[^|;&]*\s-c\s*['"]?core\.hookspath\s*=/i,
  /\bgit\s+config\b[^|;&]*\score\.hookspath\s+\S/i,
  /\bGIT_CONFIG_PARAMETERS=/,
  /\bGIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)=/i,
];

const HARD_DENY = [
  ...[...HOOK_BYPASS, ...HOOKS_PATH].map((re) => ({ re, msg: NO_VERIFY_MSG })),
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
      '[Bloqué] `git push --force` réécrit l\'historique distant.',
      '',
      '  → Préférer `--force-with-lease`, qui refuse d\'écraser le travail d\'un autre.',
      "  → Sur une branche partagée ou `main`, demander l'accord explicite de l'utilisateur.",
    ].join('\n'),
  },
  {
    re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
    msg: [
      '[Bloqué] Télécharger un script et l\'exécuter directement (`curl … | sh`).',
      '',
      "Le contenu n'est jamais inspecté et peut changer entre deux exécutions.",
      '',
      '  → Télécharger dans un fichier, lire le script, puis l\'exécuter.',
    ].join('\n'),
  },
];

function destructiveMsg(what) {
  return [
    '[Fact-Forcing Gate] Commande destructive détectée : ' + what + '.',
    '',
    'Avant de la lancer, énoncer :',
    '',
    '1. La liste exacte des fichiers ou données qu\'elle va modifier ou supprimer',
    '2. La procédure de rollback, en une ligne (ou dire clairement qu\'il n\'y en a pas)',
    "3. L'instruction de l'utilisateur qui justifie cette commande, citée mot pour mot",
    '',
    'Énoncer les faits, puis relancer la même commande (elle passera).',
  ].join('\n');
}

/**
 * An option quoted on its own (`"--no-verify"`, `'-c'`) is still an option for
 * the shell: unquote it before stripping quoted text, or the refusals miss it.
 */
function unquoteFlags(command) {
  return command.replace(/(^|\s)(['"])(-[\w.-]+(?:=[^'"\s]*)?)\2(?=\s|$)/g, '$1$3');
}

function run(input) {
  const raw = input?.tool_input?.command;
  if (!raw) return;
  const cmd = stripQuoted(unquoteFlags(raw));

  if (enabled(['minimal', 'standard', 'strict'])) {
    for (const rule of HARD_DENY) if (rule.re.test(cmd)) deny(rule.msg);
    // A fully quoted `-c "core.hooksPath=…"` vanishes from the stripped command:
    // check the raw one too, outside text arguments (commit messages, echo).
    const bare = stripHeredocs(raw);
    if (!TEXT_CONTEXT.test(bare) && HOOKS_PATH.some((re) => re.test(bare))) deny(NO_VERIFY_MSG);
  }

  if (!enabled(['standard', 'strict'])) return;

  // Les regles brutes gardent les guillemets, pour voir une requete passee en
  // argument a un client SQL. Elles doivent en revanche ignorer les corps de
  // heredoc : c'est de la donnee, pas une commande.
  const rawNoHeredoc = stripHeredocs(raw);
  const hit =
    DESTRUCTIVE.find((d) => d.re.test(cmd)) ||
    (TEXT_CONTEXT.test(rawNoHeredoc) ? null : RAW_DESTRUCTIVE.find((d) => d.re.test(rawNoHeredoc)));
  if (!hit) return;

  // Une seule demande de faits par commande identique et par session.
  const seen = readState(input.session_id, 'destructive', {});
  const key = cmd.trim().slice(0, 200);
  if (seen[key]) return;
  seen[key] = 1;
  writeState(input.session_id, 'destructive', seen);
  deny(destructiveMsg(hit.what));
}

module.exports = { run, stripQuoted, stripHeredocs, DESTRUCTIVE, RAW_DESTRUCTIVE, TEXT_CONTEXT, HARD_DENY, HOOK_BYPASS, HOOKS_PATH, unquoteFlags };
