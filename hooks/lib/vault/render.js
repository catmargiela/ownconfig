'use strict';
/**
 * Markdown rendering of a session capture, with native Obsidian callouts only
 * (no community plugin): `> [!summary]`, foldable `> [!question]-`, etc.
 */
const { hhmm } = require('./naming');
const F = require('./filters');

const MAX = { asks: 12, files: 25, errors: 5, commits: 15, prs: 10 };

/**
 * Captured text must never open or close a managed region, nor create links:
 * a stray `<!-- claude:x:end -->` in an excerpt would corrupt the page.
 */
const safe = (s) => String(s || '').replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;').replace(/\[\[/g, '\\[\\[');
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';

function callout(type, title, lines, folded = true) {
  const head = `> [!${type}]${folded ? '-' : ''} ${title}`;
  return [head, ...lines.map((l) => (l ? `> ${l}` : '>'))].join('\n');
}

function commitLines(acc, repo) {
  const commits = acc.commits.slice(-MAX.commits).map((c) => {
    const short = c.hash.slice(0, 7);
    const ref = repo ? `[${short}](https://github.com/${repo}/commit/${c.hash})` : code(short);
    return `- ${ref} ${safe(c.msg)}`;
  });
  const prs = acc.prs.slice(-MAX.prs).map((url) => `- [PR #${url.split('/').pop()}](${url})`);
  return [...commits, ...prs];
}

function fileCallout(acc) {
  const n = acc.files.length;
  const out = acc.outside.length;
  if (!n && !out) return null;
  const shown = acc.files.slice(0, MAX.files).map((f) => `- ${code(safe(f))}`);
  if (n > MAX.files) shown.push(`- … +${n - MAX.files} autres`);
  const title = `Fichiers touchés (${n})${out ? ` (+${out} hors projet)` : ''}`;
  return callout('todo', title, shown);
}

function errorCallout(acc) {
  const errors = acc.errors.slice(-MAX.errors);
  const r = acc.refusals;
  if (!errors.length && !r) return null;
  const refus = r ? `${r} refus de garde-fous` : '';
  const title = errors.length ? `Erreurs (${errors.length})${refus ? ` · ${refus}` : ''}` : refus;
  return callout('warning', title, errors.map((e) => `- ${code(safe(e))}`));
}

function heading(acc, fallbackBranch) {
  const branch = acc.branches[acc.branches.length - 1] || fallbackBranch || 'sans branche';
  return `## ${hhmm(acc.startTs)}–${hhmm(acc.endTs)} — ${safe(branch).replace(/\n/g, ' ')}`;
}

/**
 * Session block body (region markers excluded). Empty callouts are omitted.
 * `ctx`: { repo: 'owner/name' | null, branch: fallback branch }.
 */
function renderSession(acc, ctx = {}) {
  const result = F.headline(acc.lastText);
  const asks = acc.asks.slice(-MAX.asks);
  const links = commitLines(acc, ctx.repo);
  const excerpt = F.excerpt(acc.lastText, 15);
  const parts = [
    result && callout('summary', 'Résultat', [safe(result)], false),
    asks.length && callout('question', `Demandé (${asks.length})`, asks.map((a) => `- ${safe(a)}`)),
    links.length && callout('info', 'Commits et PR', links),
    fileCallout(acc),
    errorCallout(acc),
    excerpt && callout('quote', 'Dernier état', safe(excerpt).split('\n')),
  ].filter(Boolean);
  return [heading(acc, ctx.branch), '', parts.join('\n\n')].join('\n').trimEnd();
}

/** Headline shown by the project page and the dashboard. */
const sessionHeadline = (acc) => F.headline(acc.lastText);

// ---------------------------------------------------------------- frontmatter

const yamlItem = (s) => (/^[\w./-]+$/.test(s) ? s : JSON.stringify(s));
const yamlList = (items) => `[${items.map(yamlItem).join(', ')}]`;
const tagOf = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^-+|-+$/g, '') || 'projet';

function parseInlineList(value) {
  const m = String(value || '').trim().match(/^\[(.*)\]$/);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Sets `key` in frontmatter lines; a block-style value under it is replaced too. */
function setKey(lines, key, value) {
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return [...lines, `${key}: ${value}`];
  let j = i + 1;
  while (j < lines.length && /^\s+-\s|^\s*-\s/.test(lines[j])) j++;
  return [...lines.slice(0, i), `${key}: ${value}`, ...lines.slice(j)];
}

function getKey(lines, key) {
  const l = lines.find((x) => x.startsWith(`${key}:`));
  return l ? l.slice(key.length + 1).trim() : null;
}

/**
 * Updates the journal frontmatter: `sessions`, `branches` (union), `tags`
 * (claude, session, <project> added to an inline list). Other keys are kept.
 */
function updateFrontmatter(content, { sessions, branches, projet }) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return content;
  let lines = m[1].split('\n');
  const tags = parseInlineList(getKey(lines, 'tags'));
  if (tags || getKey(lines, 'tags') === null) {
    const wanted = ['claude', 'session', tagOf(projet)];
    lines = setKey(lines, 'tags', yamlList([...new Set([...(tags || []), ...wanted])]));
  }
  const known = parseInlineList(getKey(lines, 'branches')) || [];
  lines = setKey(lines, 'sessions', String(sessions));
  const all = [...new Set([...known, ...branches.filter(Boolean)])];
  if (all.length) lines = setKey(lines, 'branches', yamlList(all));
  return `---\n${lines.join('\n')}\n---\n` + content.slice(m[0].length);
}

module.exports = { renderSession, sessionHeadline, updateFrontmatter, callout, safe, tagOf, yamlList, MAX };
