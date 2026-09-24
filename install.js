#!/usr/bin/env node
'use strict';
/**
 * Installeur idempotent.
 *
 * Principe : cette configuration ne possède QUE ce qu'elle a posé. Les hooks
 * tiers déjà présents dans settings.json (vibe-island, pixel-agents…) sont
 * relus, conservés, et jamais réécrits. La réinstallation retire d'abord ses
 * propres entrées — identifiées par le chemin du dispatcher — puis les repose.
 *
 *   node install.js [--dry-run] [--uninstall]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = __dirname;
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const HOOKS_DEST = path.join(CLAUDE, 'hooks', 'ccx');
const SETTINGS = path.join(CLAUDE, 'settings.json');
const BACKUPS = path.join(CLAUDE, 'backups');
const MARKER = path.join('hooks', 'ccx', 'dispatch.js'); // signature de nos entrées
const SETTINGS_BACKUP_PREFIX = 'settings.json.ccx-';
const KEEP_BACKUPS = 3;

const DRY = process.argv.includes('--dry-run');
const UNINSTALL = process.argv.includes('--uninstall');

const log = (...a) => console.log(DRY ? '[dry-run]' : '        ', ...a);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const HOOK_ENTRIES = [
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit', arg: 'pre-edit', timeout: 10 },
  { event: 'PreToolUse', matcher: 'Bash', arg: 'pre-bash', timeout: 10 },
  { event: 'PostToolUse', matcher: 'Edit|Write|MultiEdit', arg: 'post-edit', timeout: 5 },
  { event: 'PreCompact', matcher: 'manual|auto', arg: 'pre-compact', timeout: 30 },
  { event: 'Stop', matcher: undefined, arg: 'stop', timeout: 60 },
  // `compact` et `fork` sont des sources valides de SessionStart : les omettre
  // fait rater la ré-injection juste après une compaction — le moment précis où
  // le contexte vient d'être perdu.
  { event: 'SessionStart', matcher: 'startup|resume|clear|compact|fork', arg: 'session-start', timeout: 10 },
  { event: 'UserPromptSubmit', matcher: undefined, arg: 'prompt', timeout: 5 },
];

/** Scripts de la machine versionnés dans `bin/`, liés à leur emplacement attendu. */
const SCRIPTS = [
  ['statusline.sh', path.join(CLAUDE, 'statusline.sh')],
  ['gh-mcp-headers.sh', path.join(CLAUDE, 'bin', 'gh-mcp-headers.sh')],
  ['config-doctor.js', path.join(CLAUDE, 'bin', 'config-doctor.js')],
];

/** Lien symbolique : la source de vérité reste le dépôt, les édits sont immédiats. */
function link(src, dest) {
  if (DRY) return log('lien', dest, '->', src);
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(dest);
    else if (st.isDirectory()) {
      console.log(`        ! ${dest} est un vrai dossier — ignoré (déplacez-le puis relancez)`);
      return;
    }
  } catch { /* absent */ }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(src, dest);
  log('lien', dest.replace(HOME, '~'));
}

function unlink(dest) {
  try {
    if (fs.lstatSync(dest).isSymbolicLink()) {
      if (!DRY) fs.unlinkSync(dest);
      log('retiré', dest.replace(HOME, '~'));
    }
  } catch { /* absent */ }
}

/**
 * Un script local différent de la version du dépôt n'est jamais perdu : il part
 * dans `~/.claude/backups/` avant d'être remplacé par le lien. Identique → rien.
 */
function backupIfDiffers(src, dest) {
  let st;
  try { st = fs.lstatSync(dest); } catch { return; }
  if (!st.isFile()) return;
  const same = fs.readFileSync(dest).equals(fs.readFileSync(src));
  if (same) return;
  const target = path.join(BACKUPS, `${path.basename(dest)}.ccx-${stamp()}`);
  if (!DRY) {
    fs.mkdirSync(BACKUPS, { recursive: true });
    fs.copyFileSync(dest, target);
  }
  log('sauvegarde', target.replace(HOME, '~'));
}

function linkScript(name, dest) {
  const src = path.join(SRC, 'bin', name);
  if (!DRY) fs.chmodSync(src, 0o755);
  backupIfDiffers(src, dest);
  link(src, dest);
}

/** Thèmes versionnés dans `themes/*.json`, liés un par un dans `~/.claude/themes/`. */
function themeLinks() {
  let names = [];
  try { names = fs.readdirSync(path.join(SRC, 'themes')).filter((f) => f.endsWith('.json')); }
  catch { /* pas de dossier themes/ */ }
  return names.map((n) => [path.join(SRC, 'themes', n), path.join(CLAUDE, 'themes', n)]);
}

/**
 * Garde les `keep` sauvegardes les plus récentes portant `prefix` dans `dir`.
 * Le préfixe contient un horodatage ISO : l'ordre lexical est l'ordre temporel.
 * Les autres fichiers du dossier ne sont jamais touchés. Renvoie les retirés.
 */
function pruneBackups(dir, prefix, keep, dry = false) {
  let names;
  try { names = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort(); }
  catch { return []; }
  const stale = names.slice(0, Math.max(0, names.length - keep));
  if (!dry) for (const f of stale) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
  return stale;
}

