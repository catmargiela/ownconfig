'use strict';
/**
 * Stop — rappel des fichiers compagnons, activé projet par projet.
 *
 * Certains changements vont par paires : un module et sa démo, un schéma et sa
 * migration, une route et sa doc. Le projet le déclare dans
 * `<racine git>/.claude/companions.json` :
 *
 *   [{ "when": "modules/", "require": "demos.ts", "message": "…" }]
 *
 * Si un fichier touché dans la session correspond à `when` et qu'aucun ne
 * correspond à `require`, la fin de réponse est interrompue UNE fois par règle
 * et par session, pour que le modèle ajoute le compagnon dans le même commit.
 * Pas de fichier, JSON invalide, règle mal formée : silence.
 */
const fs = require('fs');
const path = require('path');
const { enabled, readState, writeState, gitRoot } = require('./util');

const CONFIG = path.join('.claude', 'companions.json');
const MAX_CONFIG_BYTES = 64 * 1024;

/** Motif de type glob → RegExp ancrée. `**` traverse les dossiers, `*` non. */
function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * `rel` (chemin relatif à la racine, séparateur `/`) correspond-il au motif ?
 * Sans `*`/`?` : préfixe de dossier ou chemin exact. Un motif sans `/` vise aussi
 * le nom de fichier seul, où qu'il soit (`demos.ts` couvre `src/demos.ts`).
 */
function matches(rel, pattern) {
  const p = String(pattern).replace(/^\.\//, '');
  if (!p) return false;
  const base = rel.split('/').pop();
  const bare = !p.includes('/');
  if (/[*?]/.test(p)) {
    const re = globToRegex(p);
    return re.test(rel) || (bare && re.test(base));
  }
  const dir = p.endsWith('/') ? p : `${p}/`;
  return rel === p || rel.startsWith(dir) || (bare && base === p);
}

/** Règles valides du projet, ou [] — jamais d'exception. */
function loadRules(root) {
  try {
    const file = path.join(root, CONFIG);
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) return [];
    const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rules)) return [];
    return rules.filter((r) => r && typeof r.when === 'string' && r.when.trim()
      && typeof r.require === 'string' && r.require.trim());
  } catch { return []; }
}

const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

/** Chemin relatif à `root` avec des `/`, ou null si le fichier est hors du dépôt. */
function relTo(root, file) {
  for (const [r, f] of [[root, file], [realOr(root), realOr(file)]]) {
    const rel = path.relative(r, f);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return null;
}

/** Règles déclenchées : un fichier `when` touché, aucun fichier `require` touché. */
function pending(rules, rels) {
  return rules.filter((r) => rels.some((f) => matches(f, r.when)) && !rels.some((f) => matches(f, r.require)));
}

function reminder(rule) {
  if (typeof rule.message === 'string' && rule.message.trim()) return `- ${rule.message.trim()}`;
  return `- Des fichiers de ${rule.when} ont changé mais aucun fichier ${rule.require} : ` +
    'ajoute-le dans le même commit.';
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  const sid = input?.session_id;
  const root = gitRoot(input?.cwd);
  if (!root) return;
  const rules = loadRules(root);
  if (!rules.length) return;

  const rels = readState(sid, 'touched', []).map((f) => relTo(root, f)).filter(Boolean);
  if (!rels.length) return;

  const key = (r) => `${root}\u0000${r.when}\u0000${r.require}`;
  const fired = readState(sid, 'companions', []);
  const due = pending(rules, rels).filter((r) => !fired.includes(key(r)));
  if (!due.length) return;
  writeState(sid, 'companions', [...fired, ...due.map(key)]);

  process.stderr.write([
    '[Compagnons] Fichiers liés manquants dans les changements de cette session :',
    '',
    ...due.map(reminder),
    '',
    'Règles lues dans .claude/companions.json du dépôt. Rappel unique par règle et par session.',
  ].join('\n') + '\n');
  process.exit(2);
}

module.exports = { run, matches, globToRegex, loadRules, pending };
