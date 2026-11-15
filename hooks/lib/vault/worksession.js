'use strict';
/**
 * Work sessions: a stretch of work the user opens and closes himself
 * (`/startsession`, `/endsession`), one per Claude Code conversation.
 *
 * The cost comes from the status line, the only place Claude Code hands it to:
 * it saves `<session>.cost.json`, and a session's cost is the difference
 * between its end and its start. Every session is appended to a local ledger
 * (`worksessions.jsonl`), which is how the next start can tell what came before.
 */
const fs = require('fs');
const path = require('path');
const { readState, writeState, ensureDir, STATE_DIR } = require('../util');
const store = require('./store');
const naming = require('./naming');
const { journalTemplate } = require('./pages');
const { latestJournal } = require('./inject');
const { sessionsOf } = require('./dashboard');
const { safe } = require('./render');
const { SECRET_PATTERNS, isPlaceholder } = require('../secret-guard');

const LEDGER = path.join(STATE_DIR, 'worksessions.jsonl');
const LEDGER_MAX = 512 * 1024;
const BILAN_MAX = 1500;
const RECENT = 3;
const BRANCH_MAX = 100;
const ZERO = { cost: 0, added: 0, removed: 0 };

const validSid = (sid) => /^[A-Za-z0-9_-]{1,64}$/.test(String(sid || ''));
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** Last figures the status line saved for a conversation, or null. */
function costOf(sid) {
  const s = readState(sid, 'cost', null);
  return s && typeof s === 'object' ? { cost: num(s.cost), added: num(s.added), removed: num(s.removed) } : null;
}

/** Figures since `base`. A counter below its baseline restarted from zero: it is then counted whole. */
function delta(now, base) {
  const from = now.cost < base.cost ? ZERO : base;
  return {
    cost: now.cost - from.cost,
    added: Math.max(0, now.added - from.added),
    removed: Math.max(0, now.removed - from.removed),
  };
}

/**
 * The closing summary ends up in the journal and in the vault history, which
 * never forgets: anything shaped like a credential is removed first.
 */
function redact(text) {
  let out = String(text || '');
  for (const { kind, re } of SECRET_PATTERNS) {
    out = out.replace(re, (m) => (kind === 'clé privée' || !isPlaceholder(m) ? '[secret retiré]' : m));
  }
  return out;
}

function readLedger() {
  return store.read(LEDGER).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && typeof e === 'object');
}

