'use strict';
/**
 * Compression statistics: one JSONL line per wrapped command in
 * `~/.claude/state/ccx/compress-stats.jsonl`. Sizes and labels only — never a
 * byte of output, never an argument beyond the subcommand. Trimmed to its most
 * recent half past 1 MB. Every failure is silent.
 */
const fs = require('fs');
const path = require('path');
const { STATE_DIR, ensureDir } = require('../util');

const FILE = path.join(STATE_DIR, 'compress-stats.jsonl');
const MAX_BYTES = 1024 * 1024;

/** `git log`, `go test`, `ls` — the second word only when it is a plain subcommand. */
function label(words) {
  const [first = '?', second] = words || [];
  return second && /^[a-z][a-z0-9-]*$/.test(second) ? `${first} ${second}` : first;
}

function trim(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
  fs.renameSync(tmp, file);
}

function record(entry) {
  try {
    ensureDir(STATE_DIR);
    fs.appendFileSync(FILE, JSON.stringify(entry) + '\n');
    if (fs.statSync(FILE).size > MAX_BYTES) trim(FILE);
  } catch { /* statistics never matter more than the command */ }
}

module.exports = { record, label, FILE };
