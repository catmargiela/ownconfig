#!/usr/bin/env node
'use strict';
/**
 * config-doctor — does ~/.claude still match this repository?
 *
 *   node ~/.claude/bin/config-doctor.js [--json]
 *
 * Read-only: it never repairs, never writes, never touches the network (git
 * ahead/behind is read from the last fetch). Each check yields OK, WARN or
 * FAIL; exit code 1 when anything FAILs. Linked into ~/.claude/bin by
 * install.js, so the repository is found through the link itself.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(path.dirname(fs.realpathSync(__filename)), '..');
const install = require(path.join(REPO, 'install.js'));
const CLAUDE = path.dirname(install.SETTINGS);
const tilde = (p) => p.replace(require('os').homedir(), '~');
const item = (level, label, detail = '') => ({ level, label, detail });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** Every link install.js lays down must exist and resolve into the repository. */
function checkLinks() {
  const broken = [];
  for (const [src, dest] of install.expectedLinks()) {
    let st;
    try { st = fs.lstatSync(dest); } catch { broken.push(`${tilde(dest)} absent`); continue; }
    if (!st.isSymbolicLink()) { broken.push(`${tilde(dest)} n'est pas un lien`); continue; }
    let real;
    try { real = fs.realpathSync(dest); } catch { broken.push(`${tilde(dest)} lien cassé`); continue; }
    if (real !== fs.realpathSync(src)) broken.push(`${tilde(dest)} → ${tilde(real)}`);
  }
  const total = install.expectedLinks().length;
  return broken.length
    ? [item('FAIL', 'Liens', `${broken.length}/${total} faux : ${broken.slice(0, 4).join(' ; ')}`)]
    : [item('OK', 'Liens', `${total} liens vers le dépôt`)];
}

/** Commands registered under one event of settings.json. */
function commandsOf(settings, event) {
  const groups = (settings.hooks || {})[event];
  return (Array.isArray(groups) ? groups : []).flatMap((g) => (g && g.hooks) || []).map((h) => String(h.command || ''));
}

/** Our hook entries: each one present exactly once, under the event it belongs to. */
function checkHooks(settings) {
  const bad = install.HOOK_ENTRIES.filter((e) => {
    const n = commandsOf(settings, e.event).filter((c) => c.includes(install.MARKER) && c.trim().endsWith(` ${e.arg}`)).length;
    return n !== 1;
  }).map((e) => `${e.event}:${e.arg}`);
  return bad.length
    ? [item('FAIL', 'Hooks enregistrés', `absents ou en double : ${bad.join(', ')} (relancer install.js)`)]
    : [item('OK', 'Hooks enregistrés', `${install.HOOK_ENTRIES.length} entrées`)];
}

function checkStatusAndTheme(settings) {
  const out = [];
  const cmd = String((settings.statusLine || {}).command || '');
  out.push(cmd.includes('statusline.sh')
    ? item('OK', 'Status line', cmd)
    : item('WARN', 'Status line', cmd ? `commande tierce : ${cmd}` : 'aucune'));
  const theme = String(settings.theme || '');
  if (theme.startsWith('custom:')) {
    const file = path.join(CLAUDE, 'themes', `${theme.slice(7)}.json`);
    out.push(fs.existsSync(file) ? item('OK', 'Thème', theme) : item('FAIL', 'Thème', `${theme} : ${tilde(file)} absent`));
  } else out.push(item('OK', 'Thème', theme || 'défaut'));
  return out;
}

function checkSettings() {
  const settings = readJson(install.SETTINGS);
  if (!settings || typeof settings !== 'object') {
    return [item('FAIL', 'settings.json', 'absent ou JSON invalide')];
  }
  return [item('OK', 'settings.json', 'JSON valide'), ...checkHooks(settings), ...checkStatusAndTheme(settings)];
}

