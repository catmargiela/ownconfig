import type { EngineInterface, Register, SessionUsage, ToolCallEnvelope } from 'claude-code'

import { PASS, bashAfter, bashBefore, editBefore, editFact, needsFact } from './checks'
import type { Verdict } from './checks'
import { STANDARD_UP, isOn, toFlags, toTurnFlags } from './config'
import type { Flags, TurnFlags } from './config'
import { NATIVE, ackPath } from './marker'
import { globCandidates, globQuery } from './rules/hygiene'
import { OSASCRIPT, notifyArgv } from './rules/turn'
import { contextCheck, deliveryCheck, isTimerOn, notifySeconds, quotaCheck } from './turn-checks'

const DESTRUCTIVE = { plugin: 'ccx', key: 'destructive' } as const
const HYGIENE = { plugin: 'ccx', key: 'hygiene' } as const
const LOOP = { plugin: 'ccx', key: 'loop' } as const
const FACT_SEEN = { plugin: 'ccx', key: 'factSeen' } as const
const CONTEXT_WARNED = { plugin: 'ccx', key: 'contextWarned' } as const
const QUOTA_SEEN = { plugin: 'ccx', key: 'quotaSeen' } as const
const DELIVERY_SEEN = { plugin: 'ccx', key: 'deliverySeen' } as const
const TURN_START = { plugin: 'ccx', key: 'turnStart' } as const

/** The session lists; `$.state` takes each reference as a literal, so they are named. */
type SeenList = 'destructive' | 'hygiene' | 'factSeen'

/** Session lists are capped like ccx's state files, so a long session stays small. */
const MAX_SEEN = 500

/** The call as the gates read it; null for a tool they do not handle. */
type Call =
  | { kind: 'bash'; command: string; isBackground: boolean }
  | { kind: 'edit'; filePath: string; texts: string[]; isWrite: boolean }

function toCall(e: ToolCallEnvelope): Call | null {
  if (e.tool === 'Bash') return { kind: 'bash', command: e.command, isBackground: e.run_in_background === true }
  if (e.tool === 'Edit') return { kind: 'edit', filePath: e.file_path, texts: [e.new_string], isWrite: false }
  if (e.tool === 'Write') return { kind: 'edit', filePath: e.file_path, texts: [e.content], isWrite: true }
  return null
}

async function readFlags($: EngineInterface): Promise<Flags> {
  return toFlags({
    profile: await $.env.get('CC_PROFILE'),
    disabled: await $.env.get('CCX_DISABLED'),
    allowConfig: await $.env.get('CCX_ALLOW_CONFIG'),
    loopGuard: await $.env.get('CCX_LOOP_GUARD'),
    home: await $.env.get('HOME'),
  })
}

async function getSeen($: EngineInterface, list: SeenList): Promise<{ value: string[]; version: number }> {
  const held =
    list === 'destructive'
      ? await $.state.get(DESTRUCTIVE)
      : list === 'hygiene'
        ? await $.state.get(HYGIENE)
        : await $.state.get(FACT_SEEN)
  return { value: held.value ?? [], version: held.version }
}

async function setSeen($: EngineInterface, list: SeenList, value: string[], ifVersion: number): Promise<boolean> {
  const written =
    list === 'destructive'
      ? await $.state.set(DESTRUCTIVE, value, { ifVersion })
      : list === 'hygiene'
        ? await $.state.set(HYGIENE, value, { ifVersion })
        : await $.state.set(FACT_SEEN, value, { ifVersion })
  return written.isSet
}

/** Adds `items` to a session list; a parallel call's write in between is merged, not lost. */
async function appendSeen($: EngineInterface, list: SeenList, items: readonly string[]): Promise<void> {
  if (!items.length) return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const held = await getSeen($, list)
    if (await setSeen($, list, [...held.value, ...items].slice(-MAX_SEEN), held.version)) return
  }
}

/**
 * Tells dispatch.js the `modules` of this event run here (marker.ts). False
 * when no acknowledgement was written: dispatch.js then runs them all, and the
 * plugin must not run them a second time after next(e).
 */
async function writeAck($: EngineInterface, key: string | undefined, home: string, modules: readonly string[]): Promise<boolean> {
  const path = home && key ? ackPath(home, key) : null
  if (!path) return false
  return $.fs.write(path, JSON.stringify({ skip: modules })).then(
    () => true,
    () => false,
  )
}

