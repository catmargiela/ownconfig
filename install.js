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
const MARKER = path.join('hooks', 'ccx', 'dispatch.js'); // signature de nos entrées

const DRY = process.argv.includes('--dry-run');
const UNINSTALL = process.argv.includes('--uninstall');

const log = (...a) => console.log(DRY ? '[dry-run]' : '        ', ...a);

const HOOK_ENTRIES = [
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit', arg: 'pre-edit', timeout: 10 },
  { event: 'PreToolUse', matcher: 'Bash', arg: 'pre-bash', timeout: 10 },
  { event: 'PostToolUse', matcher: 'Edit|Write|MultiEdit', arg: 'post-edit', timeout: 5 },
  { event: 'PreCompact', matcher: 'manual|auto', arg: 'pre-compact', timeout: 30 },
  { event: 'Stop', matcher: undefined, arg: 'stop', timeout: 60 },
  { event: 'SessionStart', matcher: 'startup|resume|clear', arg: 'session-start', timeout: 10 },
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

function main() {
  if (!fs.existsSync(CLAUDE)) { console.error('~/.claude introuvable — Claude Code est-il installé ?'); process.exit(1); }

  console.log(UNINSTALL ? '\n  Désinstallation\n' : '\n  Installation de la configuration Claude Code\n');

  // --- 1. Fichiers ---
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

  if (UNINSTALL) targets.forEach(([, d]) => unlink(d));
  else targets.forEach(([s, d]) => link(s, d));

  // --- 2. Ossature du vault Obsidian ---
  if (!UNINSTALL && !DRY) {
    try { require('./scaffold-vault.js'); }
    catch (e) { console.log('        ! vault non initialisé :', e.message); }
  }

  // --- 3. settings.json ---
  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    const raw = fs.readFileSync(SETTINGS, 'utf8');
    try { settings = JSON.parse(raw); }
    catch { console.error('settings.json est illisible (JSON invalide) — abandon, rien n\'a été modifié.'); process.exit(1); }
    const backup = `${SETTINGS}.ccx-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (!DRY) fs.writeFileSync(backup, raw);
    log('sauvegarde', path.basename(backup));
  }

  settings.hooks = settings.hooks || {};
  const before = JSON.stringify(settings.hooks).length;
  const removed = stripOwn(settings);
  if (removed) log(`${removed} ancienne(s) entrée(s) retirée(s)`);

  if (!UNINSTALL) {
    const dispatch = path.join(HOOKS_DEST, 'dispatch.js');
    for (const e of HOOK_ENTRIES) {
      settings.hooks[e.event] = settings.hooks[e.event] || [];
      const group = { hooks: [{ type: 'command', command: `node "${dispatch}" ${e.arg}`, timeout: e.timeout }] };
      if (e.matcher) group.matcher = e.matcher;
      settings.hooks[e.event].push(group);
    }
    log(`${HOOK_ENTRIES.length} hooks enregistrés`);
  }

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

main();
