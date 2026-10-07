/**
 * The gates end to end: a tool call raises classic.PreToolUse through the
 * plugin, as in a session; the hooks below stand for the engine and the tool.
 */
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NATIVE_MODULES } from '../hooks/marker'

type Seen = { ran: string[]; logs: string[]; writes: { path: string; text: string }[] }

/** The engine beneath the plugin: a tool that runs, an empty directory, the session's cwd. */
function engine(on: On): Seen {
  const seen: Seen = { ran: [], logs: [], writes: [] }
  on('tool.call', ($, e) => {
    seen.ran.push(e.tool)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('fs.write', ($, e) => {
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('classic.SessionStart', () => ({}))
  return seen
}

const FAKE_GHP = 'gh' + 'p_' + 'aB3dE5gH7jK9mN1pQ3rS5tU7vW9yZ1bC3dE5'

test('a hard deny ends the call in every profile, before the tool runs', async ($, on) => {
  mock.env(on, { CC_PROFILE: 'minimal', HOME: '/home/u' })
  const seen = engine(on)
  const result = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(result.isError ?? 'deny' in result).toBe(true)
  expect(JSON.stringify(result)).toContain('git push --force')
  expect(seen.ran).toEqual([])
})

test('a destructive command is fact-forced once, then runs', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  const first = await $.tool.call({ tool: 'Bash', command: 'rm -rf ./dist' })
  expect(JSON.stringify(first)).toContain('Fact-Forcing Gate')
  expect(seen.ran).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'rm -rf ./dist' })
  expect(seen.ran).toEqual(['Bash'])
})

test('a foreground dev server is refused, in the background it runs', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'next dev' }))).toContain('run_in_background')
  await $.tool.call({ tool: 'Bash', command: 'next dev', run_in_background: true })
  expect(seen.ran).toEqual(['Bash'])
})

test('hygiene warns once per command, without blocking', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  await $.tool.call({ tool: 'Bash', command: 'sleep 30' })
  await $.tool.call({ tool: 'Bash', command: 'ls *.zzz' })
  await $.tool.call({ tool: 'Bash', command: 'sleep 30' })
  expect(seen.ran).toEqual(['Bash', 'Bash', 'Bash'])
  expect(seen.logs.length).toBe(2)
  expect(seen.logs[0]).toContain('[Hygiène Bash]')
  expect(seen.logs[1]).toContain('*.zzz')
})

test('the fourth identical command raises one loop warning', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  for (let i = 0; i < 5; i += 1) await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen.ran.length).toBe(5)
  expect(seen.logs.filter(l => l.startsWith('[Boucle]')).length).toBe(1)
})

test('secrets are denied in edits and writes; CCX_DISABLED turns every gate off', async ($, on) => {
  mock.env(on, { HOME: '/home/u', CCX_DISABLED: '1' })
  const seen = engine(on)
  await $.tool.call({ tool: 'Write', file_path: '/repo/.env', content: `T=${FAKE_GHP}\n` })
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(seen.ran).toEqual(['Write', 'Bash'])
})

test('an edit with a token is denied and the token is never echoed', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  const result = await $.tool.call({
    tool: 'Edit', file_path: '/home/u/app/.env', old_string: 'T=', new_string: `T=${FAKE_GHP}`,
  })
  const text = JSON.stringify(result)
  expect(text).toContain('~/app/.env')
  expect(text.includes(FAKE_GHP.slice(0, 8))).toBe(false)
  expect(seen.ran).toEqual([])
})

test('guardrail configs are protected unless CCX_ALLOW_CONFIG=1', async ($, on) => {
  mock.env(on, { HOME: '/home/u', CCX_ALLOW_CONFIG: '1' })
  const seen = engine(on)
  await $.tool.call({ tool: 'Write', file_path: '/repo/tsconfig.json', content: '{}' })
  expect(seen.ran).toEqual(['Write'])
})

test('guardrail configs are denied in the standard profile', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  const result = await $.tool.call({ tool: 'Write', file_path: '/repo/eslint.config.js', content: 'x' })
  expect(JSON.stringify(result)).toContain('Guardrail Protection')
  expect(seen.ran).toEqual([])
})

test('strict: the first write to a file is fact-forced, the second goes through', async ($, on) => {
  mock.env(on, { HOME: '/home/u', CC_PROFILE: 'strict' })
  const seen = engine(on)
  const first = await $.tool.call({ tool: 'Write', file_path: '/repo/new.ts', content: 'x' })
  expect(JSON.stringify(first)).toContain('Avant de créer')
  await $.tool.call({ tool: 'Write', file_path: '/repo/new.ts', content: 'x' })
  expect(seen.ran).toEqual(['Write'])
})

test('each call it lets through is acknowledged for dispatch.js, a denied one is not', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(seen.writes).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
  expect(seen.writes.length).toBe(2)
  for (const write of seen.writes) {
    expect(write.path).toMatch(/^\/home\/u\/\.claude\/state\/ccx\/native\/[\w-]+\.json$/)
    expect(JSON.parse(write.text).skip).toEqual([...NATIVE_MODULES])
  }
  expect(seen.writes[0]?.path === seen.writes[1]?.path).toBe(false)
})

test('a tool the gates do not handle gets no acknowledgement', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  expect(seen.ran).toEqual(['Read'])
  expect(seen.writes).toEqual([])
})

test('a deny beneath (commit-gate) spends no hygiene warning nor loop count', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  let isRefused = true
  on('classic.PreToolUse', () => (isRefused ? { deny: 'commit-gate' } : {}))
  await $.tool.call({ tool: 'Bash', command: 'sleep 30' })
  expect(seen.logs).toEqual([])
  isRefused = false
  await $.tool.call({ tool: 'Bash', command: 'sleep 30' })
  expect(seen.logs.length).toBe(1)
  expect(seen.logs[0]).toContain('[Hygiène Bash]')
})

test('strict: the fact-forcing waits for the gates beneath (migration-guard)', async ($, on) => {
  mock.env(on, { HOME: '/home/u', CC_PROFILE: 'strict' })
  const seen = engine(on)
  let isRefused = true
  on('classic.PreToolUse', () => (isRefused ? { deny: 'migration-guard' } : {}))
  const first = await $.tool.call({ tool: 'Write', file_path: '/repo/m.sql', content: 'x' })
  expect(JSON.stringify(first)).toContain('migration-guard')
  isRefused = false
  const second = await $.tool.call({ tool: 'Write', file_path: '/repo/m.sql', content: 'x' })
  expect(JSON.stringify(second)).toContain('Fact-Forcing Gate')
  await $.tool.call({ tool: 'Write', file_path: '/repo/m.sql', content: 'x' })
  expect(seen.ran).toEqual(['Write'])
})

test('a /clear starts the memory over: a destructive command is fact-forced again', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const seen = engine(on)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf ./dist' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf ./dist' })
  expect(seen.ran).toEqual(['Bash'])
  await $.classic.SessionStart({ source: 'clear' })
  const again = await $.tool.call({ tool: 'Bash', command: 'rm -rf ./dist' })
  expect(JSON.stringify(again)).toContain('Fact-Forcing Gate')
})
