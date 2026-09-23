'use strict';
/**
 * ls, find, tree. Up to 60 entries: untouched. Beyond: entries grouped by
 * directory (or by extension for a flat listing) with counts and the first
 * names of each group; `tree` keeps its first two levels and counts the rest.
 */
const { plural } = require('../text');

const LIMIT = 60;
const LONG = /^[-dlcbpsD][rwxsStT@+.-]{9}\S*\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/;

function ext(name) {
  const base = name.replace(/\/$/, '').split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '(sans extension)';
}

/** Entries of ls (plain, -l, -R) and find outputs, as paths when known. */
function entries(text) {
  const out = [];
  let dir = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || /^total \d+/.test(line)) continue;
    if (/^\S.*:$/.test(line) && !LONG.test(line)) { dir = line.slice(0, -1); continue; }
    const long = LONG.exec(line);
    const name = (long ? long[1].replace(/ -> .*$/, '') : line).trim();
    if (name === '.' || name === '..') continue;
    out.push(dir && dir !== '.' ? `${dir}/${name}` : name);
  }
  return out;
}

function groupBy(list, keyOf) {
  const groups = new Map();
  for (const p of list) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return groups;
}

const dirOf = (depth) => (p) => {
  const parts = p.replace(/^\.\//, '').replace(/\/$/, '').split('/');
  return parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') + '/' : './';
};

function extensionSummary(list) {
  const counts = [...groupBy(list, ext)].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
  return `extensions : ${counts.slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}`;
}

function grouped(list) {
  const nested = list.some((p) => p.replace(/\/$/, '').includes('/'));
  let groups = groupBy(list, nested ? dirOf(99) : ext);
  for (let depth = 3; nested && groups.size > 40 && depth >= 1; depth--) groups = groupBy(list, dirOf(depth));
  const perGroup = groups.size > 20 ? 5 : 10;
  const lines = [`[ccx: ${plural(list.length, 'entrée')}, ${plural(groups.size, 'groupe')} — ${perGroup} premières par groupe]`,
    extensionSummary(list)];
  for (const [key, items] of groups) {
    const names = items.slice(0, perGroup).map((p) => (nested ? p.replace(/^\.\//, '').slice(key === './' ? 0 : key.length) : p));
    const more = items.length > perGroup ? `, … +${items.length - perGroup}` : '';
    lines.push(`${key} (${items.length}) : ${names.join(', ')}${more}`);
  }
  return lines.join('\n');
}

/** tree: depth of a line from its drawing prefix (4 columns per level). */
function treeDepth(line) {
  const m = /^((?:[│|]\s{3}|\s{4})*)(├──|└──|`--|\|--)/.exec(line);
  return m ? m[1].length / 4 + 1 : 0;
}

function tree(text, maxDepth = 2) {
  const out = [];
  let hidden = 0;
  let indent = '';
  const flush = () => { if (hidden) out.push(`${indent}… (${plural(hidden, 'entrée')})`); hidden = 0; };
  for (const line of text.split('\n')) {
    const d = treeDepth(line);
    if (d > maxDepth) { if (!hidden) indent = line.slice(0, maxDepth * 4) + '    '; hidden++; continue; }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

function condense(text) {
  if (/(├──|└──)/.test(text)) {
    if (text.split('\n').length <= LIMIT) return text;
    const two = tree(text, 2);
    return two.split('\n').length > 150 ? tree(text, 1) : two;
  }
  const list = entries(text);
  return list.length <= LIMIT ? text : grouped(list);
}

module.exports = {
  name: 'listing',
  match: (cmd) => /^\s*(ls|find|tree)\b/.test(cmd),
  recoverOnSuccess: false,
  process: condense,
};