async function readTurnFlags($: EngineInterface): Promise<TurnFlags> {
  return toTurnFlags({
    profile: await $.env.get('CC_PROFILE'),
    disabled: await $.env.get('CCX_DISABLED'),
    home: await $.env.get('HOME'),
    contextMonitor: await $.env.get('CC_CONTEXT_MONITOR'),
    contextLimit: await $.env.get('CC_CONTEXT_LIMIT'),
    contextWarn: await $.env.get('CC_CONTEXT_WARN'),
    contextSoft: await $.env.get('CC_CONTEXT_SOFT'),
    quotaAlert: await $.env.get('CCX_QUOTA_ALERT'),
    quotaWarn: await $.env.get('CCX_QUOTA_WARN'),
    deliveryCheck: await $.env.get('CCX_DELIVERY_CHECK'),
    notify: await $.env.get('CCX_NOTIFY'),
    notifyAfter: await $.env.get('CCX_NOTIFY_AFTER'),
  })
}

/** context-monitor on the API's own reading: the text that sends the agent back, or null. */
async function contextBlock($: EngineInterface, usage: SessionUsage, flags: TurnFlags): Promise<string | null> {
  const warned = (await $.state.get(CONTEXT_WARNED)).value ?? []
  const outcome = contextCheck(usage.context.tokens, usage.context.window, flags, warned)
  if (!outcome) return null
  await $.state.set(CONTEXT_WARNED, outcome.warned)
  return outcome.block
}

/** delivery-check and the turn-timer notification, once the answer is really over. */
async function turnOver($: EngineInterface, text: string | undefined, cwd: string, flags: TurnFlags): Promise<void> {
  const delivery = deliveryCheck(text, flags, (await $.state.get(DELIVERY_SEEN)).value ?? [])
  if (delivery) {
    await $.state.set(DELIVERY_SEEN, delivery.seen)
    $.ui.log(delivery.warning)
  }
  const start = (await $.state.get(TURN_START)).value ?? null
  if (start === null) return
  await $.state.set(TURN_START, null)
  const sec = notifySeconds(start, await $.clock.now(), flags)
  if (sec === null || !(await $.fs.exists(OSASCRIPT).catch(() => false))) return
  // A notification never matters more than the answer: bounded, and its failure ignored.
  await $.process.run(notifyArgv(sec, cwd), { timeoutMs: 5000 }).catch(() => undefined)
}

/** turn-timer's start of the turn (macOS: osascript present). */
async function startTimer($: EngineInterface, flags: TurnFlags): Promise<void> {
  if (isTimerOn(flags) && (await $.fs.exists(OSASCRIPT).catch(() => false))) {
    await $.state.set(TURN_START, await $.clock.now())
  }
}

/** quota-alert on the last response's rate limits: the warnings to give. */
async function quotaWarnings($: EngineInterface, usage: SessionUsage, flags: TurnFlags): Promise<string[]> {
  const seen = (await $.state.get(QUOTA_SEEN)).value ?? {}
  const outcome = quotaCheck(usage.rateLimits, seen, (await $.clock.now()) / 1000, flags)
  if (!outcome) return []
  await $.state.set(QUOTA_SEEN, outcome.seen)
  return outcome.warnings
}

/** Glob candidates of `command` that match no entry of their directory. */
async function unmatchedGlobs($: EngineInterface, command: string): Promise<string[]> {
  const candidates = globCandidates(command)
  if (!candidates.length) return []
  const cwd = await $.session.cwd()
  const out: string[] = []
  for (const token of candidates) {
    const query = globQuery(token, cwd)
    if (!query) continue
    const entries = await $.fs.list(query.dir).catch(() => [])
    const isMatched = entries.some(
      ({ name }) => query.pattern.test(name) && !(query.isHiddenSkipped && name.startsWith('.')),
    )
    if (!isMatched) out.push(token)
  }
  return out
}

/** The denies that come before the settings hooks. */
async function before($: EngineInterface, call: Call, flags: Flags): Promise<Verdict> {
  if (call.kind === 'edit') return editBefore(call.filePath, call.texts, flags)
  const seen = (await $.state.get(DESTRUCTIVE)).value ?? []
  const outcome = bashBefore(call.command, call.isBackground, flags, seen)
  if (outcome.destructiveKey) await appendSeen($, 'destructive', [outcome.destructiveKey])
  return outcome.verdict
}

