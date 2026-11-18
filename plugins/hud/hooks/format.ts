/** Pure helpers: figures to short text. No engine call here. */
import type { Limit, TurnPoint } from '../types'

export const WARN_PERCENT = 80

export type Tone = 'success' | 'warning' | 'error' | 'inactive'

/** Green under 50, yellow under 80, red above; grey when unknown. */
export function tone(percent: number | null): Tone {
  if (percent === null) return 'inactive'
  if (percent < 50) return 'success'
  return percent < WARN_PERCENT ? 'warning' : 'error'
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))
}

export function usd(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`
}

/** `▰▰▰▱▱▱▱▱▱▱` over `cells`. */
export function gauge(percent: number | null, cells: number): string {
  const filled = percent === null ? 0 : Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

const BARS = '▁▂▃▄▅▆▇█'

/** One bar per value, scaled to the largest (or to `max` when given). */
export function spark(values: readonly number[], max?: number): string {
  const top = max ?? Math.max(...values, 0)
  if (top <= 0) return '▁'.repeat(values.length)
  return values
    .map(v => BARS[Math.min(BARS.length - 1, Math.max(0, Math.round((v / top) * (BARS.length - 1))))] ?? '▁')
    .join('')
}

/** `45 s`, `12 min`, `1 h 04`, `3 j 2 h`. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)} j ${h % 24} h`
}

export function until(iso: string | null, now: number): string {
  const at = iso ? Date.parse(iso) : NaN
  return Number.isFinite(at) && at > now ? span(at - now) : ''
}

export function limitName(kind: string): string {
  if (kind === 'five_hour') return '5 h'
  return kind === 'seven_day' ? '7 j' : kind
}

export function pickLimit(limits: readonly Limit[], kind: string): Limit | null {
  return limits.find(l => l.kind === kind) ?? null
}

/** Cost of each turn: the difference between consecutive totals. */
export function turnCosts(turns: readonly TurnPoint[], firstBase: number): number[] {
  return turns.map((t, i) => Math.max(0, t.usd - (turns[i - 1]?.usd ?? firstBase)))
}

/**
 * Turns left before the context reaches WARN_PERCENT, from the mean growth of
 * the last turns; null when it does not grow or is already past.
 */
export function turnsLeft(turns: readonly TurnPoint[], percent: number | null): number | null {
  if (percent === null || percent >= WARN_PERCENT) return null
  const recent = turns.slice(-8)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || recent.length < 3) return null
  const growth = (last.percent - first.percent) / (recent.length - 1)
  return growth > 0.05 ? Math.max(1, Math.round((WARN_PERCENT - percent) / growth)) : null
}

/** Dollars per hour since the session began; null in its first minute. */
export function burn(total: number | null, startedAt: number, now: number): number | null {
  const hours = (now - startedAt) / 3_600_000
  return total !== null && hours > 1 / 60 ? total / hours : null
}

export function clock(iso: string | null): string {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return ''
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(at.getDate())}/${two(at.getMonth() + 1)} ${two(at.getHours())}:${two(at.getMinutes())}`
}
