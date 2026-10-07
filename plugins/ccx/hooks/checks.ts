/**
 * The phase-1 gates as pure decisions, in two passes around the settings hooks
 * (dispatch.js), so its order holds with the modules not yet ported:
 *
 *  - `before`: the denies dispatch.js ran ahead of commit-gate and
 *    migration-guard (secret, hook bypass, destructive, dev server, guardrail
 *    config). The first wins.
 *  - `after`, once nothing beneath denied: strict fact-forcing, bash-hygiene
 *    and loop-guard, which consume a once-per-session pass or a counter and
 *    must not spend it on a call another gate refuses.
 *
 * The caller reads the session memory and the file system; each decision
 * answers a deny or warnings, plus the memory to write back.
 */
import type { LoopState } from '../types'
import { ALL, STANDARD_UP, STRICT, isOn, tilde } from './config'
import type { Flags } from './config'
import { destructiveMsg, findDestructive, hardDeny } from './rules/bash'
import { devServerMsg, findLongRunning } from './rules/dev-server'
import { factMsg, guardrailMsg, isGuardrail } from './rules/edit'
import { findings, hygieneKey, hygieneMsg } from './rules/hygiene'
import { loopMsg, step } from './rules/loop'
import { checkCommand, checkTexts } from './rules/secret'

export type Verdict = { deny: string } | { warnings: string[] }

export const PASS: Verdict = { warnings: [] }

export type BashBefore = { verdict: Verdict; destructiveKey?: string }

/** secret-guard, pre-bash, dev-server-guard: the denies ahead of commit-gate. */
export function bashBefore(command: string, isBackground: boolean, flags: Flags, destructiveSeen: readonly string[]): BashBefore {
  if (!command) return { verdict: PASS }
  if (isOn(flags, ALL)) {
    const hit = checkCommand(command) ?? hardDeny(command)
    if (hit) return { verdict: { deny: hit } }
  }
  if (!isOn(flags, STANDARD_UP)) return { verdict: PASS }
  // Fact-forced once per identical command, marked before the deny.
  const destructive = findDestructive(command)
  if (destructive && !destructiveSeen.includes(destructive.key)) {
    return { verdict: { deny: destructiveMsg(destructive.what) }, destructiveKey: destructive.key }
  }
  const server = isBackground ? null : findLongRunning(command)
  return { verdict: server ? { deny: devServerMsg(server) } : PASS }
}

export type BashAfterInput = {
  command: string
  flags: Flags
  hygieneSeen: readonly string[]
  loop: LoopState | null
  /** Glob candidates (rules/hygiene globCandidates) that matched no entry. */
  unmatched: readonly string[]
}

export type BashAfter = { warnings: string[]; hygieneKeys: string[]; loop?: LoopState }

/** bash-hygiene and loop-guard, once nothing beneath refused the call. */
export function bashAfter(input: BashAfterInput): BashAfter {
  const { command, flags } = input
  if (!command.trim() || !isOn(flags, STANDARD_UP)) return { warnings: [], hygieneKeys: [] }
  const fresh = findings(command, input.unmatched).filter(f => !input.hygieneSeen.includes(hygieneKey(f, command)))
  const loop = flags.isLoopGuardOff ? null : step(input.loop, command)
  const warnings = [fresh.length ? hygieneMsg(fresh) : null, loop?.isFired ? loopMsg(loop.count) : null]
  return {
    warnings: warnings.filter((w): w is string => w !== null),
    hygieneKeys: fresh.map(f => hygieneKey(f, command)),
    ...(loop ? { loop: loop.state } : {}),
  }
}

/** secret-guard, then pre-edit's guardrail protection: ahead of migration-guard. */
export function editBefore(filePath: string, texts: readonly string[], flags: Flags): Verdict {
  if (!filePath) return PASS
  const secret = isOn(flags, ALL) ? checkTexts(texts, tilde(filePath, flags.home)) : null
  if (secret) return { deny: secret }
  if (isOn(flags, STANDARD_UP) && !flags.isConfigAllowed && isGuardrail(filePath)) {
    return { deny: guardrailMsg(filePath, flags.home) }
  }
  return PASS
}

/** Whether pre-edit fact-forces this file (strict, first write this session). */
export function needsFact(flags: Flags, filePath: string, factSeen: readonly string[]): boolean {
  return Boolean(filePath) && isOn(flags, STRICT) && !factSeen.includes(filePath)
}

/** pre-edit's fact-forcing deny, once `needsFact` holds; `isNew` for a Write to a missing path. */
export function editFact(filePath: string, isNew: boolean, flags: Flags): Verdict {
  return { deny: factMsg(filePath, isNew, flags.home) }
}
