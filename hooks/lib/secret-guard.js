'use strict';
/**
 * PreToolUse / Bash + Edit|Write|MultiEdit — secret-guard.
 *
 * Refus dur, actif dans tous les profils : un identifiant écrit en clair dans un
 * fichier finit tôt ou tard dans un commit, un log ou une capture. La valeur doit
 * venir d'une variable d'environnement, du trousseau ou d'un script de secrets.
 *
 * Le secret détecté n'est JAMAIS recopié dans le message : il serait sinon
 * réinjecté dans le contexte, donc dans le transcript.
 */
const { enabled, deny, newTexts, tilde } = require('./util');

const SECRET_PATTERNS = [
  { kind: 'jeton GitHub (classic)', re: /ghp_[A-Za-z0-9]{30,}/g },
  { kind: 'jeton GitHub (fine-grained)', re: /github_pat_[A-Za-z0-9_]{40,}/g },
  { kind: 'jeton GitHub OAuth', re: /gho_[A-Za-z0-9]{30,}/g },
  { kind: 'clé API Anthropic', re: /sk-ant-[A-Za-z0-9-]{20,}/g },
  { kind: 'clé API (sk-)', re: /sk-[A-Za-z0-9]{32,}/g },
  { kind: "clé d'accès AWS", re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'clé privée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

/** Marqueurs de valeur factice : documentation, exemples, gabarits. */
const PLACEHOLDER_WORDS = /(x{5,}|EXAMPLE|PLACEHOLDER|REDACTED|DUMMY|FAKE|CHANGEME|YOUR_?)/i;

/**
 * Un corps fait d'un seul caractère répété, ou de très peu de caractères
 * distincts, n'est pas un secret réel (`ghp_000…`, `sk-aaaa…`).
 */
function isPlaceholder(value) {
  const body = value.replace(/^(ghp_|github_pat_|gho_|sk-ant-|sk-|AKIA)/, '');
  if (PLACEHOLDER_WORDS.test(body)) return true;
  return new Set(body.replace(/[-_]/g, '')).size < 6;
}

/** Quatre premiers caractères, puis une ellipse. Jamais la valeur entière. */
function mask(value) {
  return String(value).slice(0, 4) + '…';
}

/** Premier secret non factice trouvé dans `text`, ou null. */
function findSecret(text) {
  if (!text) return null;
  for (const { kind, re } of SECRET_PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      if (kind === 'clé privée' || !isPlaceholder(m[0])) return { kind, masked: mask(m[0]) };
    }
  }
  return null;
}

/**
 * La commande écrit-elle dans un fichier ? Redirection vers autre chose que
 * /dev/null ou un descripteur, `tee`, `sed -i`, `dd of=`.
 */
function writesFile(cmd) {
  const text = String(cmd);
  for (const m of text.matchAll(/>>?\s*([^\s;&|<>()]+)/g)) {
    if (!m[1].startsWith('&') && m[1] !== '/dev/null') return true;
  }
  return /\btee\b/.test(text) || /\bsed\b[^|;&]*\s-[a-zA-Z]*i/.test(text) || /\bdd\b[^|;&]*\bof=/.test(text);
}

function secretMsg(hit, where) {
  return [
    `[Bloqué] Identifiant écrit en clair (${hit.kind} : ${hit.masked}) dans ${where}.`,
    '',
    "Un secret littéral finit dans un commit, un log ou le transcript, et ne se",
    'révoque pas en supprimant la ligne.',
    '',
    '  → Lire la valeur depuis une variable d\'environnement (`${GITHUB_TOKEN}`),',
    '    le trousseau, `gh auth token`, ou un script de secrets dédié.',
    '  → Dans un exemple ou un test, utiliser un placeholder : `ghp_xxx`, `<token>`.',
    "  → Si ce secret a déjà été affiché ou écrit ailleurs, le signaler à l'utilisateur :",
    '    il faut le révoquer.',
  ].join('\n');
}

function run(input) {
  if (!enabled(['minimal', 'standard', 'strict'])) return;
  const ti = input?.tool_input || {};

  if (typeof ti.command === 'string') {
    if (!writesFile(ti.command)) return;
    const hit = findSecret(ti.command);
    if (hit) deny(secretMsg(hit, 'une commande qui écrit un fichier'));
    return;
  }

  const filePath = ti.file_path || ti.path;
  if (!filePath) return;
  for (const text of newTexts(ti)) {
    const hit = findSecret(text);
    if (hit) deny(secretMsg(hit, tilde(filePath)));
  }
}

module.exports = { run, findSecret, isPlaceholder, writesFile, mask, SECRET_PATTERNS };
