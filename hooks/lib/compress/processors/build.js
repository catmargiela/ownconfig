'use strict';
/**
 * Builds: next build, tsc, npm/bun/pnpm/yarn build scripts, go build, cargo
 * build/check. Compile progress is dropped; the route/size table of `next
 * build` and every error block (with its code frame and pointers) are kept;
 * warnings beyond the first five blocks are counted, not shown.
 */
const { isCritical, collapseBlank, collapseRepeats, plural } = require('../text');

const PROGRESS = [
  /^\s*(Compiling|Checking|Downloading|Downloaded|Fresh|Updating|Locking|Adding|Blocking|Packaging|Documenting)\s+\S/,
  /^\s*[✓○●◐▲-]?\s*(Creating an optimized|Collecting page data|Collecting build traces|Finalizing page optimization|Linting and checking validity|Generating static pages|Compiled successfully|Compiling|Skipping (linting|validation)|Checking validity|Using (vars|tsconfig))/,
  /^\s*> \S+@\S+ \S+/, // npm script banner: `> app@1.0.0 build`
  /^\s*> (next|tsc|vite|turbo|tsup) /, // npm script command echo
  /^\s*\$ (next|tsc|vite|turbo|tsup) /, // bun / yarn script command echo
  /^\s*info\s+-\s+(Loaded|Creating|Collecting|Generating|Finalizing|Linting)/,
];

const WARN_HEAD = /^\s*(warning|warn)\b[:[\s]|^\s*⚠|^\S.*\bwarning\b(?!s? generated)[: ]/i;
const SUMMARY = /generated \d+ warnings?|^\s*⚠ Compiled with warnings/i;

function isProgress(line) {
  return PROGRESS.some((re) => re.test(line)) && !isCritical(line);
}

/** Lines that continue the block above: indentation, rustc/tsc code frames, pointers. */
function isContinuation(line) {
  return /^\s+\S/.test(line) || /^\s*(-->|\||\d+\s*\||=|\^|~)/.test(line);
}

/** Warning blocks after the fifth are counted and dropped; everything else stays. */
function trimWarnings(lines) {
  const out = [];
  let blocks = 0;
  let dropping = false;
  for (const line of lines) {
    if (WARN_HEAD.test(line) && !SUMMARY.test(line) && !/\berror\b/i.test(line)) {
      blocks++;
      dropping = blocks > 5;
      if (!dropping) out.push(line);
      continue;
    }
    if (dropping && line.trim() && isContinuation(line) && !isCritical(line)) continue;
    if (!line.trim() && dropping) { dropping = false; continue; }
    dropping = false;
    out.push(line);
  }
  if (blocks > 5) out.push(`[ccx: ${plural(blocks, 'avertissement')}, 5 premiers affichés]`);
  return out;
}

function condense(text) {
  const lines = text.split('\n').filter((l) => !isProgress(l));
  return collapseBlank(collapseRepeats(trimWarnings(lines))).join('\n');
}

module.exports = {
  name: 'build',
  match: (cmd) => /^\s*((npx|bunx)\s+)?(next\s+build|tsc)\b|^\s*(npm|bun|pnpm|yarn)\s+(run\s+)?build\s*$|^\s*go\s+build\b|^\s*cargo\s+(build|check)\b/.test(cmd),
  handlesFailure: true,
  process: condense,
};
