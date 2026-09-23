'use strict';
/**
 * docker ps | images | build | pull, docker compose ps | logs | build | pull.
 *
 *  - tables: IDs, COMMAND and CREATED columns dropped (IMAGE ID is kept when
 *    an image is untagged: it is its only handle);
 *  - build: step headers, errors and the final image lines kept, layer logs
 *    and transfer progress dropped; from the first failure marker on, all kept;
 *  - pull: per-layer states counted;
 *  - compose logs: first 20 lines + error blocks + last 40 lines.
 */
const { isCritical, collapseBlank, collapseRepeats, headTail, plural } = require('../text');

function subcommand(words) {
  const args = words[0] === 'docker-compose' ? words.slice(1) : words.slice(words[1] === 'compose' ? 2 : 1);
  const i = args.findIndex((w, k) => !w.startsWith('-') && !(k > 0 && args[k - 1].startsWith('-') && !args[k - 1].includes('=')));
  return { compose: words[0] === 'docker-compose' || words[1] === 'compose', sub: args[i] || '' };
}

// ------------------------------------------------------------------ tables
const DROP_COLUMNS = new Set(['CONTAINER ID', 'COMMAND', 'CREATED']);

function columns(header) {
  const cols = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(header)) !== null) cols.push({ name: m[0], start: m.index });
  return cols;
}

function table(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return text;
  const cols = columns(lines[0]);
  if (cols.length < 3) return text;
  const cell = (row, k) => row.slice(cols[k].start, k + 1 < cols.length ? cols[k + 1].start : undefined).trim();
  const untagged = lines.some((l) => /<none>/.test(l));
  const keep = cols.map((c, k) => k)
    .filter((k) => !DROP_COLUMNS.has(cols[k].name) && (cols[k].name !== 'IMAGE ID' || untagged));
  return lines.map((row) => keep.map((k) => cell(row, k)).filter(Boolean).join('  ')).join('\n');
}

// ------------------------------------------------------------------ build / pull
const BUILD_DROP = [
  /^#\d+ (DONE|CACHED)\b/,
  /^#\d+ sha256:[0-9a-f]+ [\d.]+[kMG]?B/,
  /^#\d+ (resolve|extracting|transferring) /,
  /^#\d+ [\d.]+ /, // step log line: `#7 12.34 npm WARN …`
  /^ ---> /,
  /^Removing intermediate container/,
];
const FAILURE_START = /^(------|ERROR:|error:|failed to solve|The command '.*' returned a non-zero code)/;

function build(text) {
  const out = [];
  let failing = false;
  for (const line of text.split('\n')) {
    if (!failing && FAILURE_START.test(line)) failing = true;
    if (failing || isCritical(line) || !BUILD_DROP.some((re) => re.test(line))) out.push(line);
  }
  return collapseBlank(collapseRepeats(out)).join('\n');
}

const LAYER = /^[0-9a-f]{6,64}: (Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/;

function pull(text) {
  const layers = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    const m = LAYER.exec(line);
    if (m) { layers.add(line.split(':')[0]); continue; }
    out.push(line);
  }
  const note = layers.size ? [`[ccx: ${plural(layers.size, 'couche')} — progression masquée]`] : [];
  return [...note, ...collapseBlank(out)].join('\n');
}

// ------------------------------------------------------------------ logs
/** An error line and the indented lines that follow it (stack trace). */
function errorBlocks() {
  let tail = 0;
  return (line) => {
    if (isCritical(line)) { tail = 8; return true; }
    const body = line.replace(/^\S+\s+\|\s?/, '');
    if (tail > 0 && /^\s+(at |\S)/.test(body)) { tail--; return true; }
    tail = 0;
    return false;
  };
}

function logs(text) {
  const lines = collapseRepeats(text.split('\n'));
  return headTail(lines, 20, 40, errorBlocks(), 120).join('\n');
}

function condense(text, ctx) {
  const { compose, sub } = subcommand(ctx.words);
  if (sub === 'ps' || sub === 'images') return table(text);
  if (sub === 'build') return build(text);
  if (sub === 'pull') return compose ? build(pull(text)) : pull(text);
  if (sub === 'logs') return logs(text);
  return text;
}

module.exports = {
  name: 'docker',
  match: (cmd) => /^\s*docker(-compose)?\s/.test(cmd),
  handlesFailure: true,
  process: condense,
};
