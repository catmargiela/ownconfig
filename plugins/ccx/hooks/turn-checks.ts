/**
 * The end-of-turn and prompt modules as pure decisions, in dispatch.js order:
 * on Stop, context-monitor (may send the agent back once), then
 * delivery-check (a warning) and the turn-timer notification, both only when
 * nothing sent the agent back; on UserPromptSubmit, quota-alert and the start
 * of the turn's timer. The caller reads the API and the session memory.
 */
import type { QuotaSeen } from '../types'
import { STANDARD_UP, isOn } from './config'
import type { TurnFlags } from './config'
import { contextAdvice, contextReason } from './rules/context'
import { deliveryMsg, findPhrases } from './rules/delivery'
import { crossings, quotaMsg, thresholds } from './rules/quota'
import type { Window } from './rules/quota'
import { notifyAfter } from './rules/turn'

export type ContextOutcome = { block: string; warned: string[] } | null

/**
 * context-monitor. Not gated by profile nor CCX_DISABLED, as in ccx: only
 * CC_CONTEXT_MONITOR=off turns it off. No reading (after /clear or /compact,
 * before the next response): nothing to say.
 */
export function contextCheck(tokens: number | undefined, window: number, flags: TurnFlags, warned: readonly string[]): ContextOutcome {
  if (flags.isContextMonitorOff || tokens === undefined) return null
  const size = flags.contextLimit || window
  const reason = contextReason(tokens, size, flags.warnAt, flags.soft, warned)
  return reason ? { block: contextAdvice(tokens, size, flags.soft, reason), warned: [...warned, reason] } : null
}

export type DeliveryOutcome = { warning: string; seen: string[] } | null

export function deliveryCheck(text: string | undefined, flags: TurnFlags, seen: readonly string[]): DeliveryOutcome {
  if (!isOn(flags, STANDARD_UP) || flags.isDeliveryOff || !text) return null
  const found = findPhrases(text, seen)
  return found.length ? { warning: deliveryMsg(found), seen: [...seen, ...found.map(p => p.key)] } : null
}

/** Whether turn-timer runs at all (macOS is the caller's check: osascript present). */
export function isTimerOn(flags: TurnFlags): boolean {
  return isOn(flags, STANDARD_UP) && !flags.isNotifyOff
}

/** Seconds the turn took when it deserves a notification, else null. */
export function notifySeconds(start: number | null, now: number, flags: TurnFlags): number | null {
  if (start === null || !isTimerOn(flags)) return null
  const sec = (now - start) / 1000
  return sec >= notifyAfter(flags.notifyAfter) ? sec : null
}

export type QuotaOutcome = { warnings: string[]; seen: QuotaSeen } | null

export function quotaCheck(windows: readonly Window[], seen: QuotaSeen, nowSec: number, flags: TurnFlags): QuotaOutcome {
  if (!isOn(flags, STANDARD_UP) || flags.isQuotaOff) return null
  const found = crossings(windows, seen, nowSec, thresholds(flags.quotaWarn))
  if (!found.length) return null
  const next: QuotaSeen = { ...seen }
  for (const c of found) next[c.kind] = { resetsAt: c.resetsAt, level: c.level }
  return { warnings: found.map(quotaMsg), seen: next }
}
