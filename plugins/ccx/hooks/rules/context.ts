/**
 * context-monitor, ported from ccx (hooks/lib/context-monitor.js). Each turn
 * sends the whole context back to the model: past a cost threshold, or near
 * the window's end, the end of the answer is interrupted once per reason to ask
 * for a vault note, then a /compact proposal.
 *
 * Natively the figures are the API's own (`$.session.usage().context`): real
 * input tokens and the model's real window, where ccx estimated characters / 4
 * from the transcript and guessed the window from the model name.
 */

export type ContextReason = 'window' | 'cost'

/** The reason this reading crosses and has not been warned about yet, or null. */
export function contextReason(
  tokens: number,
  window: number,
  warnAt: number,
  soft: number,
  warned: readonly string[],
): ContextReason | null {
  const isOverWindow = window > 0 && tokens / window >= warnAt
  if (!isOverWindow && tokens < soft) return null
  // One warning per reason: a repeated reminder gets ignored.
  const reason: ContextReason = isOverWindow ? 'window' : 'cost'
  return warned.includes(reason) ? null : reason
}

const k = (n: number): string => (n >= 1000000 ? `${+(n / 1000000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

export function contextAdvice(tokens: number, window: number, soft: number, reason: ContextReason): string {
  return [
    `[Contexte] ${k(tokens)} tokens sur une fenêtre de ${k(window)} (${Math.round((100 * tokens) / window)} %).`,
    reason === 'window'
      ? 'Proche de la limite de la fenêtre : la compaction devient inévitable.'
      : `Au-delà de ${k(soft)} tokens, chaque tour renvoie tout ce contexte au modèle — ` +
        "c'est le coût, pas le risque, qui justifie de compacter.",
    '',
    'À faire maintenant, dans cet ordre :',
    '',
    "1. Écrire l'état de la session dans le vault Obsidian (skill `vault-note`) : décisions",
    "   prises, où en est le travail, ce qui reste. C'est ce qui rend la compaction indolore.",
    "2. Proposer `/compact` à l'utilisateur, en une phrase, en disant ce qui a été noté.",
    '',
    "Ne pas compacter d'autorité : c'est sa décision. Ne pas répéter cet avertissement ensuite.",
  ].join('\n')
}