/** Appends one line; past LEDGER_MAX the older half goes. Never throws. */
function append(entry) {
  try {
    ensureDir(STATE_DIR);
    fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
    if (fs.statSync(LEDGER).size <= LEDGER_MAX) return;
    const lines = store.read(LEDGER).split('\n').filter(Boolean);
    store.write(LEDGER, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
  } catch { /* the ledger never matters more than the session */ }
}

/**
 * The session before this one on the same project: closed (its figures and
 * closing summary) or left open (its last known cost).
 */
function previous(project, sid) {
  const mine = readLedger().filter((e) => e.project === project && e.sid !== sid);
  const at = mine.map((e) => e.type).lastIndexOf('start');
  if (at < 0) return null;
  const start = mine[at];
  // Only an end written after this start closes it: a session may be reopened.
  const end = mine.slice(at + 1).filter((e) => e.type === 'end' && e.sid === start.sid).pop();
  if (end) return { closed: true, startedAt: start.startedAt, endedAt: end.endedAt, cost: end.cost, added: end.added, removed: end.removed, bilan: end.bilan || '' };
  const last = costOf(start.sid);
  return { closed: false, startedAt: start.startedAt, cost: last ? delta(last, start.base || ZERO).cost : null };
}

/** Result headlines of the latest journal of the project, oldest first. */
function recentResults(project) {
  return sessionsOf(latestJournal(project) || '').filter((s) => s.headline).slice(-RECENT)
    .map((s) => `${s.start}–${s.end} : ${s.headline}`);
}

function start(sid, cwd, now = new Date()) {
  const project = naming.memoryName(cwd);
  const snap = costOf(sid);
  const before = previous(project, sid);
  const marker = { sid, project, cwd, startedAt: now.toISOString(), base: snap || ZERO };
  writeState(sid, 'worksession', marker);
  append({ type: 'start', ...marker });
  return { project, startedAt: marker.startedAt, branch: naming.currentBranch(cwd).slice(0, BRANCH_MAX), previous: before, recent: recentResults(project) };
}

function journalBody(r) {
  const head = r.startedAt
    ? `## Session de travail ${naming.hhmm(r.startedAt)} → ${naming.hhmm(r.endedAt)}`
    : `## Session de travail, fermée à ${naming.hhmm(r.endedAt)}`;
  return [head, figures(r), r.bilan && `\n${safe(r.bilan)}`].filter(Boolean).join('\n');
}

/** Closing block in today's journal, rewritten in place when the session is closed twice. */
function writeJournal(r, cwd) {
  if (!store.enabled()) return null;
  store.ensureDirs();
  const file = naming.journalFile(r.project);
  const page = fs.existsSync(naming.resolveProjectFile(cwd)) ? r.project : null;
  if (!fs.existsSync(file)) store.write(file, journalTemplate(r.project, page, naming.today()));
  return store.writeGuarded(file, (c) => store.upsertRegion(c, `worksession:${r.sid}`, journalBody(r))) ? file : null;
}

function end(sid, cwd, bilan = '', now = new Date()) {
  const marker = readState(sid, 'worksession', null);
  const opened = Boolean(marker && marker.startedAt);
  const snap = costOf(sid);
  const d = snap ? delta(snap, (opened && marker.base) || ZERO) : null;
  const result = {
    sid, opened,
    project: (opened && marker.project) || naming.memoryName(cwd),
    startedAt: opened ? marker.startedAt : null,
    endedAt: now.toISOString(),
    cost: d ? d.cost : null, added: d ? d.added : 0, removed: d ? d.removed : 0,
    bilan: redact(bilan).trim().slice(0, BILAN_MAX),
  };
  const journal = writeJournal(result, cwd);
  append({ type: 'end', ...result });
  if (opened) writeState(sid, 'worksession', { ...marker, endedAt: result.endedAt });
  return { ...result, journal };
}

// ---------------------------------------------------------------- wording

const money = (n) => (n === null || n === undefined ? 'coût inconnu' : `${num(n).toFixed(2).replace('.', ',')} $`);

function span(fromIso, toIso) {
  const min = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

const day = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });

function figures(r) {
  const parts = [r.startedAt && span(r.startedAt, r.endedAt), money(r.cost)];
  if (r.added || r.removed) parts.push(`+${r.added} / −${r.removed} lignes`);
  return parts.filter(Boolean).join(' · ');
}

function describePrevious(p) {
  if (!p) return ['Première session de travail enregistrée sur ce projet.'];
  if (!p.closed) {
    return [`Session précédente (${day(p.startedAt)} à ${naming.hhmm(p.startedAt)}) non fermée par /endsession — dernier coût connu : ${money(p.cost)}.`];
  }
  const head = `Dernière fois (${day(p.startedAt)}, ${naming.hhmm(p.startedAt)} → ${naming.hhmm(p.endedAt)}, ${figures(p)}) :`;
  return [head, p.bilan || '(aucun bilan noté)'];
}

function describeStart(r) {
  const lines = [`Session ouverte — ${r.project} · ${day(r.startedAt)} à ${naming.hhmm(r.startedAt)}${r.branch ? ` · branche ${r.branch}` : ''}`,
    '', ...describePrevious(r.previous)];
  if (r.recent.length) lines.push('', 'Derniers résultats du journal :', ...r.recent.map((l) => `- ${l}`));
  return lines.join('\n');
}

function describeEnd(r) {
  const head = r.opened
    ? `Session fermée — ${r.project} · ${naming.hhmm(r.startedAt)} → ${naming.hhmm(r.endedAt)} (${figures(r)})`
    : `Session fermée — ${r.project} · ${figures(r)} (pas de /startsession : chiffres de toute la conversation)`;
  const lines = [head];
  if (r.cost === null) lines.push('Coût inconnu : la barre de statut n\'a encore rien enregistré pour cette conversation.');
  lines.push(r.journal ? `Journal : ${r.journal}` : 'Journal non écrit (vault inactif).');
  return lines.join('\n');
}

module.exports = { start, end, describeStart, describeEnd, validSid, costOf, previous, redact, LEDGER };
