'use strict';
/**
 * Vault storage primitives: location, safety checks, atomic and guarded writes,
 * managed regions.
 *
 * Absolute rule: hooks only write inside `<!-- claude:xxx:start -->` …
 * `<!-- claude:xxx:end -->` regions. Everything else on a page belongs to the
 * user and is never rewritten.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VAULT = process.env.CC_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault');
const ROOT = path.join(VAULT, 'Claude');
const DIRS = { projets: path.join(ROOT, 'Projets'), journal: path.join(ROOT, 'Journal'), profil: path.join(ROOT, 'Profil') };

// Injection budget at session start: what separates useful memory from a tax.
const BUDGET = {
  projet: Number(process.env.CC_VAULT_BUDGET_PROJET) || 3000,
  profil: Number(process.env.CC_VAULT_BUDGET_PROFIL) || 1500,
  journal: Number(process.env.CC_VAULT_BUDGET_JOURNAL) || 1200,
};

/**
 * Places never written to, even when the path exists: a plugin cache or a cloned
 * repository is not a knowledge base, and notes written there vanish on cleanup.
 */
const FORBIDDEN = [
  path.join('.claude', 'plugins'),
  path.join('.claude', 'jobs'),
  'node_modules',
  '.claude-config',
  path.join('.claude', 'state'),
];

const debug = (msg) => { if (process.env.CCX_DEBUG === '1') process.stderr.write(`[vault] ${msg}\n`); };

/**
 * A vault is recognised only with proof — a `.obsidian` folder, or an explicit
 * designation. When in doubt, nothing is written.
 */
function vaultStatus() {
  if (process.env.CC_VAULT_DISABLED === '1') return { ok: false, why: 'désactivé (CC_VAULT_DISABLED=1)' };

  let real = VAULT;
  try { real = fs.realpathSync(VAULT); } catch { return { ok: false, why: `chemin introuvable : ${VAULT}` }; }

  try { if (!fs.statSync(real).isDirectory()) return { ok: false, why: 'la cible n\'est pas un dossier' }; }
  catch { return { ok: false, why: 'chemin illisible' }; }

  const hit = FORBIDDEN.find((frag) => real.includes(path.sep + frag) || real.endsWith(path.sep + frag));
  if (hit) return { ok: false, why: `emplacement interdit (contient « ${hit} »)` };

  const explicit = Boolean(process.env.CC_VAULT);
  if (!explicit && !fs.existsSync(path.join(real, '.obsidian'))) {
    return { ok: false, why: 'aucun dossier .obsidian — définir CC_VAULT pour forcer' };
  }
  return { ok: true, root: real };
}

function enabled() {
  const st = vaultStatus();
  if (!st.ok) debug(`inactif : ${st.why}`);
  return st.ok;
}

function ensureDirs() {
  for (const d of [ROOT, ...Object.values(DIRS)]) fs.mkdirSync(d, { recursive: true });
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const hash = (t) => crypto.createHash('sha256').update(t || '').digest('hex');

/** Atomic write: a half-written file must never be read back as truth. */
function write(f, c) {
  const tmp = `${f}.tmp.${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(tmp, c);
    fs.renameSync(tmp, f);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

/** Synchronous pause: hooks have no event loop to wait on. */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* busy wait */ } }
}

/**
 * Exclusive per-file lock. `mkdir` is atomic on POSIX and Windows. A stale lock
 * (killed process) is taken over after LOCK_STALE_MS; an unobtainable lock makes
 * the writer give up rather than overwrite.
 */
const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 30000;

function withLock(key, fn) {
  const dir = path.join(os.tmpdir(), `ccx-vault-${hash(key).slice(0, 16)}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try { fs.mkdirSync(dir); break; }
    catch (err) {
      if (err.code !== 'EEXIST') return fn(); // locking impossible: never block the work
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > LOCK_STALE_MS) { fs.rmdirSync(dir); continue; }
      } catch { /* lock just vanished: retry */ }
      if (Date.now() > deadline) { debug(`verrou non obtenu : ${key}`); return null; }
      sleepSync(25);
    }
  }

  try { return fn(); }
  finally { try { fs.rmdirSync(dir); } catch { /* ignore */ } }
}

/**
 * Read-modify-write guarded by the expected hash: if the content changed since
 * it was read, the mutation is replayed on the fresh version. A persistent
 * conflict gives up — never overwrites.
 */
function writeGuarded(file, mutate, attempts = 3) {
  return withLock(file, () => guardedInner(file, mutate, attempts)) !== null;
}

function guardedInner(file, mutate, attempts) {
  for (let i = 0; i < attempts; i++) {
    const before = read(file);
    const next = mutate(before);
    if (next === null || next === before) return true; // nothing to do
    if (hash(read(file)) !== hash(before)) continue;   // changed meanwhile: replay
    if (write(file, next)) return true;
  }
  debug(`conflit persistant, écriture abandonnée : ${file}`);
  return false;
}

// ---------------------------------------------------------------- managed regions

const KEY_CHARS = '[A-Za-z0-9:_-]+';

/** Replaces the body of a managed region, appending the region when absent. */
function upsertRegion(content, key, body) {
  const start = `<!-- claude:${key}:start -->`;
  const end = `<!-- claude:${key}:end -->`;
  const block = `${start}\n${body}\n${end}`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  return re.test(content) ? content.replace(re, () => block) : `${content.trimEnd()}\n\n${block}\n`;
}

function readRegion(content, key) {
  const m = content.match(new RegExp(`<!-- claude:${key}:start -->([\\s\\S]*?)<!-- claude:${key}:end -->`));
  return m ? m[1].trim() : '';
}

/** Removes managed regions: only what the user wrote remains. */
function stripRegions(content) {
  const re = new RegExp(`<!-- claude:${KEY_CHARS}:start -->[\\s\\S]*?<!-- claude:${KEY_CHARS}:end -->`, 'g');
  return content.replace(re, '').trim();
}

function stripFrontmatter(content) {
  return content.startsWith('---') ? content.replace(/^---[\s\S]*?\n---\n?/, '').trim() : content.trim();
}

module.exports = {
  VAULT, ROOT, DIRS, BUDGET, vaultStatus, enabled, ensureDirs, debug,
  read, write, hash, withLock, writeGuarded,
  upsertRegion, readRegion, stripRegions, stripFrontmatter,
};
