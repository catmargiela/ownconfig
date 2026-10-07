'use strict';
/**
 * Modules the ccx plugin (plugins/ccx) already ran in-process for THIS tool
 * call, which dispatch.js then skips so each gate runs once.
 *
 * The plugin acknowledges a call by writing `native/<tool_use_id>.json` after
 * evaluating it without error, just before the settings hooks run. The file is
 * read once and deleted. No acknowledgement — plugin absent, failing, a tool it
 * does not handle — means every module runs here: the worst case is a gate run
 * twice, never a gate run nowhere. A tool_use_id is random and assigned once
 * the call is made, so a Bash call cannot forge one for a later call. Only ids
 * listed in PORTED can be skipped, whatever the file says.
 */
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./util');

/** dispatch.js module ids the plugin implements (plugins/ccx/hooks/marker.ts). */
const PORTED = new Set([
  './lib/secret-guard',
  './lib/pre-bash',
  './lib/dev-server-guard',
  './lib/pre-edit',
  './lib/bash-hygiene',
  './lib/loop-guard',
]);

/** Where the plugin acknowledges `toolUseId` (marker.ts ackPath()). */
function ackPath(toolUseId) {
  const safe = String(toolUseId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return safe ? path.join(STATE_DIR, 'native', `${safe}.json`) : null;
}

/** Ids to skip for this call; consumes the acknowledgement. Empty without one. */
function nativeModules(toolUseId) {
  const file = ackPath(toolUseId);
  if (!file) return new Set();
  let ack = null;
  try {
    ack = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return new Set();
  } finally {
    try { fs.unlinkSync(file); } catch { /* absent */ }
  }
  const claimed = ack && Array.isArray(ack.skip) ? ack.skip : [];
  return new Set(claimed.filter((id) => PORTED.has(id)));
}

module.exports = { nativeModules, ackPath, PORTED };
