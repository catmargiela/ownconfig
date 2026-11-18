/** The two drawings: the band above the prompt and the pane. Pure: figures in, tree out. */
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

type Seg = { t: string; color?: Color; isDim?: boolean; isBold?: boolean }

const seg = (t: string, color?: Color, more: { isDim?: boolean; isBold?: boolean } = {}): Seg =>
  color === undefined ? { t, ...more } : { t, color, ...more }
const dim = (t: string): Seg => ({ t, isDim: true })
const bold = (t: string, color?: Color): Seg => seg(t, color, { isBold: true })
const SEP = dim(' │ ')

/** One row, cut at `width` so the band never wraps. */
function row(ui: Ui, segs: readonly Seg[], width: number) {
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
  const costs = turnCosts(v.turns, 0)
  const last = v.turns.length > 1 ? costs[costs.length - 1] : undefined
  const rate = burn(u.usd, u.startedAt, v.now)
  return [
    bold(usd(u.usd)),
    ...(last === undefined ? [] : [dim(` +${last.toFixed(2)}`)]),
    ...(rate === null ? [] : [dim(` · ${usd(rate)}/h`)]),
  ]
}

function placeSegs(p: Probe | null, now: number): Seg[] {
  if (!p) return []
  const out: Seg[] = []
  if (p.branch) {
    out.push(SEP, seg(`⎇ ${p.branch}`, 'suggestion'))
    if (p.dirty > 0) out.push(seg(` ●${p.dirty}`, 'warning'))
  }
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
  const costs = turnCosts(v.turns, 0).slice(1)
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
  const out: Seg[] = []
  if (p?.branch) {
    out.push(seg(`⎇ ${p.branch}`, 'suggestion'))
    if (p.dirty > 0) out.push(seg(` ●${p.dirty}`, 'warning'))
    out.push(SEP)
  }
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
  if (rows < 2) return row(ui, [...contextSegs(v, 10), SEP, ...costSegs(v), ...five], width)
  const all = [
    [tag('CTX'), ...contextSegs(v, width >= 120 ? 28 : 12).slice(1)],
    [tag('COÛT'), ...costDetailSegs(v), ...five, ...seven],
    [tag('QUOI'), ...categorySegs(v)],
    [tag('TRAV.'), ...workSegs(v)],
    [tag('MÉMO'), ...memorySegs(v)],
  ]
  return <Box flexDirection="column">{all.slice(0, Math.max(2, rows)).map(segs => row(ui, segs, width))}</Box>
}

function title(ui: Ui, text: string, width: number) {
  return row(ui, [bold(`── ${text} `, 'claude'), seg('─'.repeat(Math.max(0, width - text.length - 4)), 'claude', { isDim: true })], width)
}

function contextRows(ui: Ui, v: View, width: number) {
  const u = v.usage
  const percent = u?.percent ?? null
  const color = tone(percent)
  const left = turnsLeft(v.turns, percent)
  const used = [...v.categories].sort((a, b) => b.tokens - a.tokens).slice(0, 7)
  const top = used[0]?.tokens ?? 0
  const barRoom = Math.max(4, width - 30)
  return [
    title(ui, 'CONTEXTE', width),
    row(ui, [seg(`${gauge(percent, Math.max(8, width - 7))} `, color), bold(percent === null ? '—' : `${Math.round(percent)} %`, color)], width),
    row(
      ui,
      u && u.tokens !== null
        ? [seg(`${tokens(u.tokens)} sur ${tokens(u.window)} tokens`), dim(` · reste ${tokens(Math.max(0, u.window - u.tokens))}`)]
        : [dim('Pas encore de mesure : elle arrive avec la première réponse.')],
      width,
    ),
    ...(v.turns.length > 1
      ? [row(ui, [dim('Par tour  '), seg(spark(v.turns.slice(-Math.max(8, width - 12)).map(t => t.percent), 100), color)], width)]
      : []),
    row(
      ui,
      [dim(left === null ? `Alerte à ${WARN_PERCENT} % : écrire dans le vault, puis /compact.` : `À ce rythme, ${WARN_PERCENT} % dans environ ${left} tours.`)],
      width,
    ),
    ...used.map(c =>
      row(
        ui,
        [
          seg(c.name.slice(0, 18).padEnd(19)),
          seg('█'.repeat(top > 0 ? Math.max(1, Math.round((c.tokens / top) * barRoom)) : 0), 'suggestion'),
          dim(` ${tokens(c.tokens)}`),
        ],
        width,
      ),
    ),
  ]
}

function costRows(ui: Ui, v: View, width: number) {
  const u = v.usage
  const costs = turnCosts(v.turns, 0).slice(1)
  const last = v.turns[v.turns.length - 1]
  const lastCost = costs[costs.length - 1]
  const rate = u ? burn(u.usd, u.startedAt, v.now) : null
  const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null
  return [
    title(ui, 'COÛT', width),
    row(
      ui,
      u && u.usd !== null
        ? [
            bold(usd(u.usd)),
            dim(` depuis ${span(v.now - u.startedAt)}`),
            ...(rate === null ? [] : [dim(` · ${usd(rate)}/h`)]),
            ...(mean === null ? [] : [dim(` · ${usd(mean)} par tour`)]),
          ]
        : [dim('Coût inconnu.')],
      width,
    ),
    ...(costs.length > 1 ? [row(ui, [dim('Par tour  '), seg(spark(costs.slice(-Math.max(8, width - 12))), 'warning')], width)] : []),
    ...(last && lastCost !== undefined
      ? [row(ui, [dim(`Dernier tour : ${usd(lastCost)}, ${span(last.seconds * 1000)}, ${last.tools} outil(s)`)], width)]
      : []),
  ]
}

