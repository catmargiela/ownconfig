'use strict';
/** Text helpers shared by the compression processors. Pure functions only. */

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

function stripAnsi(s) {
  return String(s).replace(ANSI, '');
}

/** Carriage-return redraws: keep what a terminal would finally show on each line. */
function resolveCR(s) {
  if (!s.includes('\r')) return s;
  return s.split('\n').map((line) => {
    if (!line.includes('\r')) return line;
    const parts = line.split('\r').filter((p) => p !== '');
    return parts.length ? parts[parts.length - 1] : '';
  }).join('\n');
}

/**
 * Lines that must never disappear: errors, failures, panics, pointers
 * `file:line:col:`. Deliberately broad — a false positive only costs a line.
 */
const CRITICAL_I = /error|failed|failure|panic|fatal|traceback|exception|undefined:|cannot|refused|denied|not found/i;
const CRITICAL_CS = /\bFAIL\b|--- FAIL|✗|×|\bE[A-Z]{3,}\b|:\d+:\d+:/;

function isCritical(line) {
  return CRITICAL_I.test(line) || CRITICAL_CS.test(line);
}

/** Identical consecutive lines → one line suffixed `(xN)`. */
function collapseRepeats(lines) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const n = j - i;
    out.push(n > 1 && lines[i].trim() ? `${lines[i]} (x${n})` : lines[i]);
    i = j;
  }
  return out;
}

/** Runs of blank lines → one; leading and trailing blanks removed. */
function collapseBlank(lines) {
  const out = [];
  for (const line of lines) {
    const blank = !line.trim();
    if (blank && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(blank ? '' : line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/**
 * Keep the first `head` and last `tail` lines; from the hidden middle, keep the
 * lines selected by `keep` (at most `maxKept`), announced by a marker.
 */
function headTail(lines, head, tail, keep = isCritical, maxKept = 30) {
  if (lines.length <= head + tail + 5) return lines;
  const middle = lines.slice(head, lines.length - tail);
  const kept = [];
  for (const line of middle) {
    if (kept.length >= maxKept) break;
    if (keep(line)) kept.push(line);
  }
  const hidden = middle.length - kept.length;
  const marker = `... (${hidden} lignes masquées) ...`;
  return [...lines.slice(0, head), marker, ...kept, ...(kept.length ? ['...'] : []),
    ...lines.slice(lines.length - tail)];
}

/** Very long lines (minified files, data dumps) cut with a visible marker. */
function clip(line, max = 300) {
  return line.length > max ? `${line.slice(0, max)}…(+${line.length - max} car.)` : line;
}

function plural(n, word, pl = `${word}s`) {
  return `${n} ${n > 1 ? pl : word}`;
}

module.exports = {
  stripAnsi, resolveCR, isCritical, collapseRepeats, collapseBlank, headTail, clip, plural,
};
