'use strict';
/**
 * UserPromptSubmit — usage-quota alert.
 *
 * Hooks are not given the rate limits; the status line is. It copies them to
 * `state/ccx/limits.json` ({ five_hour, seven_day: { pct, resets_at } }), and
 * this module reads that file on each prompt. When a window crosses a
 * threshold (80 % and 95 % by default, CCX_QUOTA_WARN="80,95"), one message
 * goes to the user and the same note to the model — once per threshold, per
 * window, per session. A window whose reset time has passed is ignored: the
 * file may predate the reset.
 *
 * Off in the `minimal` profile, with CCX_DISABLED=1 or CCX_QUOTA_ALERT=off.
 */
const fs = require('fs');
const path = require('path');
const { enabled, STATE_DIR, readState, writeState, warn } = require('./util');

const LIMITS = path.join(STATE_DIR, 'limits.json');
const WINDOWS = [['five_hour', '5 h'], ['seven_day', '7 j']];

function thresholds() {
  const list = String(process.env.CCX_QUOTA_WARN || '80,95').split(',')
    .map((v) => Number(v.trim())).filter((v) => v > 0 && v <= 100);
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : [80, 95];
}

function readLimits() {
  try { return JSON.parse(fs.readFileSync(LIMITS, 'utf8')) || {}; } catch { return {}; }
}

/** "1 h 40" / "3 j 2 h" until the reset, or '' when unknown. */
function untilReset(resetsAt, nowSec) {
  if (!(resetsAt > nowSec)) return '';
  const m = Math.round((resetsAt - nowSec) / 60);
  if (m >= 1440) return `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`;
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/**
 * Highest newly crossed threshold per window, as { key, label, pct, level, reset }.
 * `seen` maps a window key to { resets_at, level } already announced.
 */
function crossings(limits, seen, nowSec, levels = thresholds()) {
  const out = [];
  for (const [key, label] of WINDOWS) {
    const w = limits[key];
    if (!w || typeof w.pct !== 'number') continue;
    if (typeof w.resets_at === 'number' && w.resets_at <= nowSec) continue;
    const prev = seen[key] && seen[key].resets_at === w.resets_at ? seen[key].level : 0;
    const level = levels.filter((t) => w.pct >= t).pop() || 0;
    if (level > prev) out.push({ key, label, pct: Math.round(w.pct), level, resetsAt: w.resets_at, reset: untilReset(w.resets_at, nowSec) });
  }
  return out;
}

function message(c) {
  const when = c.reset ? `, réinitialisé dans ${c.reset}` : '';
  const advice = c.level >= 95
    ? 'Finir la tâche en cours au plus court ; aucun sous-agent ni workflow sans accord.'
    : 'Préférer les étapes courtes ; limiter les sous-agents et prévenir avant une tâche longue.';
  return `[Quota] Fenêtre ${c.label} à ${c.pct} %${when}. ${advice}`;
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  if (String(process.env.CCX_QUOTA_ALERT || '').trim().toLowerCase() === 'off') return;
  const sid = input && input.session_id;
  const seen = readState(sid, 'quota', {});
  const found = crossings(readLimits(), seen, Date.now() / 1000);
  if (!found.length) return;
  const next = { ...seen };
  for (const c of found) {
    next[c.key] = { resets_at: c.resetsAt, level: c.level };
    warn(message(c));
  }
  writeState(sid, 'quota', next);
}

module.exports = { run, crossings, thresholds, untilReset, LIMITS };
