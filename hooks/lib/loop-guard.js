'use strict';
/**
 * PreToolUse / Bash — loop detection (warning only).
 *
 * The same command run LOOP_AT times in a row (4) usually means the agent is
 * going round in circles: re-running a failing test without changing anything,
 * polling by hand. One warning per streak, to the model and to the user; it
 * never blocks. Off in `minimal`, with CCX_DISABLED=1 or CCX_LOOP_GUARD=off.
 */
const crypto = require('crypto');
const { enabled, readState, writeState, warn } = require('./util');

const LOOP_AT = 4;

function key(command) {
  return crypto.createHash('sha1').update(String(command).trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);
}

/** Next streak state for `command`, and whether this call starts a warning. */
function step(prev, command) {
  const k = key(command);
  const count = prev && prev.last === k ? prev.count + 1 : 1;
  const warned = prev && prev.last === k ? Boolean(prev.warned) : false;
  const fire = count >= LOOP_AT && !warned;
  return { state: { last: k, count, warned: warned || fire }, fire, count };
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  if (String(process.env.CCX_LOOP_GUARD || '').trim().toLowerCase() === 'off') return;
  const command = input && input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || !command.trim()) return;
  const sid = input.session_id;
  const { state, fire, count } = step(readState(sid, 'bash-loop', null), command);
  writeState(sid, 'bash-loop', state);
  if (fire) {
    warn(`[Boucle] Même commande lancée ${count} fois d'affilée. Changer d'approche (lire l'erreur, modifier le code, attendre une condition) ou le signaler à l'utilisateur plutôt que relancer.`);
  }
}

module.exports = { run, step, LOOP_AT };
