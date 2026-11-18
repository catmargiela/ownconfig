#!/usr/bin/env node
'use strict';
/**
 * hud-data — what the `hud` plugin shows that the engine does not know: the
 * vault page of a folder and the work session of a conversation.
 *
 *   node ~/.claude/bin/hud-data.js <session-id> [dir]
 *
 * Prints one JSON object: `{ memory, memoryNote, work }`. Reuses the vault's
 * own modules, so the HUD shows what the hooks compute. Its only write is
 * `<session>.hud.json` under state/ccx/: the sign, for the status line, that
 * the HUD is drawn in this conversation. Always exits 0: a part that cannot be
 * read is left null.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(path.dirname(fs.realpathSync(__filename)), '..');
const LIB = path.join(REPO, 'hooks', 'lib', 'vault');
const STATE = path.join(os.homedir(), '.claude', 'state', 'ccx');
const SID = /^[A-Za-z0-9_-]{1,64}$/;
const BILAN_MAX = 1200;
const SECTIONS_MAX = 12;

function readState(file) {
  try { return JSON.parse(fs.readFileSync(path.join(STATE, file), 'utf8')); } catch { return null; }
}

/** The page a session started in `dir` receives; `note` says why when there is nothing to show. */
function memoryOf(dir) {
  const store = require(path.join(LIB, 'store.js'));
  const st = store.vaultStatus();
  if (!st.ok) return { memory: null, note: `Vault inactif : ${store.printable(st.why)}` };
  const r = require(path.join(LIB, 'audit.js')).projectReport(dir);
  const refs = r.page
    ? require(path.join(LIB, 'refs.js')).staleRefs(store.read(r.page), r.paths.length ? r.paths : [dir])
    : [];
  return {
    note: '',
    memory: {
      name: r.name,
      hasPage: Boolean(r.page),
      why: r.page || r.canHavePage.ok ? '' : String(r.canHavePage.why || ''),
      mode: r.summarised ? 'sommaire' : r.injected ? 'entier' : 'vide',
      written: r.written,
      injected: r.injected,
      budget: r.budget,
      startTokens: r.startTokens,
      hasLastSession: Boolean(r.lastSession),
      sections: r.injection.split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim()).slice(0, SECTIONS_MAX),
      staleRefs: refs.length,
    },
  };
}

/** The work session of this conversation (`/startsession`) and the one before on the project. */
function workOf(sid, dir) {
  const ws = require(path.join(LIB, 'worksession.js'));
  const marker = readState(`${sid}.worksession.json`);
  const snap = readState(`${sid}.cost.json`);
  const base = (marker && marker.base) || { cost: 0, added: 0, removed: 0 };
  const prev = ws.previous(require(path.join(LIB, 'naming.js')).memoryName(dir), sid);
  const since = (key) => (snap ? Math.max(0, (Number(snap[key]) || 0) - (Number(base[key]) || 0)) : 0);
  return {
    isOpen: Boolean(marker && !marker.endedAt),
    startedAt: marker ? marker.startedAt || null : null,
    baseUsd: Number(base.cost) || 0,
    added: since('added'),
    removed: since('removed'),
    previous: prev ? {
      isClosed: Boolean(prev.closed),
      startedAt: prev.startedAt || null,
      endedAt: prev.endedAt || null,
      usd: typeof prev.cost === 'number' ? prev.cost : null,
      bilan: String(prev.bilan || '').slice(0, BILAN_MAX),
    } : null,
  };
}

/** Tells the status line the HUD is drawn in this conversation. Never throws. */
function markDrawn(sid) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, `${sid}.hud.json`), JSON.stringify({ at: new Date().toISOString() }));
  } catch { /* the status line simply stays complete */ }
}

function main() {
  const [sid, dir] = process.argv.slice(2);
  const cwd = path.resolve(dir || process.cwd());
  const out = { memory: null, memoryNote: '', work: null };
  try {
    const m = memoryOf(cwd);
    out.memory = m.memory;
    out.memoryNote = m.note;
  } catch (e) { out.memoryNote = `Lecture du vault impossible : ${String(e && e.message)}`; }
  if (SID.test(sid || '')) {
    try { out.work = workOf(sid, cwd); } catch { /* no work-session figures: the HUD says so */ }
    markDrawn(sid);
  }
  process.stdout.write(JSON.stringify(out) + '\n');
}

if (require.main === module) main();
