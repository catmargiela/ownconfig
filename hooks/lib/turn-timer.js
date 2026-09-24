'use strict';
/**
 * Desktop notification when a long answer is really over.
 *
 *   onPrompt (UserPromptSubmit)  remembers when the turn started
 *   onStop   (Stop, LAST module) notifies if the turn took ≥ CCX_NOTIFY_AFTER s (90)
 *
 * Placed last in the Stop chain: a gate that sends the agent back to work exits
 * with 2 before this runs, so the notification only fires on a real end.
 * macOS only (osascript), detached, text passed as argv (never interpolated
 * into AppleScript). Off with CCX_NOTIFY=off, in `minimal`, or CCX_DISABLED=1.
 */
const path = require('path');
const { spawn } = require('child_process');
const { enabled, readState, writeState } = require('./util');

const SCRIPT = ['on run argv', 'display notification (item 1 of argv) with title (item 2 of argv)', 'end run'];

function active() {
  if (process.platform !== 'darwin' || !enabled(['standard', 'strict'])) return false;
  return String(process.env.CCX_NOTIFY || '').trim().toLowerCase() !== 'off';
}

function threshold() {
  const v = Number(process.env.CCX_NOTIFY_AFTER);
  return v > 0 ? v : 90;
}

function duration(sec) {
  const m = Math.floor(sec / 60);
  return m ? `${m} min ${String(Math.round(sec % 60)).padStart(2, '0')}` : `${Math.round(sec)} s`;
}

function notify(message, title) {
  try {
    const child = spawn('/usr/bin/osascript', [...SCRIPT.flatMap((l) => ['-e', l]), message, title],
      { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* a notification never matters more than the answer */ }
}

function onPrompt(input) {
  if (!active()) return;
  writeState(input && input.session_id, 'turn', { start: Date.now() });
}

function onStop(input) {
  if (!active()) return;
  const sid = input && input.session_id;
  const turn = readState(sid, 'turn', null);
  if (!turn || typeof turn.start !== 'number') return;
  writeState(sid, 'turn', {});
  const sec = (Date.now() - turn.start) / 1000;
  if (sec < threshold()) return;
  const project = path.basename(String((input && input.cwd) || '')) || 'Claude Code';
  notify(`Réponse terminée en ${duration(sec)}`, `Claude Code · ${project}`);
}

module.exports = { onPrompt, onStop, duration, threshold };
