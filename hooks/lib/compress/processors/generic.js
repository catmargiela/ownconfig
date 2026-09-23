'use strict';
/**
 * Fallback for any output, and for every failed command whose processor does
 * not declare `handlesFailure`: progress bars and spinners dropped, identical
 * consecutive lines collapsed, blank runs collapsed, long outputs cut to
 * head + tail while keeping every critical line of the middle.
 */
const { isCritical, collapseRepeats, collapseBlank, headTail } = require('../text');

const PROGRESS = [
  /^\s*[⠁-⣿◐◓◑◒]\s/,
  /\d{1,3}(\.\d+)?\s*%\s*[|[]?[=#>█▉▊▋▌▍▎▏░▒▓ -]{4,}/,
  /[=#>█░▒▓]{6,}.*\d{1,3}(\.\d+)?\s*%/,
  /^\s*\d{1,3}(\.\d+)?\s*%\s*$/,
];

function isProgress(line) {
  return PROGRESS.some((re) => re.test(line)) && !isCritical(line);
}

function compact(lines, head = 80, tail = 60) {
  const kept = collapseBlank(collapseRepeats(lines.filter((l) => !isProgress(l))));
  return kept.length > 200 ? headTail(kept, head, tail) : kept;
}

module.exports = {
  name: 'generic',
  match: () => true,
  handlesFailure: true,
  process: (text) => compact(text.split('\n')).join('\n'),
  compact,
  isProgress,
};