function limitRows(ui: Ui, v: View, width: number) {
  const limits = v.usage?.limits ?? []
  if (!limits.length) return []
  return [
    title(ui, 'LIMITES', width),
    ...limits.map(l => {
      const left = until(l.resetsAt, v.now)
      return row(
        ui,
        [
          seg(limitName(l.kind).padEnd(5)),
          seg(`${gauge(l.percent, Math.max(6, Math.min(24, width - 34)))} `, tone(l.percent)),
          bold(`${Math.round(l.percent)} %`, tone(l.percent)),
          ...(left ? [dim(`  remise à zéro dans ${left}`)] : []),
        ],
        width,
      )
    }),
  ]
}

function workRows(ui: Ui, v: View, width: number, actions: Actions) {
  const { Box, Button } = ui
  const w = v.probe?.work ?? null
  const started = w?.isOpen && w.startedAt ? Date.parse(w.startedAt) : NaN
  const spent = w && v.usage?.usd != null ? Math.max(0, v.usage.usd - w.baseUsd) : null
  const prev = w?.previous ?? null
  const bilan = prev?.bilan ? prev.bilan.split('\n').filter(l => l.trim()).slice(0, 8) : []
  return [
    title(ui, 'SESSION DE TRAVAIL', width),
    row(
      ui,
      w?.isOpen && Number.isFinite(started)
        ? [
            seg('● ', 'success'),
            seg(`Ouverte le ${clock(w.startedAt)} · ${span(v.now - started)}`),
            ...(spent === null ? [] : [bold(` · ${usd(spent)}`)]),
            seg(` · +${w.added}`, 'success'),
            seg(` −${w.removed}`, 'error'),
          ]
        : [dim('Aucune session ouverte dans cette conversation.')],
      width,
    ),
    <Box flexDirection="row">
      {w?.isOpen ? (
        <Button key="end" label="Terminer la session" variant="primary" onPress={() => actions.onWorkSession('/endsession')} />
      ) : (
        <Button key="start" label="Démarrer une session" variant="primary" onPress={() => actions.onWorkSession('/startsession')} />
      )}
    </Box>,
    ...(prev
      ? [
          row(
            ui,
            [
              dim('Précédente : '),
              seg(`${clock(prev.startedAt)}${prev.endedAt ? ` → ${clock(prev.endedAt)}` : ' (jamais fermée)'}`),
              ...(prev.usd === null ? [] : [bold(` · ${usd(prev.usd)}`)]),
            ],
            width,
          ),
          ...bilan.map(l => row(ui, [dim(`  ${l}`)], width)),
        ]
      : [row(ui, [dim('Pas de session précédente sur ce projet.')], width)]),
  ]
}

function memoryRows(ui: Ui, v: View, width: number) {
  const p = v.probe
  const m = p?.memory ?? null
  if (!m) return [title(ui, 'MÉMOIRE', width), row(ui, [dim(p?.memoryNote || 'Pas encore lue.')], width)]
  if (!m.hasPage) {
    return [
      title(ui, 'MÉMOIRE', width),
      row(ui, [seg('◇ ', 'warning'), seg(`Aucune page pour ce dossier${m.why ? ` : ${m.why}` : '.'}`)], width),
      row(ui, [dim('Les notes vont dans le journal du jour.')], width),
    ]
  }
  const how =
    m.mode === 'sommaire'
      ? `en sommaire : la page dépasse ${m.budget} caractères`
      : m.mode === 'entier'
        ? 'en entier'
        : 'vide : rien à injecter'
  return [
    title(ui, 'MÉMOIRE', width),
    row(ui, [seg('◆ ', 'claude'), bold(m.name), dim(` · injectée ${how}`)], width),
    row(ui, [dim(`${m.written} car. écrits, ${m.injected} injectés · environ ${tokens(m.startTokens)} tokens au démarrage`)], width),
    row(ui, [dim('Dernière session : '), seg(m.hasLastSession ? 'injectée' : 'aucune', m.hasLastSession ? 'success' : 'inactive')], width),
    ...m.sections.map(s => row(ui, [dim('  § '), seg(s)], width)),
    ...(m.staleRefs > 0
      ? [row(ui, [seg(`⚠ ${m.staleRefs} fichier(s) ou branche(s) cités qui n'existent plus — /vault-tidy`, 'warning')], width)]
      : []),
  ]
}

/** The pane: every figure of the band, with its detail. */
export function pane(ui: Ui, v: View, width: number, actions: Actions) {
  const { Box, Button } = ui
  const gap = row(ui, [seg(' ')], width)
  return (
    <Box flexDirection="column">
      {contextRows(ui, v, width)}
      {gap}
      {costRows(ui, v, width)}
      {limitRows(ui, v, width)}
      {gap}
      {workRows(ui, v, width, actions)}
      {gap}
      {memoryRows(ui, v, width)}
      {gap}
      <Box flexDirection="row" gap={1}>
        <Button key="refresh" label="Rafraîchir" hotkey="r" onPress={actions.onRefresh} />
        <Button key="band" label={actions.isBandHidden ? 'Afficher le bandeau' : 'Masquer le bandeau'} hotkey="b" onPress={actions.onToggleBand} />
      </Box>
      {row(ui, [dim(v.probe ? `Relevé il y a ${span(v.now - v.probe.at)}.` : '')], width)}
    </Box>
  )
}
