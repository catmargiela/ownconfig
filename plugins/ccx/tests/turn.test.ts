/**
 * Phase 2: context-monitor, delivery-check, turn-timer (Stop) and quota-alert,
 * turn-timer (UserPromptSubmit), on the fixtures of test-status.js and
 * test-port.js, then end to end through the classic events.
 */
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { toTurnFlags } from '../hooks/config'
import { NATIVE } from '../hooks/marker'
import { contextReason } from '../hooks/rules/context'
import { findPhrases } from '../hooks/rules/delivery'
import { crossings, thresholds, untilReset } from '../hooks/rules/quota'
import { duration, notifyArgv } from '../hooks/rules/turn'
import { contextCheck, notifySeconds } from '../hooks/turn-checks'

const NOW = 1_800_000_000
const iso = (sec: number): string => new Date(sec * 1000).toISOString()
const five = (pct: number, resetSec = NOW + 3600) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: iso(resetSec) }]

test('quota-alert: thresholds crossed once per window and reset', async () => {
  expect(crossings(five(79), {}, NOW, [80, 95])).toEqual([])
  expect(crossings(five(82), {}, NOW, [80, 95]).map(c => [c.kind, c.level, c.pct])).toEqual([['five_hour', 80, 82]])
  const seen80 = { five_hour: { resetsAt: iso(NOW + 3600), level: 80 } }
  expect(crossings(five(82), seen80, NOW, [80, 95])).toEqual([])
  expect(crossings(five(96), seen80, NOW, [80, 95]).map(c => c.level)).toEqual([95])
  const seen95 = { five_hour: { resetsAt: iso(NOW + 3600), level: 95 } }
  expect(crossings(five(85, NOW + 9000), seen95, NOW, [80, 95]).length).toBe(1)
  expect(crossings(five(99, NOW - 1), {}, NOW, [80, 95])).toEqual([])
  expect(crossings([{ kind: 'spend_limit', percentUsed: 99 }], {}, NOW, [80, 95])).toEqual([])
  expect(thresholds('abc')).toEqual([80, 95])
  expect(thresholds('90,70')).toEqual([70, 90])
  expect(untilReset(NOW + 6000, NOW)).toBe('1 h 40')
  expect(untilReset(NOW + 3 * 86400 + 7200, NOW)).toBe('3 j 2 h')
  expect(untilReset(null, NOW)).toBe('')
})

test('delivery-check: excuses flagged, proven or neutral answers not', async () => {
  const keys = (t: string): string[] => findPhrases(t, []).map(p => p.key)
  expect(keys('Le test rouge est un bug préexistant.')).toEqual(['preexisting'])
  expect(keys('This is pre-existing; skipping the tests for now.')).toEqual(['preexisting', 'skip-tests'])
  expect(keys('Hors périmètre. Ça devrait maintenant marcher.')).toEqual(['unrelated', 'should-work'])
  expect(keys('Tests : 152 réussis, 0 échoués (node test.js).')).toEqual([])
  expect(keys('The pre-existing tests pass and I added two. Le test existant reste vert.')).toEqual([])
  expect(keys('The CI failure is pre-existing.')).toEqual(['preexisting'])
  expect(findPhrases('bug préexistant', ['preexisting']).length).toBe(0)
})

test('context-monitor: window and cost reasons, once each, off switch', async () => {
  expect(contextReason(100_000, 1_000_000, 0.7, 150_000, [])).toBeNull()
  expect(contextReason(160_000, 1_000_000, 0.7, 150_000, [])).toBe('cost')
  expect(contextReason(160_000, 1_000_000, 0.7, 150_000, ['cost'])).toBeNull()
  expect(contextReason(150_000, 200_000, 0.7, 150_000, ['cost'])).toBe('window')
  const flags = toTurnFlags({ contextLimit: '200000' })
  expect(contextCheck(150_000, 1_000_000, flags, [])?.warned).toEqual(['window'])
  expect(contextCheck(undefined, 1_000_000, flags, [])).toBeNull()
  expect(contextCheck(990_000, 1_000_000, toTurnFlags({ contextMonitor: 'off' }), [])).toBeNull()
  // Not gated by CCX_DISABLED, as in ccx.
  expect(contextCheck(160_000, 1_000_000, toTurnFlags({ disabled: '1' }), [])).not.toBeNull()
})

test('turn-timer: durations, threshold and argv', async () => {
  expect([duration(42), duration(192), duration(3600)]).toEqual(['42 s', '3 min 12', '60 min 00'])
  const flags = toTurnFlags({})
  expect(notifySeconds(0, 89_000, flags)).toBeNull()
  expect(notifySeconds(0, 95_000, flags)).toBe(95)
  expect(notifySeconds(0, 95_000, toTurnFlags({ notify: 'OFF' }))).toBeNull()
  expect(notifySeconds(0, 95_000, toTurnFlags({ profile: 'minimal' }))).toBeNull()
  expect(notifySeconds(0, 35_000, toTurnFlags({ notifyAfter: '30' }))).toBe(35)
  const argv = notifyArgv(95, '/Users/u/projx/')
  expect(argv.slice(-2)).toEqual(['Réponse terminée en 1 min 35', 'Claude Code · projx'])
})

type Seen = { logs: string[]; writes: string[]; runs: string[][] }

