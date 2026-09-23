'use strict';
/**
 * Unified diff condensing (`git diff`, `git show`, `git log -p`).
 *
 * Every `+`/`-` line, every `@@` hunk header and every context line is kept:
 * a diff with holes misleads more than a long one. Only pure noise goes —
 * `index` lines, `---`/`+++` headers that repeat the `diff --git` paths — and
 * lockfile hunks, summarised to one line with their counts.
 */
const LOCKFILES = new Set(['package-lock.json', 'bun.lock', 'bun.lockb', 'go.sum', 'Cargo.lock',
  'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'poetry.lock', 'Gemfile.lock']);

const isLock = (file) => LOCKFILES.has(String(file).split('/').pop());

function lockLine(lock) {
  return `[ccx: ${lock.file} — +${lock.plus} −${lock.minus} lignes (fichier de verrouillage résumé)]`;
}

/** Header lines between `diff --git` and the first `@@` that carry no information. */
function redundantHeader(line) {
  return /^index [0-9a-f]+\.\.[0-9a-f]+/.test(line) || /^(---|\+\+\+) [ab]\//.test(line);
}

function condenseDiff(text) {
  const out = [];
  let inHeader = false;
  let lock = null;
  const flushLock = () => { if (lock) out.push(lockLine(lock)); lock = null; };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flushLock();
      inHeader = true;
      const m = / b\/(.+)$/.exec(line);
      if (m && isLock(m[1])) { lock = { file: m[1], plus: 0, minus: 0 }; continue; }
      out.push(line);
      continue;
    }
    if (line.startsWith('@@')) inHeader = false;
    if (lock) {
      if (!inHeader && line.startsWith('+')) lock.plus++;
      else if (!inHeader && line.startsWith('-')) lock.minus++;
      else if (!inHeader && !/^(@@| |\\)/.test(line) && line !== '') {
        // Anything else (next commit of `git log -p`) ends the lockfile section.
        flushLock();
        out.push(line);
      }
      continue;
    }
    if (inHeader && redundantHeader(line)) continue;
    out.push(line);
  }
  flushLock();
  return out.join('\n');
}

module.exports = { condenseDiff, isLock, LOCKFILES };
