'use strict';
/**
 * Summary of a project page too long to be injected whole: what it contains
 * and where to read it, within the same budget. Nothing is rephrased — only
 * titles, sizes and first lines of the page itself.
 */
const { trimAtWord } = require('./filters');

const INTRO_SHARE = 0.2;
const MIN_EXCERPT = 60;
const SUBS_MAX = 160;

/** Opening line. Under a tiny budget it shrinks to what matters most: where the page is. */
function note(file, budget) {
  const full = `Page trop longue pour être injectée en entier : ceci en est le sommaire. Texte complet : ${file} — ` +
    'lire la section concernée avant de travailler dessus.';
  return full.length + MIN_EXCERPT <= budget ? full : `Sommaire. Texte complet : ${file}`;
}

const FENCE = /^\s*```/;

/** Introduction (text before the first `## `) and `##` sections, `###` kept inside. */
function splitSections(clean) {
  const parts = String(clean || '').split(/^(## .*)$/m);
  const intro = parts.shift().trim();
  const sections = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = (parts[i + 1] || '').trim();
    // A `###` line inside a code block is code, not a sub-heading.
    const prose = body.replace(/^\s*```[\s\S]*?^\s*```/gm, '');
    const subs = [...prose.matchAll(/^###+ (.+)$/gm)].map((m) => m[1].trim());
    sections.push({ title: parts[i].slice(3).trim(), body, subs });
  }
  return { intro, sections };
}

/** Whole lines of `text` fitting in `max`; a first line too long is cut at a word. */
function excerpt(text, max) {
  if (text.length <= max) return text;
  const kept = [];
  let used = 0;
  for (const line of text.split('\n')) {
    if (used + line.length + 1 > max - 6) break; // room for a closing fence and `…`
    kept.push(line);
    used += line.length + 1;
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (!kept.length) return trimAtWord(text.split('\n')[0], Math.max(1, max - 1));
  // A code block cut in its middle is closed, or it would swallow what follows.
  const open = kept.filter((l) => FENCE.test(l)).length % 2 === 1;
  return `${kept.join('\n')}\n${open ? '```\n' : ''}…`;
}

const heading = (s) => `## ${s.title} (${s.body.length} car.)`;
const subsLine = (s) => (s.subs.length ? trimAtWord(`Sous-sections : ${s.subs.join(' · ')}`, SUBS_MAX) : '');

/**
 * Characters each section may show. Small sections are served first and whole;
 * the others share what remains equally. Below MIN_EXCERPT a section shows
 * nothing but its title.
 */
function allot(sections, pool) {
  const order = sections.map((s, i) => ({ i, need: s.body.length })).sort((a, b) => a.need - b.need);
  const given = new Array(sections.length).fill(0);
  let left = Math.max(0, pool);
  order.forEach((s, rank) => {
    const share = Math.floor(left / (order.length - rank));
    given[s.i] = s.need <= share ? s.need : share < MIN_EXCERPT ? 0 : share;
    left -= given[s.i];
  });
  return given;
}

/** Titles only, as many as fit: the page has more sections than the budget has lines. */
function titlesOnly(head, sections, budget) {
  const lines = [];
  let used = head.length;
  for (const s of sections) {
    const line = heading(s);
    if (used + line.length + 1 > budget - 30) break;
    lines.push(line);
    used += line.length + 1;
  }
  const more = sections.length - lines.length;
  return [head, ...lines, more ? `… +${more} section(s)` : ''].filter(Boolean).join('\n').slice(0, budget);
}

function renderSection(s, room) {
  if (room >= s.body.length) return `## ${s.title}\n${s.body}`;
  const subs = subsLine(s);
  const body = room > 0 ? excerpt(s.body, room) : '';
  return [heading(s), body, subs].filter(Boolean).join('\n');
}

/**
 * `clean` (output of cleanForInjection) when it fits in `budget`, its summary
 * otherwise. The result is never longer than `budget`.
 */
function summarize(clean, budget, file) {
  if (clean.length <= budget) return clean;
  const { intro, sections } = splitSections(clean);
  const lead = note(file, budget);
  const introPart = intro ? excerpt(intro, Math.max(MIN_EXCERPT, Math.floor(budget * INTRO_SHARE))) : '';
  const head = [lead, introPart].filter(Boolean).join('\n\n');
  if (!sections.length) return [lead, excerpt(intro, Math.max(0, budget - lead.length - 2))].join('\n\n').slice(0, budget);

  // Fixed cost of a section: its title line, its sub-headings line, separators.
  const fixed = sections.reduce((n, s) => n + heading(s).length + subsLine(s).length + 4, 0);
  const pool = budget - head.length - 2 - fixed;
  if (pool < 0) return titlesOnly(head, sections, budget);

  const rooms = allot(sections, pool);
  const body = sections.map((s, i) => renderSection(s, rooms[i])).join('\n\n');
  return `${head}\n\n${body}`.slice(0, budget);
}

module.exports = { summarize, splitSections, excerpt };
