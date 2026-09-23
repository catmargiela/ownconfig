'use strict';
/**
 * `Claude/Tableau de bord.md`: recent sessions across all projects and the
 * output-compression savings of the last 7 days. Only the `claude:dashboard`
 * region is rewritten. Every source is read-only and optional.
 */
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('../util');
const { ROOT, DIRS, read, write, writeGuarded, upsertRegion } = require('./store');

const DASHBOARD = path.join(ROOT, 'Tableau de bord.md');
const INDEX = path.join(ROOT, 'Index Claude.md');
const STATS = path.join(STATE_DIR, 'compress-stats.jsonl');
const RECENT = 10;
const JOURNALS_SCANNED = 15;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const TEMPLATE = `---
type: tableau
tags: [claude]
---

# Tableau de bord

> Vue d'ensemble des sessions Claude Code, mise à jour en fin de réponse.
> Seul le bloc balisé est réécrit ; le reste de la page est à toi.
> Voir [[Index Claude]].

<!-- claude:dashboard:start -->
<!-- claude:dashboard:end -->
`;

const SESSION_RE = /<!-- claude:session:([A-Za-z0-9_-]+):start -->\n## (\d{2}:\d{2})–(\d{2}:\d{2}) — ([^\n]*)\n([\s\S]*?)<!-- claude:session:\1:end -->/g;
const HEADLINE_RE = /^> \[!summary\][^\n]*\n> ([^\n]+)/m;

/** New-style session blocks of one journal page. */
function sessionsOf(content) {
  return [...content.matchAll(SESSION_RE)].map((m) => ({
    id: m[1], start: m[2], end: m[3], branch: m[4].trim(),
    headline: ((m[5].match(HEADLINE_RE) || [])[1] || '').trim(),
  }));
}

/** Most recent sessions across journals, latest first. */
function recentSessions(limit = RECENT) {
  let names = [];
  try { names = fs.readdirSync(DIRS.journal).filter((f) => /^\d{4}-\d{2}-\d{2} — .+\.md$/.test(f)); }
  catch { return []; }
  const all = [];
  for (const f of names.sort().reverse().slice(0, JOURNALS_SCANNED)) {
    const content = read(path.join(DIRS.journal, f));
    const projet = (content.match(/^projet:\s*(.+)$/m) || [])[1] || f.slice(13, -3);
    const journal = f.slice(0, -3);
    for (const s of sessionsOf(content)) all.push({ ...s, date: f.slice(0, 10), projet: projet.trim(), journal });
  }
  return all.sort((a, b) => `${b.date} ${b.end}`.localeCompare(`${a.date} ${a.end}`)).slice(0, limit);
}

/** Compression savings over the last 7 days, or null without data. */
function compressionStats(file = STATS, nowMs = Date.now()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const acc = { wrapped: 0, compressed: 0, saved: 0 };
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const t = Date.parse(r?.ts);
    if (!Number.isFinite(t) || nowMs - t > WEEK_MS) continue;
    acc.wrapped++;
    const before = Number(r.before) || 0, after = Number(r.after) || 0;
    if (after < before) { acc.compressed++; acc.saved += before - after; }
  }
  return acc.wrapped ? { ...acc, tokens: Math.round(acc.saved / 4) } : null;
}

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function compressionLine(stats) {
  if (!stats) return '**Compression des sorties (7 j)** : aucune commande enveloppée.';
  return `**Compression des sorties (7 j)** : ${fmt(stats.wrapped)} commandes enveloppées, ` +
    `${fmt(stats.compressed)} compressées, ${fmt(stats.saved)} car. économisés (~${fmt(stats.tokens)} tokens).`;
}

function renderDashboard(sessions, stats) {
  const lines = sessions.map((s) =>
    `- ${s.date} ${s.start}–${s.end} · [[${s.projet}]] — ${s.headline || '_sans résultat_'} · [[${s.journal}|journal]]`);
  return ['## Dernières sessions', '', ...(lines.length ? lines : ['_Aucune session enregistrée._']),
    '', compressionLine(stats)].join('\n');
}

/** Adds a managed link block to an existing Index page lacking the link. */
function linkFromIndex() {
  if (!fs.existsSync(INDEX) || read(INDEX).includes('[[Tableau de bord]]')) return;
  writeGuarded(INDEX, (c) => upsertRegion(c, 'nav', '- [[Tableau de bord]] — sessions récentes et économies de tokens'));
}

/** Creates the page if missing, links it from the Index, and returns its path. */
function ensureDashboard() {
  if (!fs.existsSync(DASHBOARD)) {
    write(DASHBOARD, TEMPLATE);
    linkFromIndex();
  }
  return DASHBOARD;
}

function updateDashboard() {
  const file = ensureDashboard();
  const body = renderDashboard(recentSessions(), compressionStats());
  writeGuarded(file, (c) => {
    const next = upsertRegion(c, 'dashboard', body);
    return next === c ? null : next;
  });
}

module.exports = {
  updateDashboard, ensureDashboard, linkFromIndex, recentSessions, sessionsOf, compressionStats,
  renderDashboard, DASHBOARD, TEMPLATE, STATS,
};
