'use strict';
/**
 * Processor registry. Each processor: `{ name, match(cmd), process(text, ctx) }`,
 * optionally `handlesFailure` and `recoverOnSuccess: false`.
 * `ctx` = `{ exitCode, stream, cmd, words }`. `generic` must stay last.
 */
const list = [
  require('./git'),
  require('./gotest'),
  require('./jstest'),
  require('./build'),
  require('./lint'),
  require('./docker'),
  require('./listing'),
  require('./search'),
  require('./gh'),
  require('./generic'),
];

const byName = Object.fromEntries(list.map((p) => [p.name, p]));

module.exports = { list, byName };
