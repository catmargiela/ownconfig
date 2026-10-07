/**
 * loop-guard, ported from ccx (hooks/lib/loop-guard.js). The same command run
 * LOOP_AT times in a row usually means the agent is going round in circles.
 * One warning per streak; it never blocks.
 */
import type { LoopState } from '../../types'

export const LOOP_AT = 4

/**
 * Streak key of the whitespace-normalised command: its length and a 32-bit
 * FNV-1a hash of the whole text (ccx hashed it with sha1, not available here).
 */
export function loopKey(command: string): string {
  const text = String(command).trim().replace(/\s+/g, ' ')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length}:${hash.toString(16)}`
}

export type LoopStep = { state: LoopState; isFired: boolean; count: number }

/** Next streak state for `command`, and whether this call raises the warning. */
export function step(prev: LoopState | null, command: string): LoopStep {
  const last = loopKey(command)
  const isSame = prev !== null && prev.last === last
  const count = isSame ? prev.count + 1 : 1
  const wasWarned = isSame ? prev.warned : false
  const isFired = count >= LOOP_AT && !wasWarned
  return { state: { last, count, warned: wasWarned || isFired }, isFired, count }
}

export function loopMsg(count: number): string {
  return `[Boucle] Même commande lancée ${count} fois d'affilée. Changer d'approche (lire l'erreur, modifier le code, attendre une condition) ou le signaler à l'utilisateur plutôt que relancer.`
}