/** What runs once the settings hooks let the call through. */
async function after($: EngineInterface, call: Call, flags: Flags): Promise<Verdict> {
  if (call.kind === 'edit') {
    const factSeen = (await $.state.get(FACT_SEEN)).value ?? []
    if (!needsFact(flags, call.filePath, factSeen)) return PASS
    const isNew = call.isWrite && !(await $.fs.exists(call.filePath).catch(() => false))
    // Marked BEFORE the deny: the second pass must go through, or it loops.
    await appendSeen($, 'factSeen', [call.filePath])
    return editFact(call.filePath, isNew, flags)
  }
  const outcome = bashAfter({
    command: call.command,
    flags,
    hygieneSeen: (await $.state.get(HYGIENE)).value ?? [],
    loop: (await $.state.get(LOOP)).value ?? null,
    unmatched: isOn(flags, STANDARD_UP) ? await unmatchedGlobs($, call.command) : [],
  })
  await appendSeen($, 'hygiene', outcome.hygieneKeys)
  if (outcome.loop) await $.state.set(LOOP, outcome.loop)
  return { warnings: outcome.warnings }
}

export const register: Register = on => {
  // A /clear goes on under a new session id: its memory starts empty, as ccx's
  // per-session state files did. A compaction resets the context warnings, as
  // ccx's did on reading the compact summary.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'compact') await $.state.set(CONTEXT_WARNED, [])
    if (e.source === 'clear') {
      await $.state.set(DESTRUCTIVE, [])
      await $.state.set(HYGIENE, [])
      await $.state.set(LOOP, null)
      await $.state.set(FACT_SEEN, [])
      await $.state.set(QUOTA_SEEN, {})
      await $.state.set(DELIVERY_SEEN, [])
      await $.state.set(TURN_START, null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // End of the answer. The settings hooks (stop-quality, companion-check) run
  // first; when one sends the agent back, nothing here runs, as in dispatch.js.
  on('classic.Stop', async ($, e, next) => {
    const flags = await readTurnFlags($)
    const usage = await $.session.usage()
    const isAcked = await writeAck($, e.prompt_id && `stop-${e.prompt_id}`, flags.home, NATIVE.stop)
    const result = await next(e)
    if (result.block !== undefined || !isAcked) return result
    // Past next(e) a failure must not reach .catch, which would run the settings hooks again.
    const block = await contextBlock($, usage, flags).catch(() => null)
    if (block) return { ...result, block }
    await turnOver($, e.last_assistant_message, e.cwd, flags).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e)) // no acknowledgement written: dispatch.js runs every module

  // A prompt: the turn's timer starts, and a crossed quota threshold is told to
  // the user and to the model.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const flags = await readTurnFlags($)
    const usage = await $.session.usage()
    const isAcked = await writeAck($, e.prompt_id && `prompt-${e.prompt_id}`, flags.home, NATIVE.prompt)
    const result = await next(e)
    if (result.block !== undefined || !isAcked) return result
    await startTimer($, flags).catch(() => undefined)
    const warnings = await quotaWarnings($, usage, flags).catch(() => [])
    if (!warnings.length) return result
    for (const warning of warnings) $.ui.log(warning)
    return { ...result, additionalContext: [...(result.additionalContext ?? []), ...warnings] }
  }).catch(($, e, next) => next(e))

  // Above the settings hooks. Denies first; then the acknowledgement that lets
  // dispatch.js skip the ported modules for this call alone; then, once nothing
  // beneath refused, the gates that spend a once-per-session pass or a counter.
  on('classic.PreToolUse', async ($, e, next) => {
    const call = toCall(e)
    if (call === null) return next(e)
    const flags = await readFlags($)
    const first = await before($, call, flags)
    if ('deny' in first) return { deny: first.deny }
    const isAcked = await writeAck($, e.tool_use_id, flags.home, NATIVE.preTool)
    const result = await next(e)
    if (result.deny !== undefined || !isAcked) return result
    // Past next(e) a failure must not reach .catch, which would run the settings hooks again.
    const second = await after($, call, flags).catch(() => PASS)
    if ('deny' in second) return { deny: second.deny }
    if (!second.warnings.length) return result
    for (const warning of second.warnings) $.ui.log(warning)
    return { ...result, additionalContext: [...(result.additionalContext ?? []), ...second.warnings] }
  }).catch(($, e, next) => next(e)) // no acknowledgement written: dispatch.js runs every gate
}