/** Installed rebenga version against the repository's plugin.json. */
function checkPlugin() {
  const want = (readJson(path.join(REPO, 'plugins', 'rebenga', '.claude-plugin', 'plugin.json')) || {}).version;
  const rec = ((readJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json')) || {}).plugins || {})['rebenga@ownconfig'];
  const got = Array.isArray(rec) && rec[0] ? rec[0].version : undefined;
  if (!got) return [item('WARN', 'Plugin rebenga', 'non installé (claude plugin install rebenga@ownconfig)')];
  if (got !== want) {
    return [item('WARN', 'Plugin rebenga', `installé ${got}, dépôt ${want} : claude plugin marketplace update ownconfig && claude plugin update rebenga@ownconfig`)];
  }
  return [item('OK', 'Plugin rebenga', got)];
}

function git(args) {
  const r = spawnSync('git', ['-C', REPO, '--no-optional-locks', ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Branch, local changes and distance to origin/main, from the last fetch only. */
function checkRepo() {
  const branch = git(['branch', '--show-current']);
  if (branch === null) return [item('WARN', 'Dépôt', `${tilde(REPO)} n'est pas un dépôt git`)];
  const dirty = (git(['status', '--porcelain']) || '').split('\n').filter(Boolean).length;
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
  const [ahead, behind] = counts ? counts.split(/\s+/).map(Number) : [0, 0];
  const notes = [];
  // Shown verbatim to the user and the model: printable characters only, bounded.
  const shown = branch.replace(/[^\x20-\x7e]/g, '?').slice(0, 60);
  if (branch !== 'main') notes.push(`branche ${shown || '(détachée)'}`);
  if (dirty) notes.push(`${dirty} fichier(s) modifié(s)`);
  if (behind) notes.push(`${behind} commit(s) de retard sur origin/main`);
  if (ahead && branch === 'main') notes.push(`${ahead} commit(s) non poussé(s)`);
  return [notes.length ? item('WARN', 'Dépôt', notes.join(', ')) : item('OK', 'Dépôt', 'main, propre, à jour')];
}

/** The installed dispatcher answers a harmless call quickly and with exit 0. */
function checkDispatch() {
  const dispatch = path.join(install.HOOKS_DEST, 'dispatch.js');
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [dispatch, 'pre-bash'], { input, encoding: 'utf8', timeout: 10000 });
  const ms = Date.now() - t0;
  if (r.error || r.status !== 0) return [item('FAIL', 'Dispatcher', `sortie ${r.status}${r.error ? ` (${r.error.code})` : ''}`)];
  return [item(ms > 1500 ? 'WARN' : 'OK', 'Dispatcher', `pre-bash répond en ${ms} ms`)];
}

/** Interpreter for the token-saver engine; its absence only means Node-only compression. */
function checkPython() {
  const { pythonCandidates } = require(path.join(REPO, 'hooks', 'lib', 'compress', 'python.js'));
  const ok = pythonCandidates().find((p) => (spawnSync(p, ['-c', 'import sys; print(sys.version_info >= (3, 10))'],
    { encoding: 'utf8' }).stdout || '').trim() === 'True');
  return [ok ? item('OK', 'Moteur token-saver', ok) : item('WARN', 'Moteur token-saver', 'aucun python >= 3.10 : compression Node seule')];
}

function runChecks() {
  return [checkLinks, checkSettings, checkPlugin, checkRepo, checkDispatch, checkPython].flatMap((f) => {
    try { return f(); } catch (e) { return [item('FAIL', f.name, e.message)]; }
  });
}

function main() {
  const results = runChecks();
  if (process.argv.includes('--json')) console.log(JSON.stringify(results));
  else {
    const mark = { OK: 'OK  ', WARN: 'WARN', FAIL: 'FAIL' };
    for (const r of results) console.log(`${mark[r.level]}  ${r.label.padEnd(20)} ${r.detail}`);
    const n = (l) => results.filter((r) => r.level === l).length;
    console.log(`\n${n('OK')} OK · ${n('WARN')} avertissement(s) · ${n('FAIL')} erreur(s) — dépôt ${tilde(REPO)}`);
  }
  process.exit(results.some((r) => r.level === 'FAIL') ? 1 : 0);
}

if (require.main === module) main();
module.exports = { runChecks };
