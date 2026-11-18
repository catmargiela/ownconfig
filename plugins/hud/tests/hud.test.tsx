import { expect, test } from 'claude-code/testing'

const USAGE = {
  startedAt: 0,
  context: { tokens: 84000, window: 200000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23, resetsAt: '2099-01-01T00:00:00.000Z' },
    { kind: 'seven_day', percentUsed: 81 },
  ],
  cost: { usd: 3.42 },
}
const PROBE = {
  memory: {
    name: 'Acme', hasPage: true, why: '', mode: 'sommaire', written: 7740, injected: 2636, budget: 3000,
    startTokens: 900, hasLastSession: true, sections: ['Décisions', 'Pièges'], staleRefs: 3,
  },
  memoryNote: '',
  work: { isOpen: true, startedAt: '2026-11-18T10:00:00.000Z', baseUsd: 1, added: 120, removed: 8, previous: null },
}
const site = { scroll: { offset: 0, bodyRows: 30 }, view: {} }

test('the band and the pane draw the figures', async ($, on) => {
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/work/acme' }))
  on('env.get', () => ({ value: '/home/someone' }))
  on('clock.now', () => ({ value: Date.parse('2026-11-18T11:04:00.000Z') }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout:
        e.argv[0] === 'git'
          ? '## feat/x...origin/feat/x\n M a.ts\n'
          : e.argv[1] === '/home/someone/.claude/bin/hud-data.js'
            ? JSON.stringify(PROBE)
            : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work/acme', surface: 'terminal', isInteractive: true })

  const bandUi = await $.ui.mount({
    plugin: 'hud', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 140, ...site },
  })
  expect(await bandUi.find({ type: 'Text', text: /42 %/ })).toBeDefined()
  expect(await bandUi.find({ type: 'Text', text: /feat\/x/ })).toBeDefined()
  expect(await bandUi.find({ type: 'Text', text: /session ouverte .* 1 h 04/ })).toBeDefined()
  expect(await bandUi.find({ type: 'Text', text: /Acme/ })).toBeDefined()
  expect(await bandUi.find({ type: 'Text', text: /3 réf\. disparues/ })).toBeDefined()
  await bandUi.unmount()

  const paneUi = await $.ui.mount({
    plugin: 'hud', component: 'Pane', requestId: 'hud', surface: 'terminal',
    props: { title: 'HUD', isFocused: false, bodyColumns: 60, placement: 'dock', ...site },
  })
  expect(await paneUi.find({ type: 'Text', text: /84k sur 200k/ })).toBeDefined()
  expect(await paneUi.find({ type: 'Text', text: /Acme/ })).toBeDefined()
  expect(await paneUi.find({ type: 'Text', text: /3 fichier/ })).toBeDefined()
  expect(await paneUi.find({ key: 'end' })).toBeDefined()
  await paneUi.unmount()
})
