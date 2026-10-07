'use strict';
/**
 * Modules the ccx plugin (plugins/ccx) already ran in-process for THIS event,
 * which dispatch.js then skips so each module runs once.
 *
 * The plugin acknowledges an event by writing `native/<key>.json` after
 * evaluating it without error, just before the settings hooks run. The file is
 * read once and deleted. No acknowledgement — plugin absent, failing, a tool it
 * does not handle — means every module runs here: the worst case is a module
 * run twice, never one run nowhere. The key of a tool call is its tool_use_id,
 * random and assigned once the call is made, so a Bash call cannot forge one
 * for a later call: the security gates (PreToolUse) cannot be switched off.
 * Stop and UserPromptSubmit are keyed by the turn's prompt_id, known for the
 * whole turn: a forged one can only silence their warnings (context, delivery,
 * quota, notification), and only while the plugin is not running, since the
 * plugin rewrites the file and runs them itself. Only specs listed in PORTED
 * can be skipped, whatever the file says.
 */
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./util');

/** dispatch.js module specs the plugin implements (plugins/ccx/hooks/marker.ts NATIVE). */
const PORTED = new Set([
  './lib/secret-guard',
  './lib/pre-bash',
  './lib/dev-server-guard',
  './lib/pre-edit',
  './lib/bash-hygiene',
  './lib/loop-guard',
  './lib/context-monitor',
  './lib/delivery-check',
  './lib/turn-timer#onStop',
  './lib/quota-alert',
  './lib/turn-timer#onPrompt',
]);

/**
 * The acknowledgement key of a dispatch.js event: the tool_use_id of a tool
 * call; `stop-` / `prompt-` and the turn's prompt_id for Stop and
 * UserPromptSubmit, which carry no tool_use_id. Null when the payload has none.
 */
function ackKey(event, input) {
  const i = input || {};
  if (event === 'pre-edit' || event === 'pre-bash') return i.tool_use_id || null;
  if (event === 'stop') return i.prompt_id ? `stop-${i.prompt_id}` : null;
  if (event === 'prompt') return i.prompt_id ? `prompt-${i.prompt_id}` : null;
  return null;
}

/** Where the plugin acknowledges `key` (marker.ts ackPath()). */
function ackPath(key) {
  const safe = String(key || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return safe ? path.join(STATE_DIR, 'native', `${safe}.json`) : null;
}

/** Specs to skip for `key`; consumes the acknowledgement. Empty without one. */
function nativeModules(key) {
  const file = ackPath(key);
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
  return new Set(claimed.filter((spec) => PORTED.has(spec)));
}

module.exports = { nativeModules, ackKey, ackPath, PORTED };
