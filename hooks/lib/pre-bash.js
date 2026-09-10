'use strict';
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
  return String(cmd)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
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

const HARD_DENY = [
  {
    re: /\bgit\s+commit\b[^|;&]*\s(--no-verify|-n)\b/,
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

function run(input) {
  const raw = input?.tool_input?.command;
  if (!raw) return;
  const cmd = stripQuoted(raw);

  if (enabled(['minimal', 'standard', 'strict'])) {
    for (const rule of HARD_DENY) if (rule.re.test(cmd)) deny(rule.msg);
  }

  if (!enabled(['standard', 'strict'])) return;

  const hit =
    DESTRUCTIVE.find((d) => d.re.test(cmd)) ||
    (TEXT_CONTEXT.test(raw) ? null : RAW_DESTRUCTIVE.find((d) => d.re.test(raw)));
  if (!hit) return;

  // Une seule demande de faits par commande identique et par session.
  const seen = readState(input.session_id, 'destructive', {});
  const key = cmd.trim().slice(0, 200);
  if (seen[key]) return;
  seen[key] = 1;
  writeState(input.session_id, 'destructive', seen);
  deny(destructiveMsg(hit.what));
}

module.exports = { run, stripQuoted, DESTRUCTIVE, RAW_DESTRUCTIVE, TEXT_CONTEXT, HARD_DENY };
