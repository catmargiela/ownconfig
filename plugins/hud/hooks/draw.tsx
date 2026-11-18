/** The band above the prompt, and the row helpers the pane shares. Pure: figures in, tree out. */
import type { Color, Elements } from 'claude-code'

import type { Category, Limit, Probe, TurnPoint, Usage } from '../types'
import {
  WARN_PERCENT,
  burn,
  clock,
  gauge,
  limitName,
  pickLimit,
  spark,
  span,
  tokens,
  tone,
  turnCosts,
  turnsLeft,
  until,
  usd,
} from './format'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type View = {
  usage: Usage | null
  turns: readonly TurnPoint[]
  categories: readonly Category[]
  probe: Probe | null
  now: number
}

export type Actions = {
  onRefresh: () => Promise<void>
  onWorkSession: (command: string) => Promise<void>
  onToggleBand: () => Promise<void>
  isBandHidden: boolean
}

export type Seg = { t: string; color?: Color; isDim?: boolean; isBold?: boolean }

export const seg = (t: string, color?: Color, more: { isDim?: boolean; isBold?: boolean } = {}): Seg =>
  color === undefined ? { t, ...more } : { t, color, ...more }
export const dim = (t: string): Seg => ({ t, isDim: true })
export const bold = (t: string, color?: Color): Seg => seg(t, color, { isBold: true })
const SEP = dim(' │ ')

/** One row, cut at `width` so the band never wraps. */
export function row(ui: Ui, segs: readonly Seg[], width: number) {
  const { Box, Text } = ui
  let room = Math.max(1, width)
  const kept: Seg[] = []
  for (const s of segs) {
    if (room <= 0) break
    const t = s.t.length > room ? `${s.t.slice(0, Math.max(0, room - 1))}…` : s.t
    kept.push({ ...s, t })
    room -= t.length
  }
  return (
    <Box flexDirection="row">
      {kept.map(s => (
        <Text
          {...(s.color === undefined ? {} : { color: s.color })}
          dimColor={s.isDim === true}
          bold={s.isBold === true}
          wrap="truncate-end"
        >
          {s.t}
        </Text>
      ))}
    </Box>
  )
}

function limitSegs(limit: Limit | null, now: number, cells: number): Seg[] {
  if (!limit) return []
  const color = tone(limit.percent)
  const left = until(limit.resetsAt, now)
  return [
    SEP,
    seg(`${limitName(limit.kind)} `),
    ...(cells > 0 ? [seg(`${gauge(limit.percent, cells)} `, color)] : []),
    bold(`${Math.round(limit.percent)} %`, color),
    ...(left ? [dim(` ↻ ${left}`)] : []),
  ]
}

function contextSegs(v: View, cells: number): Seg[] {
  const u = v.usage
  const percent = u?.percent ?? null
  const color = tone(percent)
  const left = turnsLeft(v.turns, percent)
  return [
    bold('CTX '),
    seg(`${gauge(percent, cells)} `, color),
    bold(percent === null ? '— ' : `${Math.round(percent)} % `, color),
    dim(u && u.tokens !== null ? `${tokens(u.tokens)}/${tokens(u.window)}` : u ? `fenêtre ${tokens(u.window)}` : ''),
    ...(v.turns.length > 1 ? [seg(`  ${spark(v.turns.slice(-24).map(t => t.percent), 100)}`, color)] : []),
    ...(left === null ? [] : [dim(`  ≈ ${left} tours avant ${WARN_PERCENT} %`)]),
  ]
}

function costSegs(v: View): Seg[] {
  const u = v.usage
  if (!u || u.usd === null) return [dim('coût inconnu')]
  const costs = turnCosts(v.turns)
  const last = costs[costs.length - 1]
  const rate = burn(u.usd, u.startedAt, v.now)
  return [
    bold(usd(u.usd)),
    ...(last === undefined ? [] : [dim(` +${last.toFixed(2)}`)]),
    ...(rate === null ? [] : [dim(` · ${usd(rate)}/h`)]),
  ]
}

function gitSegs(p: Probe | null): Seg[] {
  if (!p?.branch) return []
  return [seg(`⎇ ${p.branch}`, 'suggestion'), ...(p.dirty > 0 ? [seg(` ●${p.dirty}`, 'warning')] : [])]
}

function placeSegs(p: Probe | null, now: number): Seg[] {
  if (!p) return []
  const out: Seg[] = p.branch ? [SEP, ...gitSegs(p)] : []
  if (p.memory?.hasPage) {
    out.push(SEP, seg('◆ ', 'claude'), seg(`mémoire ${p.memory.mode}`))
    if (p.memory.staleRefs > 0) out.push(seg(` ⚠ ${p.memory.staleRefs}`, 'warning'))
  } else if (p.memory) out.push(SEP, dim('◇ pas de page'))
  const started = p.work?.isOpen && p.work.startedAt ? Date.parse(p.work.startedAt) : NaN
  if (Number.isFinite(started)) out.push(SEP, seg('● ', 'success'), seg(`session ${span(now - started)}`))
  return out
}

