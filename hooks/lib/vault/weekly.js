'use strict';
/**
 * Weekly digest: `Claude/Journal/Hebdo/YYYY-Www.md`, written once, at the first
 * session start of a new week, for the week that just ended.
 *
 * Sources, all local: session journals (Journal/*.md), the vault history
 * (notes changed), compression statistics, and the guard event log (refusals
 * and warnings, labels only). Nothing is written for an empty week, and an
 * existing digest is never rewritten: once created, the file is the user's.
 * Off with CC_VAULT_WEEKLY=off or whenever the vault is off.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const history = require('./history');
const { STATE_DIR, EVENTS_FILE } = require('../util');

const STATS_FILE = path.join(STATE_DIR, 'compress-stats.jsonl');
const DAY = 86400000;

/** ISO 8601 week of a date: { year, week, start (Monday 00:00 local), end (next Monday) }. */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() || 7) - 1));
  return { year, week, start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
}

const weekName = (w) => `${w.year}-W${String(w.week).padStart(2, '0')}`;
const dayFr = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const inRange = (t, w) => t >= w.start.getTime() && t < w.end.getTime();

function jsonl(file, w) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && inRange(Date.parse(r.ts), w));
  } catch { return []; }
}

/** Sessions per project, from the journals whose file name date falls in the week. */
function sessions(w) {
  const perProject = new Map();
  let names = [];
  try { names = fs.readdirSync(store.DIRS.journal).filter((f) => /^\d{4}-\d{2}-\d{2} — .+\.md$/.test(f)); } catch { /* none */ }
  for (const f of names) {
    const [y, m, d] = f.slice(0, 10).split('-').map(Number);
    if (!inRange(new Date(y, m - 1, d).getTime(), w)) continue;
    const text = store.read(path.join(store.DIRS.journal, f));
    const project = (text.match(/^projet:\s*(.+)$/m) || [])[1] || f.slice(13, -3);
    const n = Number((text.match(/^sessions:\s*(\d+)$/m) || [])[1]) || 1;
    perProject.set(project.trim(), (perProject.get(project.trim()) || 0) + n);
  }
  return [...perProject].sort((a, b) => b[1] - a[1]);
}

function compression(w) {
  const rows = jsonl(STATS_FILE, w);
  const done = rows.filter((r) => r.after < r.before);
  const saved = done.reduce((n, r) => n + (r.before - r.after), 0);
  const byCmd = new Map();
  for (const r of done) byCmd.set(r.cmd, (byCmd.get(r.cmd) || 0) + (r.before - r.after));
  return { wrapped: rows.length, compressed: done.length, saved, top: [...byCmd].sort((a, b) => b[1] - a[1]).slice(0, 3) };
}

function guards(w) {
  const counts = new Map();
  for (const e of jsonl(EVENTS_FILE, w)) counts.set(e.label, (counts.get(e.label) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function render(w, prev, data) {
  const out = [`---\ntype: hebdo\nsemaine: ${weekName(w)}\n---\n`,
    `# Semaine ${weekName(w)} — du ${dayFr(w.start)} au ${dayFr(new Date(w.end - DAY))}`, '',
    `Précédente : [[${weekName(prev)}]]`, '', '## Sessions'];
  out.push(...(data.sessions.length ? data.sessions.map(([p, n]) => `- [[${p}]] : ${n}`) : ['- aucune']));
  out.push('', '## Notes du vault modifiées');
  out.push(...(data.notes.length ? data.notes.map((n) => `- [[${n.file.replace(/\.md$/, '')}]] (${n.commits})`) : ['- aucune (ou historique absent)']));
  const c = data.compression;
  out.push('', '## Compression des sorties',
    `- ${c.compressed} commande(s) compressée(s) sur ${c.wrapped} enveloppée(s), ${k(c.saved)} caractères économisés (≈ ${k(Math.round(c.saved / 4))} tokens, est.)`);
  if (c.top.length) out.push(`- Plus rentables : ${c.top.map(([cmd, n]) => `\`${cmd}\` ${k(n)}`).join(', ')}`);
  out.push('', '## Garde-fous déclenchés');
  out.push(...(data.guards.length ? data.guards.map(([label, n]) => `- ${n} × ${label}`) : ['- aucun']));
  out.push('', '> Généré une fois par la config ; ce fichier t\'appartient ensuite.', '');
  return out.join('\n');
}

/** Write last week's digest if missing and the week was not empty. Returns the path written, or null. */
function writeDigest(now = new Date()) {
  if (String(process.env.CC_VAULT_WEEKLY || '').trim().toLowerCase() === 'off' || !store.enabled()) return null;
  const current = isoWeek(now);
  const last = isoWeek(new Date(current.start.getTime() - DAY));
  const prev = isoWeek(new Date(last.start.getTime() - DAY));
  const file = path.join(store.DIRS.journal, 'Hebdo', `${weekName(last)}.md`);
  if (fs.existsSync(file)) return null;
  const notes = history.changedBetween(last.start, last.end)
    .filter((n) => !n.file.startsWith('Journal/')).slice(0, 12);
  const data = { sessions: sessions(last), notes, compression: compression(last), guards: guards(last) };
  if (!data.sessions.length && !notes.length && !data.compression.wrapped && !data.guards.length) return null;
  return store.write(file, render(last, prev, data)) ? file : null;
}

function onStart() {
  try { writeDigest(); } catch (err) { store.debug(`hebdo : ${err.message}`); }
}

module.exports = { onStart, writeDigest, isoWeek, weekName, render };
