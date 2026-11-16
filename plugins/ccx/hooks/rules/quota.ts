/**
 * quota-alert, ported from ccx (hooks/lib/quota-alert.js). When a rate-limit
 * window crosses a threshold (80 % and 95 % by default, CCX_QUOTA_WARN), one
 * line goes to the user and the same note to the model: once per threshold,
 * per window, per reset. A window whose reset time has passed is ignored.
 *
 * Natively the windows come from the last API response (`$.session.usage()
 * .rateLimits`), where ccx read the copy the status line left on disk.
 */
import type { QuotaSeen } from '../../types'

const WINDOWS: Readonly<Record<string, string>> = { five_hour: '5 h', seven_day: '7 j' }

/** Thresholds from `CCX_QUOTA_WARN`, ascending; 80,95 when unset or unusable. */
export function thresholds(raw: string | undefined): number[] {
  const list = String(raw || '80,95')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => v > 0 && v <= 100)
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : [80, 95]
}

/** "1 h 40" / "3 j 2 h" / "12 min" until the reset, or '' when unknown or past. */
export function untilReset(resetsAtSec: number | null, nowSec: number): string {
  if (resetsAtSec === null || !(resetsAtSec > nowSec)) return ''
  const m = Math.round((resetsAtSec - nowSec) / 60)
  if (m >= 1440) return `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
}

export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type Crossing = { kind: string; label: string; pct: number; level: number; resetsAt: string | null; reset: string }

/** Highest newly crossed threshold per known window. */
export function crossings(windows: readonly Window[], seen: QuotaSeen, nowSec: number, levels: readonly number[]): Crossing[] {
  const out: Crossing[] = []
  for (const w of windows) {
    const label = Object.hasOwn(WINDOWS, w.kind) ? WINDOWS[w.kind] : undefined
    if (label === undefined || typeof w.percentUsed !== 'number') continue
    const resetsAt = w.resetsAt ?? null
    const resetsAtSec = resetsAt === null ? null : Date.parse(resetsAt) / 1000
    if (resetsAtSec !== null && !(resetsAtSec > nowSec)) continue
    const prev = seen[w.kind]
    const prevLevel = prev && prev.resetsAt === resetsAt ? prev.level : 0
    const level = levels.filter(t => w.percentUsed >= t).pop() ?? 0
    if (level > prevLevel) {
      out.push({ kind: w.kind, label, pct: Math.round(w.percentUsed), level, resetsAt, reset: untilReset(resetsAtSec, nowSec) })
    }
  }
  return out
}

export function quotaMsg(c: Crossing): string {
  const when = c.reset ? `, réinitialisé dans ${c.reset}` : ''
  const advice =
    c.level >= 95
      ? 'Finir la tâche en cours au plus court ; aucun sous-agent ni workflow sans accord.'
      : 'Préférer les étapes courtes ; limiter les sous-agents et prévenir avant une tâche longue.'
  return `[Quota] Fenêtre ${c.label} à ${c.pct} %${when}. ${advice}`
}
