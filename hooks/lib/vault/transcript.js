'use strict';
/**
 * Bounded, incremental transcript reading.
 *
 * Stop runs at the end of every answer and some transcripts exceed 100 MB: only
 * the bytes appended since the previous pass are read. A first pass on a huge
 * file reads the head (the initial intent) and the tail (the current state),
 * never the middle.
 */
const fs = require('fs');

const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 8 * 1024 * 1024;
// A huge line carrying a base64 blob (screenshot) holds no usable signal and is
// dropped unparsed. A huge line without a blob (long answer) is kept.
const FAT_LINE_BYTES = 120 * 1024;
const BLOB_HINT = /"(base64|image)"/;
// Entry types that never carry a signal: skipped before JSON.parse.
const SKIP_TYPE = /"type":"(?:progress|file-history-snapshot|queue-operation)"/;

function readRange(fd, start, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, start);
  return n < length ? buf.subarray(0, n) : buf;
}

function parseLines(text) {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l || l.length < 2) continue;
    if (l.length > FAT_LINE_BYTES && BLOB_HINT.test(l.slice(0, 4096))) continue;
    if (SKIP_TYPE.test(l.slice(0, 600))) continue;
    try { out.push(JSON.parse(l)); } catch { /* line cut by the window */ }
  }
  return out;
}

/** Byte windows to read for a pass starting at `offset` on a file of `size`. */
function windows(offset, size) {
  const delta = size - offset;
  if (delta <= TAIL_BYTES) return [[offset, delta]];
  const tail = [size - TAIL_BYTES, TAIL_BYTES];
  return offset === 0 ? [[0, HEAD_BYTES], tail] : [tail];
}

/**
 * Entries appended since `offset`. Only complete lines are consumed: the new
 * offset stops after the last newline, so a line being written is read next time.
 * Returns { entries, offset, reset } — `reset` when the file shrank (replaced).
 */
function readSince(file, offset = 0) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    const reset = size < offset;
    const from = reset ? 0 : offset;
    if (size === from) return { entries: [], offset: from, reset };
    fd = fs.openSync(file, 'r');
    const parts = windows(from, size).map(([s, len]) => readRange(fd, s, len));
    const last = parts[parts.length - 1];
    const nl = last.lastIndexOf(10);
    if (nl < 0) return { entries: [], offset: from, reset };
    parts[parts.length - 1] = last.subarray(0, nl + 1);
    const text = parts.map((b) => b.toString('utf8')).join('\n');
    return { entries: parseLines(text), offset: size - (last.length - nl - 1), reset };
  } catch { return { entries: [], offset, reset: false }; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

/** Whole-file bounded read (head + tail), kept for callers of the former API. */
function readBounded(file) {
  return readSince(file, 0).entries;
}

module.exports = { readSince, readBounded, parseLines, HEAD_BYTES, TAIL_BYTES };