/** The engine beneath: a usage reading, a clock, osascript present, the classic events. */
function engine(on: On, tokens: number | undefined, rate: number, clock: { now: number }, isUsageDenied = false): Seen {
  const seen: Seen = { logs: [], writes: [], runs: [] }
  on('session.usage', () =>
    isUsageDenied
      ? { deny: 'no ledger' }
      : {
          value: {
            startedAt: 0,
            context: { tokens, window: 1_000_000 },
            rateLimits: [{ kind: 'five_hour', percentUsed: rate, resetsAt: iso(NOW + 3600) }],
          },
        },
  )
  on('clock.now', () => ({ value: clock.now }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', ($, e) => {
    seen.writes.push(e.path)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    seen.runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  return seen
}

test('Stop: past the cost threshold the agent is sent back once, then not again', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  engine(on, 160_000, 10, { now: NOW * 1000 })
  on('classic.Stop', () => ({}))
  const first = await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p1' })
  expect(first.block).toContain('[Contexte] 160k tokens')
  const second = await $.classic.Stop({ stop_hook_active: true, prompt_id: 'p1' })
  expect(second.block).toBeUndefined()
  // A compaction starts the warnings over.
  await $.classic.SessionStart({ source: 'compact' })
  expect((await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p2' })).block).toContain('[Contexte]')
})

test('Stop: when a settings gate sends the agent back, nothing here runs', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on, 160_000, 10, { now: NOW * 1000 })
  on('classic.Stop', () => ({ block: 'typecheck failed' }))
  const result = await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p1', last_assistant_message: 'bug préexistant' })
  expect(result.block).toBe('typecheck failed')
  expect(seen.logs).toEqual([])
})

test('Stop: a real end warns on an unproven claim and notifies a long turn', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const clock = { now: NOW * 1000 }
  const seen = engine(on, 20_000, 10, clock)
  on('classic.Stop', () => ({}))
  await $.classic.UserPromptSubmit({ prompt: 'fix it', prompt_id: 'p1' })
  clock.now += 120_000
  const message = 'Corrigé. Le reste est un bug préexistant.'
  const result = await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p1', last_assistant_message: message, cwd: '/w/projx' })
  expect(result.block).toBeUndefined()
  expect(seen.logs.length).toBe(1)
  expect(seen.logs[0]).toContain('[Livraison]')
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0]?.slice(-2)).toEqual(['Réponse terminée en 2 min 00', 'Claude Code · projx'])
  // The same phrase is not reported twice; a short turn is not notified.
  await $.classic.UserPromptSubmit({ prompt: 'again', prompt_id: 'p2' })
  await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p2', last_assistant_message: message })
  expect(seen.logs.length).toBe(1)
  expect(seen.runs.length).toBe(1)
})

test('UserPromptSubmit: a crossed quota threshold reaches the user and the model once', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on, 20_000, 82, { now: NOW * 1000 })
  const first = await $.classic.UserPromptSubmit({ prompt: 'go', prompt_id: 'p1' })
  expect(first.additionalContext?.[0]).toContain('[Quota] Fenêtre 5 h à 82 %')
  expect(seen.logs.length).toBe(1)
  const second = await $.classic.UserPromptSubmit({ prompt: 'go', prompt_id: 'p2' })
  expect(second.additionalContext).toBeUndefined()
})

test('without a prompt_id there is no acknowledgement, and the plugin leaves the modules to dispatch.js', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on, 160_000, 82, { now: NOW * 1000 })
  on('classic.Stop', () => ({}))
  const prompt = await $.classic.UserPromptSubmit({ prompt: 'go' })
  const stop = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'bug préexistant' })
  expect(prompt.additionalContext).toBeUndefined()
  expect(stop.block).toBeUndefined()
  expect(seen.logs).toEqual([])
  expect(seen.writes).toEqual([])
})

test('a failing usage reading leaves no acknowledgement and the result beneath as is', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on, 20_000, 10, { now: NOW * 1000 }, true)
  on('classic.Stop', () => ({ additionalContext: ['from beneath'] }))
  const result = await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p1' })
  expect(result.additionalContext).toEqual(['from beneath'])
  expect(seen.writes).toEqual([])
})

test('a /clear starts the quota and delivery memory over', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on, 20_000, 82, { now: NOW * 1000 })
  on('classic.Stop', () => ({}))
  await $.classic.UserPromptSubmit({ prompt: 'go', prompt_id: 'p1' })
  await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p1', last_assistant_message: 'bug préexistant' })
  expect(seen.logs.length).toBe(2)
  await $.classic.SessionStart({ source: 'clear' })
  await $.classic.UserPromptSubmit({ prompt: 'go', prompt_id: 'p2' })
  await $.classic.Stop({ stop_hook_active: false, prompt_id: 'p2', last_assistant_message: 'bug préexistant' })
  expect(seen.logs.length).toBe(4)
})

test('each event is acknowledged under its own key, for its own modules', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on, 20_000, 10, { now: NOW * 1000 })
  on('classic.Stop', () => ({}))
  await $.classic.UserPromptSubmit({ prompt: 'go', prompt_id: 'abc' })
  await $.classic.Stop({ stop_hook_active: false, prompt_id: 'abc' })
  expect(seen.writes).toEqual([
    '/home/u/.claude/state/ccx/native/prompt-abc.json',
    '/home/u/.claude/state/ccx/native/stop-abc.json',
  ])
  expect(NATIVE.stop).toContain('./lib/context-monitor')
})
