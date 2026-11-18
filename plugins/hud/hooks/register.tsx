/**
 * hud — a band above the prompt with the session's figures, and a pane with
 * their detail. It only observes: every event is handed on unchanged.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Usage } from '../types'
import { band, pane } from './draw'
import type { View } from './draw'
import { probe as readProbe } from './probe'

const PANE = 'hud'
const TICK_MS = 30_000
const MAX_TURNS = 120

const usage = atom({ plugin: 'hud', key: 'usage' } as const, null, { shape: 'usage-1' })
const turns = atom({ plugin: 'hud', key: 'turns' } as const, [], { shape: 'turns-1' })
const categories = atom({ plugin: 'hud', key: 'categories' } as const, [], { shape: 'categories-1' })
const probe = atom({ plugin: 'hud', key: 'probe' } as const, null, { shape: 'probe-1' })
const now = atom({ plugin: 'hud', key: 'now' } as const, 0)
const isBandHidden = atom({ plugin: 'hud', key: 'isBandHidden' } as const, false)

type Measured = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function toUsage(m: Measured, startedAt: number): Usage {
  const limits: Limit[] = m.rateLimits.map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt ?? null }))
  return {
    tokens: m.context.tokens ?? null,
    window: m.context.window,
    percent: m.context.percent ?? null,
    limits,
    usd: m.cost?.usd ?? null,
    startedAt,
  }
}


async function readView($: EngineInterface): Promise<View> {
  return {
    usage: await read($, usage),
    turns: await read($, turns),
    categories: await read($, categories),
    probe: await read($, probe),
    now: (await read($, now)) || (await $.clock.now()),
  }
}

/** Everything the HUD shows, read again: engine figures, context by category, vault, git. */
async function refresh($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  const u = await $.session.usage({ breakdown: 'summary' })
  await update($, usage, () => toUsage(u, u.startedAt))
  const used = (u.context.breakdown?.categories ?? []).filter(c => c.kind === 'used' && c.tokens > 0)
  await update($, categories, () => used.map(c => ({ name: c.name, tokens: c.tokens })))
  const home = (await $.env.get('HOME')) ?? ''
  const found = await readProbe((argv, init) => $.process.run(argv, init), home, await $.session.id(), await $.session.cwd(), t)
  await update($, probe, () => found)
  await update($, now, () => t)
}

export const register: Register = on => {
  let tools = 0
  let bandCalls = 0
  let lastBand = 'jamais demandé par le moteur'
  let lastBandError = 'aucune'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hud', description: 'HUD : ouvre le panneau (ou « bandeau » pour afficher/masquer la bande)' })
    await refresh($)
    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, prev => toUsage(e, prev?.startedAt ?? 0))

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    tools = 0

    return next(e)
  })

  on('tool.call', ($, e, next) => {
    tools += 1

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const u = await $.session.usage()
    const point = {
      percent: u.context.percent ?? 0,
      usd: u.cost?.usd ?? 0,
      seconds: Math.round(e.durationMs / 1000),
      tools,
    }
    await update($, turns, list => [...list, point].slice(-MAX_TURNS))
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    if (e.args.trim() === 'bandeau') {
      await update($, isBandHidden, hidden => !hidden)

      return { text: (await read($, isBandHidden)) ? 'Bandeau masqué.' : 'Bandeau affiché.' }
    }
    if (e.args.trim() === 'diag') {
      const u = await read($, usage)

      return { text: `Bandeau : ${lastBand}. Erreur : ${lastBandError}. Mesure : ${u ? `${u.percent ?? '?'} %, ${u.usd ?? '?'} $` : 'aucune'}.` }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: 'HUD' })

    return { text: 'Panneau HUD ouvert.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await read($, isBandHidden)
    bandCalls += 1
    lastBand = `appels ${bandCalls}, surface ${e.surface}, sondage ${e.props.hasSurvey}, masqué ${hidden}, lignes ${e.props.maxRows}, colonnes ${e.props.bodyColumns}`
    if (e.props.hasSurvey || hidden) return next(e)
    const view = await readView($)

    return band($.ui.resolve(e), view, e.props.bodyColumns, e.props.maxRows)
  }).catch(($, e, next) => {
    // The band was refused or threw: say why in its place, and to /hud diag.
    lastBandError = `${next.error.kind} : ${next.error.message ?? 'sans message'}`
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color="warning">HUD en erreur — {lastBandError.slice(0, 300)}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const hidden = await read($, isBandHidden)

    return pane($.ui.resolve(e), await readView($), e.props.bodyColumns, {
      isBandHidden: hidden,
      onRefresh: () => refresh($),
      onToggleBand: () => update($, isBandHidden, h => !h).then(() => undefined),
      onWorkSession: command => $.prompt.submit({ text: command, asUser: true }).then(() => undefined),
    })
  })
}
