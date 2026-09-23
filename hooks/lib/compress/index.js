'use strict';
/**
 * PreToolUse / Bash — output compression. Runs LAST in the pre-bash chain.
 *
 * An eligible command (see policy.js) is rewritten to run through wrap.js,
 * which executes it unchanged and prints a condensed version of its output.
 * The rewrite goes out as `updatedInput` only: no permission decision is ever
 * emitted, so the rewritten command still goes through the normal permission
 * flow and the auto-mode classifier. The original command is appended as a
 * quoted shell comment so that whoever reviews the call can read it.
 *
 * Off in the `minimal` profile, with CCX_DISABLED=1 or CCX_COMPRESS=off, for a
 * command prefixed `CCX_RAW=1`, and for background commands (their output is
 * read while they run; the wrapper would hold it back until the end).
 */
const path = require('path');
const { enabled, updateInput } = require('../util');
const { eligible } = require('./policy');

const WRAP = path.join(__dirname, 'wrap.js');

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * Rewritten command, or null when it cannot be represented safely: a shell
 * comment ends at the first physical newline, so a command containing one would
 * leak its tail out of the `# '<original>'` comment as a separate command.
 * Defense in depth: policy.js already refuses control characters.
 */
function rewrite(command) {
  if (/[\r\n\x00]/.test(command)) return null;
  const b64 = Buffer.from(command, 'utf8').toString('base64');
  return `node ${shellQuote(WRAP)} ${b64} # ${shellQuote(command.trim())}`;
}

function active() {
  if (!enabled(['standard', 'strict'])) return false;
  return String(process.env.CCX_COMPRESS || '').trim().toLowerCase() !== 'off';
}

function run(input) {
  if (!active()) return;
  if (input?.tool_name && input.tool_name !== 'Bash') return;
  const ti = input?.tool_input || {};
  const command = ti.command;
  if (typeof command !== 'string' || ti.run_in_background) return;
  if (/^\s*CCX_RAW=1(\s|$)/.test(command)) return;
  if (!eligible(command).ok) return;
  const rewritten = rewrite(command);
  if (!rewritten) return;
  updateInput({ ...ti, command: rewritten });
}

module.exports = { run, rewrite, WRAP };
