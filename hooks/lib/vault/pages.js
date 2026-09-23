'use strict';
/**
 * Journal and project pages. Hooks only write inside managed regions, plus the
 * journal frontmatter keys they own (`sessions`, `branches`, `tags`).
 */
const fs = require('fs');
const path = require('path');
const { write, writeGuarded, upsertRegion, readRegion } = require('./store');
const { projectFile, resolveProjectFile, projectDir, today } = require('./naming');
const { updateFrontmatter, tagOf, safe } = require('./render');
const { oneLine, trimAtWord } = require('./filters');

const PROJECT_ENTRIES = 15;
const SESSION_START = /<!-- claude:session:[A-Za-z0-9_-]+:start -->/g;
const LEGACY_BLOCK = /^## \d{2}:\d{2} — Fin de session/gm;

/** Creates the project page when absent. NEVER rewrites an existing page. */
function ensureProjectPage(name, cwd) {
  const existing = cwd ? resolveProjectFile(cwd) : projectFile(name);
  if (fs.existsSync(existing)) return existing;
  const f = projectFile(name);
  if (fs.existsSync(f)) return f;
  write(f, `---
type: projet
tags: [claude, projet]
chemin: ${cwd ? projectDir(cwd) : ''}
---

# ${name}

> Page de contexte lue par Claude Code au début de chaque session sur ce projet.
> Tout ce qui est écrit ici hors des blocs balisés est à toi, et n'est jamais réécrit.
> Voir [[Index Claude]], [[Tableau de bord]] et [[Façon de coder]].

## Ce que c'est

<!-- Une ou deux phrases : à quoi sert ce projet, pour qui. -->

## Stack et commandes

<!-- dev / build / test / déploiement -->

## Décisions

<!-- Les choix structurants et leur raison. C'est la section la plus utile. -->

## Pièges

<!-- Ce qui a déjà fait perdre du temps ici. -->

## Sessions

<!-- claude:journal:start -->
<!-- claude:journal:end -->
`);
  return f;
}

function journalTemplate(name, page, date) {
  return `---
type: session
date: ${date}
projet: ${page}
tags: [claude, session, ${tagOf(name)}]
sessions: 0
---

# ${date} — [[${page}]]
`;
}

/** Sessions recorded in a journal: new-style regions plus legacy end-of-session blocks. */
function countSessions(content) {
  return (content.match(SESSION_START) || []).length + (content.match(LEGACY_BLOCK) || []).length;
}

/**
 * Writes (or updates in place) the session's managed block in the journal.
 * Legacy `## HH:MM — Fin de session` blocks are left untouched.
 */
function writeSession(file, { sid, body, name, page, branches }) {
  if (!fs.existsSync(file)) write(file, journalTemplate(name, page, path.basename(file).slice(0, 10)));
  return writeGuarded(file, (content) => {
    const withBlock = upsertRegion(content, `session:${sid}`, body);
    return updateFrontmatter(withBlock, { sessions: countSessions(withBlock), branches, projet: name });
  });
}

const dateOf = (line) => (line.match(/\[\[(\d{4}-\d{2}-\d{2})/) || [])[1] || '';

/**
 * Project page session list, latest first: `- [[journal]] — headline`.
 * The session's previous line (`prevEntry`) is replaced; a bare legacy link to
 * the same journal is superseded. Returns the line written.
 */
function updateProjectEntries(pageFile, journalName, headline, prevEntry) {
  const link = `[[${journalName}]]`;
  const h = headline ? trimAtWord(oneLine(safe(headline)), 140) : '';
  const entry = h ? `- ${link} — ${h}` : `- ${link}`;
  writeGuarded(pageFile, (content) => {
    const lines = readRegion(content, 'journal').split('\n').filter((l) => l.trim());
    const kept = lines.filter((l) => l !== prevEntry && l !== entry && l.trim() !== `- ${link}`);
    const sorted = [entry, ...kept]
      .map((l, i) => ({ l, i }))
      .sort((a, b) => dateOf(b.l).localeCompare(dateOf(a.l)) || a.i - b.i)
      .map((x) => x.l);
    const next = upsertRegion(content, 'journal', sorted.slice(0, PROJECT_ENTRIES).join('\n'));
    return next === content ? null : next;
  });
  return entry;
}

/** Former API: adds today's journal link to the project page. */
function linkJournal(name, cwd) {
  const f = ensureProjectPage(name, cwd);
  updateProjectEntries(f, `${today()} — ${name}`, '', null);
}

module.exports = { ensureProjectPage, writeSession, updateProjectEntries, linkJournal, countSessions, journalTemplate };
