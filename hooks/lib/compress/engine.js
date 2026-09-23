'use strict';
/**
 * Compression engine: one stream of one command in, compressed text out.
 *
 *  1. ANSI codes and carriage-return redraws are always removed.
 *  2. The processor named by the policy runs; on a failed command it runs only
 *     if it declares `handlesFailure`, otherwise the generic one does.
 *  3. Critical-line recovery: an error line present in the input but absent
 *     from the result is put back (at most 30), under a visible marker. It runs
 *     on every failure, and on success unless the processor opts out
 *     (`recoverOnSuccess: false` — listings, search results and git output,
 *     where a file `not-found.tsx` or a commit `fix error handling` is not an
 *     error). A processor may return
 *     `{ text, accounted }`: lines it deliberately counted in a visible summary
 *     (lint occurrences past the third of a rule, under `… +N`) are not missing.
 *  4. A result that is not shorter than the input is discarded.
 */
const { stripAnsi, resolveCR, isCritical, clip } = require('./text');
const { parse } = require('./policy');
const processors = require('./processors');

const MAX_RECOVERED = 30;
const MAX_SEARCHES = 500;

function pick(name, cmd) {
  return processors.byName[name] || processors.list.find((p) => p.match(cmd)) || processors.byName.generic;
}

/** Critical input lines missing from `output`, re-added under a marker. */
function recover(input, output, accounted = []) {
  const present = new Set(output.split('\n').map((l) => l.trim()));
  for (const line of accounted) present.add(String(line).trim());
  const missing = [];
  let searches = 0;
  for (const line of input.split('\n')) {
    const t = line.trim();
    if (!t || present.has(t) || !isCritical(t)) continue;
    // Reformatted lines (`hash subject`, `file: 12:5 …`) still count as present.
    if (searches++ < MAX_SEARCHES && output.includes(t)) continue;
    present.add(t);
    missing.push(clip(line, 1000));
    if (missing.length >= MAX_RECOVERED) break;
  }
  if (!missing.length) return output;
  const n = missing.length;
  const marker = `[ccx: ${n} ligne${n > 1 ? 's' : ''} d'erreur récupérée${n > 1 ? 's' : ''}]`;
  return `${output.replace(/\n+$/, '')}\n${marker}\n${missing.join('\n')}`;
}

/**
 * @returns {{text: string, processor: string, changed: boolean}}
 */
function compress(cmd, text, opts = {}) {
  const raw = String(text || '');
  const exitCode = opts.exitCode || 0;
  let proc = pick(opts.processor, cmd);
  if (!raw.trim()) return { text: raw, processor: proc.name, changed: false };
  if (exitCode !== 0 && !proc.handlesFailure) proc = processors.byName.generic;

  const clean = resolveCR(stripAnsi(raw));
  const ctx = { exitCode, stream: opts.stream || 'stdout', cmd, words: parse(cmd) || [] };
  const result = proc.process(clean, ctx);
  let out = String(typeof result === 'string' ? result : result.text);
  const accounted = (result && result.accounted) || [];
  if (exitCode !== 0 || proc.recoverOnSuccess !== false) out = recover(clean, out, accounted);
  out = out.replace(/\n+$/, '');
  if (raw.endsWith('\n')) out += '\n';
  if (out.length >= raw.length) return { text: raw, processor: proc.name, changed: false };
  return { text: out, processor: proc.name, changed: true };
}

module.exports = { compress, recover, pick };
