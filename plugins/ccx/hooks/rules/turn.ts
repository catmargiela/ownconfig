/**
 * turn-timer, ported from ccx (hooks/lib/turn-timer.js): a macOS notification
 * when an answer that took at least CCX_NOTIFY_AFTER seconds (90) is really
 * over. The text goes to osascript as argv, never interpolated into AppleScript.
 */

export const OSASCRIPT = '/usr/bin/osascript'

const SCRIPT = ['on run argv', 'display notification (item 1 of argv) with title (item 2 of argv)', 'end run']

export function notifyAfter(raw: string | undefined): number {
  const v = Number(raw)
  return v > 0 ? v : 90
}

export function duration(sec: number): string {
  const m = Math.floor(sec / 60)
  return m ? `${m} min ${String(Math.round(sec % 60)).padStart(2, '0')}` : `${Math.round(sec)} s`
}

/** Last path segment of the session's directory, for the title. */
function project(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || 'Claude Code'
}

/** osascript's argv for a turn of `sec` seconds in `cwd`. */
export function notifyArgv(sec: number, cwd: string): string[] {
  return [
    OSASCRIPT,
    ...SCRIPT.flatMap(line => ['-e', line]),
    `Réponse terminée en ${duration(sec)}`,
    `Claude Code · ${project(cwd)}`,
  ]
}