/** Retire toutes nos entrées d'un settings.json, en laissant les autres intactes. */
function stripOwn(settings) {
  let removed = 0;
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      const hooks = (g.hooks || []).filter((h) => {
        const mine = typeof h.command === 'string' && h.command.includes(MARKER);
        if (mine) removed++;
        return !mine;
      });
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  return removed;
}

/** Fichiers et dossiers du dépôt liés tels quels dans `~/.claude` (hors scripts et thèmes). */
function fileLinks() {
  const targets = [
    [path.join(SRC, 'CLAUDE.md'), path.join(CLAUDE, 'CLAUDE.md')],
    [path.join(SRC, 'hooks'), HOOKS_DEST],
  ];
  for (const name of fs.readdirSync(path.join(SRC, 'agents'))) {
    targets.push([path.join(SRC, 'agents', name), path.join(CLAUDE, 'agents', name)]);
  }
  for (const name of fs.readdirSync(path.join(SRC, 'skills'))) {
    targets.push([path.join(SRC, 'skills', name), path.join(CLAUDE, 'skills', name)]);
  }
  return targets;
}

/** Tout ce que l'installeur lie, en [source, destination] : ce que config-doctor vérifie. */
function expectedLinks() {
  return [...fileLinks(), ...SCRIPTS.map(([n, d]) => [path.join(SRC, 'bin', n), d]), ...themeLinks()];
}

function installFiles() {
  const targets = fileLinks();
  const themes = themeLinks();
  if (UNINSTALL) {
    targets.forEach(([, d]) => unlink(d));
    SCRIPTS.forEach(([, d]) => unlink(d));
    themes.forEach(([, d]) => unlink(d));
  } else {
    targets.forEach(([s, d]) => link(s, d));
    SCRIPTS.forEach(([n, d]) => linkScript(n, d));
    themes.forEach(([s, d]) => { backupIfDiffers(s, d); link(s, d); });
  }
}

/** Lit settings.json et le sauvegarde dans `~/.claude/backups/`, 3 copies gardées. */
function loadSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  let settings;
  try { settings = JSON.parse(raw); }
  catch { console.error('settings.json est illisible (JSON invalide) — abandon, rien n\'a été modifié.'); process.exit(1); }
  const backup = path.join(BACKUPS, `${SETTINGS_BACKUP_PREFIX}${stamp()}`);
  if (!DRY) {
    fs.mkdirSync(BACKUPS, { recursive: true });
    fs.writeFileSync(backup, raw);
  }
  log('sauvegarde', backup.replace(HOME, '~'));
  // En dry-run la nouvelle sauvegarde n'existe pas : on en garde une de moins.
  const stale = pruneBackups(BACKUPS, SETTINGS_BACKUP_PREFIX, DRY ? KEEP_BACKUPS - 1 : KEEP_BACKUPS, DRY);
  for (const f of stale) log('ancienne sauvegarde retirée', f);
  return settings;
}

function registerHooks(settings) {
  const dispatch = path.join(HOOKS_DEST, 'dispatch.js');
  for (const e of HOOK_ENTRIES) {
    settings.hooks[e.event] = settings.hooks[e.event] || [];
    const group = { hooks: [{ type: 'command', command: `node "${dispatch}" ${e.arg}`, timeout: e.timeout }] };
    if (e.matcher) group.matcher = e.matcher;
    settings.hooks[e.event].push(group);
  }
  log(`${HOOK_ENTRIES.length} hooks enregistrés`);
}

function main() {
  if (!fs.existsSync(CLAUDE)) { console.error('~/.claude introuvable — Claude Code est-il installé ?'); process.exit(1); }

  console.log(UNINSTALL ? '\n  Désinstallation\n' : '\n  Installation de la configuration Claude Code\n');

  // --- 1. Fichiers et scripts ---
  installFiles();

  // --- 2. Ossature du vault Obsidian ---
  if (!UNINSTALL && !DRY) {
    try { require('./scaffold-vault.js'); }
    catch (e) { console.log('        ! vault non initialisé :', e.message); }
  }

  // --- 3. settings.json ---
  const settings = loadSettings();
  settings.hooks = settings.hooks || {};
  const before = JSON.stringify(settings.hooks).length;
  const removed = stripOwn(settings);
  if (removed) log(`${removed} ancienne(s) entrée(s) retirée(s)`);
  if (!UNINSTALL) registerHooks(settings);

  const foreign = JSON.stringify(settings.hooks).length;
  if (!DRY) fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');

  // --- 4. Compte rendu ---
  const others = Object.values(settings.hooks).flat()
    .flatMap((g) => g.hooks || [])
    .filter((h) => !String(h.command || '').includes(MARKER)).length;
  console.log(`\n  Hooks tiers préservés : ${others}`);
  console.log(`  settings.json : ${before} -> ${foreign} octets de section hooks`);
  console.log(UNINSTALL ? '\n  Désinstallé.\n' : `\n  Terminé. Profil actif : ${process.env.CC_PROFILE || 'standard'}\n  Redémarrer Claude Code pour charger les hooks.\n`);
}

if (require.main === module) main();

module.exports = { pruneBackups, stripOwn, expectedLinks, HOOK_ENTRIES, MARKER, HOOKS_DEST, SETTINGS, SRC };
