'use strict';
/**
 * Linters: eslint (stylish), golangci-lint, go vet, cargo clippy.
 * Issues are grouped by rule: count + first 3 occurrences each, then totals.
 * Shown occurrences keep the original line text, so the recovery pass sees
 * them as present; hidden ones are reported as `accounted` (counted under
 * their rule, not lost). `typecheck` issues are compile errors: all shown. A compile error (rustc block without a lint rule) is kept
 * whole. Lines that are not recognised issues are kept as they are.
 */
const { collapseBlank, isCritical, plural } = require('../text');

const ESLINT_ISSUE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(@?[\w/.-]+)\s*$/;
const ESLINT_FILE = /^(\/|\.{1,2}\/|[A-Za-z]:\\|[\w@.-]+\/)\S*\.\w+$/;
const GOLANGCI = /^(\S+?\.\w+):(\d+)(?::(\d+))?: (.+) \(([\w-]+)\)$/;
const GOVET = /^(\S+?\.go):(\d+):(\d+): (.+)$/;
const RUST_HEAD = /^(warning|error)(?:\[(\w+)\])?: (.+)$/;
const RUST_SUMMARY = /generated \d+ warnings?|could not compile|aborting due to|^warning: build failed/;
const CARGO_PROGRESS = /^\s*(Checking|Compiling)\s+\S+ v\d/;
const RUST_RULE = /#\[(?:warn|deny|forbid)\(([\w:]+)\)\]|index\.html#([\w_]+)/;

/** Collector: issues grouped by rule, and every line that is not an issue. */
function collector() {
  const groups = new Map();
  const other = [];
  return {
    groups, other,
    add(rule, text, raw = [text]) {
      if (!groups.has(rule)) groups.set(rule, []);
      groups.get(rule).push({ text, raw });
    },
    count: () => [...groups.values()].reduce((n, g) => n + g.length, 0),
  };
}

function finishRustBlock(block, c) {
  const head = RUST_HEAD.exec(block[0]);
  const loc = (block.find((l) => /^\s*--> /.test(l)) || '').replace(/^\s*--> /, '').trim();
  const ruleLine = block.map((l) => RUST_RULE.exec(l)).find(Boolean);
  const rule = ruleLine ? (ruleLine[1] || `clippy::${ruleLine[2]}`) : null;
  if (!rule && head[1] === 'error') { c.other.push(...block, ''); return; }
  c.add(rule || head[2] || 'rustc', `${loc ? loc + ' ' : ''}${block[0].trim()}`, block);
}

function parseLine(line, state, c) {
  const eslint = ESLINT_ISSUE.exec(line);
  if (eslint && state.file) { c.add(eslint[5], `${state.file}: ${line.trim()}`, [line]); state.fileUsed = true; return; }
  const golangci = GOLANGCI.exec(line);
  if (golangci) { c.add(golangci[5], line.trim()); state.attached = true; return; }
  const vet = GOVET.exec(line);
  if (vet) { c.add((/^(\w+): /.exec(vet[4]) || [0, 'vet'])[1], line.trim()); state.attached = true; return; }
  // Source line and caret printed under an issue: indented, never an error.
  if (state.attached && /^\s+\S/.test(line) && !isCritical(line)) return;
  state.attached = false;
  if (CARGO_PROGRESS.test(line)) return;
  if (ESLINT_FILE.test(line)) {
    if (state.file && !state.fileUsed) c.other.push(state.file);
    state.file = line.trim();
    state.fileUsed = false;
    return;
  }
  c.other.push(line);
}

function parse(text) {
  const c = collector();
  const state = { file: null, fileUsed: false, attached: false, rust: null };
  for (const line of text.split('\n')) {
    if (state.rust) {
      if (line.trim()) { state.rust.push(line); continue; }
      finishRustBlock(state.rust, c);
      state.rust = null;
      continue;
    }
    if (RUST_HEAD.test(line) && !RUST_SUMMARY.test(line)) { state.rust = [line]; state.attached = false; continue; }
    parseLine(line, state, c);
  }
  if (state.rust) finishRustBlock(state.rust, c);
  if (state.file && !state.fileUsed) c.other.push(state.file);
  return c;
}

function condense(text) {
  const c = parse(text);
  const total = c.count();
  if (total < 4) return text;
  const out = [`[ccx: ${plural(total, 'problème')} de lint, ${plural(c.groups.size, 'règle')} — 3 premières occurrences par règle]`];
  const accounted = [];
  const sorted = [...c.groups].sort((a, b) => b[1].length - a[1].length);
  for (const [rule, items] of sorted) {
    const shown = rule === 'typecheck' ? items.length : 3;
    out.push(`${rule} (${items.length})`, ...items.slice(0, shown).map((i) => `  ${i.text}`));
    if (items.length > shown) out.push(`  … +${items.length - shown}`);
    for (const i of items.slice(shown)) accounted.push(...i.raw);
  }
  const rest = collapseBlank(c.other);
  return { text: (rest.length ? [...out, '', ...rest] : out).join('\n'), accounted };
}

module.exports = {
  name: 'lint',
  match: (cmd) => /^\s*((npx|bunx)\s+)?eslint\b|^\s*golangci-lint\s+run\b|^\s*go\s+vet\b|^\s*cargo\s+clippy\b/.test(cmd),
  handlesFailure: true,
  process: condense,
};
