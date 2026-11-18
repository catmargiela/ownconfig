/**
 * hud — a band above the prompt with the session's figures, and a pane with
 * their detail. It only observes: every event is handed on unchanged.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Usage } from '../types'
import { band } from './draw'
import type { View } from './draw'
import { pane } from './pane'
import { probe as readProbe } from './probe'

const PANE = 'hud'
const TICK_MS = 30_000
const MAX_TURNS = 120
const SID = /^[A-Za-z0-9_-]{1,64}$/

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

/**
 * Tells the status line the band is drawn in this conversation, so it drops
 * what the band shows. The status line reads the file's age only, and goes
 * back to its full form two minutes after the last mark.
 */
async function markDrawn($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  const sid = await $.session.id()
  if (!home || !SID.test(sid)) return
  try {
    await $.fs.write(`${home}/.claude/state/ccx/${sid}.hud.json`, JSON.stringify({ at: await $.clock.now() }))
  } catch {
    // not writable: the status line simply stays complete
  }
}

/** Everything the HUD shows, read again: engine figures, context by category, vault, git. */
async function refresh($: EngineInterface): Promise<Usage> {
  const t = await $.clock.now()
  const u = await $.session.usage({ breakdown: 'summary' })
  const fresh = toUsage(u, u.startedAt)
  await update($, usage, () => fresh)
  const used = (u.context.breakdown?.categories ?? []).filter(c => c.kind === 'used' && c.tokens > 0)
  await update($, categories, () => used.map(c => ({ name: c.name, tokens: c.tokens })))
  const home = (await $.env.get('HOME')) ?? ''
  const found = await readProbe((argv, init) => $.process.run(argv, init), home, await $.session.id(), await $.session.cwd(), t)
  await update($, probe, () => found)
  await update($, now, () => t)

  return fresh
}

export const register: Register = on => {
  let tools = 0
  let lastBand = 'jamais demandé par le moteur'
  let lastBandError = 'aucune'
  let isBandDrawn = false
  let tick: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'HUD : ouvre le panneau ; « bandeau » affiche ou masque la bande, « diag » dit ce que le moteur lui demande',
    })
    await refresh($)
    // A session started twice (resume, fork) keeps one timer.
    tick?.cancel()
    tick = $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      // The redraw this write causes sets `isBandDrawn` again while the band shows.
      const wasDrawn = isBandDrawn
      isBandDrawn = false
      await update($, now, () => t)
      if (wasDrawn) await markDrawn($)
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const prev = await read($, usage)
    const startedAt = prev?.startedAt ?? (await $.session.usage()).startedAt
    await update($, usage, () => toUsage(e, startedAt))

    return next(e)
  })

  // `/clear` goes on under a new session id with no `session.start`: what was
  // counted belongs to the conversation that ended.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, turns, () => [])
      await update($, categories, () => [])
      await update($, probe, () => null)
      await update($, usage, () => null)
    }

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
    // The engine ends the turn first: reading the vault and git never delays it.
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const u = await refresh($)
    // No point without a measure: a made-up 0 % would bend the curve.
    if (u.percent !== null && u.usd !== null) {
      const point = { percent: u.percent, usd: u.usd, seconds: Math.round(e.durationMs / 1000), tools }
      await update($, turns, list => [...list, point].slice(-MAX_TURNS))
    }

    return done
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
    lastBand = `surface ${e.surface}, sondage ${e.props.hasSurvey}, masqué ${hidden}, lignes ${e.props.maxRows}, colonnes ${e.props.bodyColumns}`
    if (e.props.hasSurvey || hidden) return next(e)
    const view = await readView($)
    const tree = band($.ui.resolve(e), view, e.props.bodyColumns, e.props.maxRows)
    isBandDrawn = true

    return tree
  }).catch(($, e, next) => {
    isBandDrawn = false
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
      onRefresh: () => refresh($).then(() => undefined),
      onToggleBand: () => update($, isBandHidden, h => !h).then(() => undefined),
      onWorkSession: command => $.prompt.submit({ text: command, asUser: true }).then(() => undefined),
    })
  })
}
