'use strict';
/**
 * rg, grep. Up to 80 lines: only overlong lines are clipped. Beyond: grouped
 * per file — match count, first 5 lines of each file, grand total.
 */
const { clip, plural } = require('../text');

const LIMIT = 80;
const PER_FILE = 5;
const WITH_LINE = /^(.+?):(\d+):(.*)$/;
const CONTEXT_LINE = /^(.+?)-(\d+)-(.*)$/;
const WITH_FILE = /^([^\s:]+\.[\w]+|[^\s:]*\/[^\s:]+):(.*)$/;

/**
 * Split `file:line:text`, `file:text` or bare `text` lines. A context line
 * (`file-12-text`, from -A/-B/-C) is only recognised for a file already seen:
 * `my-file-2-x.ts` must not read as file `my-file`, line 2.
 */
function parseLine(line, known) {
  const a = WITH_LINE.exec(line);
  if (a) return { file: a[1], text: `${a[2]}: ${a[3]}` };
  const b = WITH_FILE.exec(line);
  if (b) return { file: b[1], text: b[2] };
  const c = CONTEXT_LINE.exec(line);
  if (c && known.has(c[1])) return { file: c[1], text: `${c[2]}- ${c[3]}` };
  return { file: null, text: line };
}

function grouped(lines) {
  const files = new Map();
  for (const line of lines) {
    const { file, text } = parseLine(line, files);
    const key = file || '(sans fichier)';
    if (!files.has(key)) files.set(key, []);
    files.get(key).push(text);
  }
  const out = [`[ccx: ${plural(lines.length, 'ligne')} dans ${plural(files.size, 'fichier')} — ${PER_FILE} premières par fichier]`];
  for (const [file, items] of files) {
    out.push(`${file} (${items.length})`, ...items.slice(0, PER_FILE).map((t) => `  ${clip(t.trim(), 200)}`));
    if (items.length > PER_FILE) out.push(`  … +${items.length - PER_FILE}`);
  }
  return out.join('\n');
}

function condense(text) {
  const lines = text.split('\n').filter((l) => l !== '' && l !== '--');
  if (lines.length <= LIMIT) return lines.map((l) => clip(l)).join('\n');
  return grouped(lines);
}

module.exports = {
  name: 'search',
  match: (cmd) => /^\s*(rg|grep)\b/.test(cmd),
  recoverOnSuccess: false,
  process: condense,
};
