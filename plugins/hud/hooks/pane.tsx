/** The pane: every figure of the band, with its detail. Pure: figures in, tree out. */
import { bold, dim, row, seg } from './draw'
import type { Actions, Ui, View } from './draw'
import {
  WARN_PERCENT,
  burn,
  clock,
  gauge,
  limitName,
  spark,
  span,
  tokens,
  tone,
  turnCosts,
  turnsLeft,
  until,
  usd,
} from './format'

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
  const costs = turnCosts(v.turns)
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
