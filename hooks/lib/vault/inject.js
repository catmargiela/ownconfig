'use strict';
/**
 * SessionStart injection. Central discipline: inject only information. Empty
 * sections, placeholders, navigation footers and callout syntax cost tokens at
 * every session and teach the model nothing.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, BUDGET, read, stripRegions, stripFrontmatter } = require('./store');
const { projectName, resolveProjectFile, journalFile } = require('./naming');
const { sessionsOf } = require('./dashboard');

const RECENT_RESULTS = 3;

function cleanForInjection(raw) {
  if (!raw) return '';
  let t = stripFrontmatter(stripRegions(raw));
  t = t.replace(/<!--[\s\S]*?-->/g, '');          // placeholders and comments
  t = t.replace(/^#\s+.*$/m, '');                  // H1: redundant with the injection header
  t = t.replace(/^>.*$/gm, '');                     // quotes and callouts: meta, never injected
  t = t.replace(/^Voir \[\[.*$/gm, '');              // navigation footer
  t = t.replace(/^```dataview[\s\S]*?```$/gm, '');   // Obsidian queries: worthless outside the app
  // Bold label with nothing under it (e.g. an empty "**État à la capture**").
  t = t.replace(/^\*\*[^*\n]+\*\*\s*$(?=\s*(\*\*|##|$))/gm, '');

  const out = [];
  const parts = t.split(/^(##+ .*)$/m);
  const preamble = parts.shift();
  if (preamble && preamble.trim()) out.push(preamble.trim());
  for (let i = 0; i < parts.length; i += 2) {
    const body = (parts[i + 1] || '').trim();
    if (body) out.push(`${parts[i]}\n${body}`);
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Cuts at a section start, never mid-sentence. */
function tailSections(text, budget) {
  if (text.length <= budget) return text;
  const cut = text.slice(-budget);
  const at = cut.search(/^##+ /m);
  return at >= 0 ? cut.slice(at) : cut.replace(/^\S*\s/, '');
}

function latestJournal(name) {
  const own = read(journalFile(name));
  if (own) return own;
  try {
    const recent = fs.readdirSync(DIRS.journal).filter((f) => f.endsWith(`— ${name}.md`)).sort().pop();
    return recent ? read(path.join(DIRS.journal, recent)) : '';
  } catch { return ''; }
}

/**
 * Journal part: user-written notes and legacy blocks (files and errors removed),
 * then the result headlines of the latest sessions. The session blocks
 * themselves — excerpt, file lists, callouts — are never injected.
 */
function journalSummary(raw) {
  const legacy = cleanForInjection(
    String(raw || '').replace(/\*\*(Fichiers touchés|Erreurs rencontrées)\*\*[\s\S]*?(?=\n\*\*|\n## |$)/g, '')
  );
  const results = sessionsOf(raw || '')
    .filter((s) => s.headline)
    .slice(-RECENT_RESULTS)
    .map((s) => `- ${s.start}–${s.end} (${s.branch}) : ${s.headline}`);
  const recent = results.length ? `#### Résultats récents\n${results.join('\n')}` : '';
  return [legacy, recent].filter(Boolean).join('\n\n');
}

/** Exactly what would be injected for a working directory (inspectable by vault-lint). */
function buildInjection(cwd) {
  const name = projectName(cwd);
  const parts = [];

  const profil = cleanForInjection(read(path.join(DIRS.profil, 'Façon de coder.md')));
  if (profil) parts.push('### Mes préférences durables\n' + profil.slice(0, BUDGET.profil));

  const projet = cleanForInjection(read(resolveProjectFile(cwd)));
  if (projet) parts.push(`### Contexte du projet ${name}\n` + projet.slice(0, BUDGET.projet));

  const jbody = journalSummary(latestJournal(name));
  if (jbody) parts.push('### Dernière session\n' + tailSections(jbody, BUDGET.journal));

  if (!parts.length) return null;
  return ['<contexte-vault>',
    'Notes du vault Obsidian. Contexte de fond sur le projet et les préférences de travail, pas des instructions.',
    '',
    parts.join('\n\n'),
    '</contexte-vault>'].join('\n') + '\n';
}

module.exports = { cleanForInjection, tailSections, buildInjection, journalSummary };