const tag = (t: string): Seg => bold(t.padEnd(6), 'claude')

/** What fills the context, largest first, on one row. */
function categorySegs(v: View): Seg[] {
  const used = [...v.categories].sort((a, b) => b.tokens - a.tokens).slice(0, 6)
  if (!used.length) return [dim('pas encore de détail')]
  return used.flatMap((c, i) => [...(i ? [dim(' · ')] : []), seg(c.name), dim(` ${tokens(c.tokens)}`)])
}

function costDetailSegs(v: View): Seg[] {
  const u = v.usage
  if (!u || u.usd === null) return [dim('coût inconnu')]
  const costs = turnCosts(v.turns)
  const last = v.turns[v.turns.length - 1]
  const lastCost = costs[costs.length - 1]
  const rate = burn(u.usd, u.startedAt, v.now)
  const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null
  return [
    bold(usd(u.usd)),
    dim(` en ${span(v.now - u.startedAt)}`),
    ...(rate === null ? [] : [dim(` · ${usd(rate)}/h`)]),
    ...(mean === null ? [] : [dim(` · ${usd(mean)}/tour`)]),
    ...(last && lastCost !== undefined ? [dim(` · dernier ${usd(lastCost)} (${span(last.seconds * 1000)}, ${last.tools} outils)`)] : []),
    ...(costs.length > 1 ? [seg(`  ${spark(costs.slice(-24))}`, 'warning')] : []),
  ]
}

function workSegs(v: View): Seg[] {
  const p = v.probe
  const w = p?.work ?? null
  const out: Seg[] = p?.branch ? [...gitSegs(p), SEP] : []
  const started = w?.isOpen && w.startedAt ? Date.parse(w.startedAt) : NaN
  if (w && Number.isFinite(started)) {
    const spent = v.usage?.usd != null ? Math.max(0, v.usage.usd - w.baseUsd) : null
    out.push(seg('● ', 'success'), seg(`session ouverte ${clock(w.startedAt)} · ${span(v.now - started)}`))
    if (spent !== null) out.push(bold(` · ${usd(spent)}`))
    out.push(seg(` +${w.added}`, 'success'), seg(` −${w.removed}`, 'error'))
  } else out.push(dim('○ pas de session ouverte — /startsession'))
  const prev = w?.previous ?? null
  if (prev) {
    out.push(SEP, dim(`précédente ${clock(prev.endedAt ?? prev.startedAt)}`))
    if (prev.usd !== null) out.push(dim(` · ${usd(prev.usd)}`))
    const first = prev.bilan.split('\n').map(l => l.trim()).find(l => l.startsWith('- '))
    if (first) out.push(dim(` · ${first.slice(2)}`))
  }
  return out
}

function memorySegs(v: View): Seg[] {
  const p = v.probe
  const m = p?.memory ?? null
  if (!m) return [dim(p?.memoryNote || 'pas encore lue')]
  if (!m.hasPage) return [seg('◇ ', 'warning'), seg(`aucune page${m.why ? ` : ${m.why}` : ''}`), dim(' · notes dans le journal')]
  return [
    seg('◆ ', 'claude'),
    bold(m.name),
    seg(` ${m.mode}`, m.mode === 'vide' ? 'warning' : 'success'),
    dim(` · ${m.injected}/${m.written} car. · ~${tokens(m.startTokens)} tok`),
    dim(' · dernière session '),
    seg(m.hasLastSession ? 'oui' : 'non', m.hasLastSession ? 'success' : 'inactive'),
    ...(m.staleRefs > 0 ? [seg(` · ⚠ ${m.staleRefs} réf. disparues`, 'warning')] : []),
    ...(m.sections.length ? [dim(` · § ${m.sections.join(' § ')}`)] : []),
  ]
}

/**
 * The HUD above the prompt: everything on five rows, most important first, so
 * a band the engine keeps short loses the last ones.
 */
export function band(ui: Ui, v: View, width: number, rows: number) {
  const { Box } = ui
  const limits = v.usage?.limits ?? []
  const cells = width >= 120 ? 8 : 0
  const five = limitSegs(pickLimit(limits, 'five_hour'), v.now, cells)
  const seven = limitSegs(pickLimit(limits, 'seven_day'), v.now, cells)
  if (rows < 2) return row(ui, [...contextSegs(v, 10), SEP, ...costSegs(v), ...five, ...placeSegs(v.probe, v.now)], width)
  // The branch lives on the fourth row: a shorter band shows it on the second.
  const git = rows < 4 && v.probe?.branch ? [SEP, ...gitSegs(v.probe)] : []
  const all = [
    [tag('CTX'), ...contextSegs(v, width >= 120 ? 28 : 12).slice(1)],
    [tag('COÛT'), ...costDetailSegs(v), ...five, ...seven, ...git],
    [tag('QUOI'), ...categorySegs(v)],
    [tag('TRAV.'), ...workSegs(v)],
    [tag('MÉMO'), ...memorySegs(v)],
  ]
  return <Box flexDirection="column">{all.slice(0, Math.max(2, rows)).map(segs => row(ui, segs, width))}</Box>
}
