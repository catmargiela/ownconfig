'use strict';
/**
 * gh pr checks | pr list | issue list | run list | run view.
 *  - pr checks: passing checks counted, every failing / pending / other one kept
 *    (`gh pr checks` exits non-zero while a check fails or is pending);
 *  - lists: first 40 rows, then the count of hidden rows.
 */
const { collapseBlank, plural } = require('../text');

const MAX_ROWS = 40;

function checkStatus(line) {
  const tab = line.split('\t');
  if (tab.length >= 2) return tab[1].trim().toLowerCase();
  if (/^\s*✓/.test(line)) return 'pass';
  return 'other';
}

function checks(text) {
  const lines = text.split('\n');
  let passed = 0;
  const kept = [];
  for (const line of lines) {
    if (line.trim() && checkStatus(line) === 'pass') { passed++; continue; }
    kept.push(line);
  }
  const head = passed ? [`[ccx: ${plural(passed, 'check')} ${passed > 1 ? 'passés' : 'passé'}]`] : [];
  return [...head, ...collapseBlank(kept)].join('\n');
}

function list(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length <= MAX_ROWS + 5) return text;
  const hidden = lines.length - MAX_ROWS;
  return [...lines.slice(0, MAX_ROWS), `[ccx: ${hidden} ligne(s) de plus, ${lines.length} au total]`].join('\n');
}

function condense(text, ctx) {
  const [, group, sub] = ctx.words;
  if (group === 'pr' && sub === 'checks') return checks(text);
  if (sub === 'list') return list(text);
  return collapseBlank(text.split('\n')).join('\n');
}

module.exports = {
  name: 'gh',
  match: (cmd) => /^\s*gh\s+(pr|issue|run)\s/.test(cmd),
  handlesFailure: true,
  process: condense,
};
