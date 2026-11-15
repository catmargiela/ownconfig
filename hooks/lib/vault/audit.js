'use strict';
/**
 * Read-only diagnosis of the vault, shared by `vault-lint.js` (full report),
 * `config-doctor` (one line) and `/rebenga:vault-status` (current project).
 *
 * It answers two questions: is every page reachable from the folders it is
 * about, and what does a session really receive at start?
 */
const fs = require('fs');
const path = require('path');
const { ROOT, DIRS, BUDGET, read, readRegion, printable } = require('./store');
const { declaredPaths, candidatePages, canHavePage, withPageCache } = require('./identity');
const { resolveProjectFile, memoryName } = require('./naming');
const { cleanForInjection, buildInjection } = require('./inject');

const BIG_PAGE = 12000;
const tok = (s) => Math.round((s || '').length / 4);
/** Page name as shown in a report. */
const nameOf = (file) => printable(path.basename(file, '.md'));

function listMd(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(dir, f)); }
  catch { return []; }
}

/** Groups of pages declaring a same folder, each group reported once. */
function conflictsOf(pages) {
  const seen = new Map();
  for (const p of pages) {
    for (const dir of p.paths) {
      const group = candidatePages(dir).map((c) => nameOf(c.file));
      if (group.length > 1) seen.set(group.join('|'), { pages: group, winner: nameOf(resolveProjectFile(dir)) });
    }
  }
  return [...seen.values()];
}

/** Links to pages that do not exist, across the whole vault. */
function brokenLinks(files) {
  const known = new Set(files.map(nameOf));
  const out = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/\[\[([^\]|#]+)/g)) {
      const target = m[1].trim();
      if (target && !known.has(target)) out.push({ page: path.relative(ROOT, f), target });
    }
  }
  return out;
}

/** One record per project page: identity, size, and what it costs at session start. */
function pageRecord(file) {
  const raw = read(file);
  const clean = cleanForInjection(raw);
  const paths = declaredPaths(raw);
  // A hand-written page about a folder outside git is deliberate: only an empty one is reported.
  const excluded = paths.map((dir) => ({ dir, ...canHavePage(dir) }))
    .filter((c) => !c.ok && (c.code !== 'no-git' || !clean));
  return {
    name: nameOf(file), paths, excluded,
    written: clean.length,
    injected: Math.min(clean.length, BUDGET.projet),
    raw: raw.length,
    hasSessions: Boolean(readRegion(raw, 'journal').trim()),
    startTokens: paths.length ? tok(buildInjection(paths[0])) : 0,
  };
}

/** Whole-vault findings. Never writes. Pages are read once for the whole audit. */
function auditVault() {
  return withPageCache(scanVault);
}

function scanVault() {
  const projets = listMd(DIRS.projets);
  const journaux = listMd(DIRS.journal);
  const pages = projets.map(pageRecord);
  return {
    counts: { projets: projets.length, journaux: journaux.length },
    pages,
    sansChemin: pages.filter((p) => !p.paths.length).map((p) => p.name),
    doublons: conflictsOf(pages),
    horsProjet: pages.filter((p) => p.excluded.length).map((p) => ({ name: p.name, why: p.excluded[0].why })),
    muettes: pages.filter((p) => !p.written).map((p) => p.name),
    tronquees: pages.filter((p) => p.written > BUDGET.projet).map((p) => ({ name: p.name, written: p.written })),
    grosses: pages.filter((p) => p.raw > BIG_PAGE).map((p) => ({ name: p.name, raw: p.raw })),
    inutilisees: pages.filter((p) => !p.hasSessions).map((p) => p.name),
    liensCasses: brokenLinks([...projets, ...journaux, ...listMd(ROOT)]),
    budget: BUDGET.projet,
  };
}

/** What a session opened in `dir` gets: the page used, its size and the injected text. */
function projectReport(dir) {
  const file = resolveProjectFile(dir);
  const exists = fs.existsSync(file);
  const raw = exists ? read(file) : '';
  const written = cleanForInjection(raw).length;
  const injection = buildInjection(dir) || '';
  return {
    dir,
    name: printable(memoryName(dir)),
    page: exists ? file : null,
    paths: declaredPaths(raw),
    canHavePage: canHavePage(dir),
    conflict: candidatePages(dir).map((c) => nameOf(c.file)),
    written,
    injected: Math.min(written, BUDGET.projet),
    truncated: written > BUDGET.projet,
    budget: BUDGET.projet,
    lastSession: injection.includes('### Dernière session'),
    startTokens: tok(injection),
    injection,
  };
}

module.exports = { auditVault, projectReport, tok };
