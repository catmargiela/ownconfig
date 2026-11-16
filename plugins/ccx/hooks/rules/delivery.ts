/**
 * delivery-check, ported from ccx (hooks/lib/delivery-check.js). Phrases that
 * often close an answer whose claim was never proven ("pre-existing bug",
 * "skipping the tests"): a one-line warning to ask for the proof. Never
 * blocks; once per phrase and per session. Natively the answer is the Stop
 * event's own `last_assistant_message`, not the transcript's tail.
 */

type Phrase = { key: string; re: RegExp; label: string }

export const PHRASES: readonly Phrase[] = [
  // An excuse, not a description: "pre-existing bug", « bug préexistant » — never "pre-existing tests pass".
  { key: 'preexisting', re: /\bpre-?existing (bugs?|issues?|errors?|failures?|problems?)\b|\b(is|are|was|were) (a |an )?pre-?existing\b|\balready (broken|failing)\b|\b(bugs?|probl[èe]mes?|erreurs?|[ée]checs?|d[ée]fauts?) (d[ée]j[àa] )?pr[ée]-?existant(e|s|es)?\b|\b(est|[ée]tait|sont|[ée]taient) (d[ée]j[àa] )?pr[ée]-?existant|d[ée]j[àa] (cass[ée]|en [ée]chec|rouge)/i, label: 'problème « préexistant »' },
  { key: 'skip-tests', re: /\bskip(ping|ped)? (the |these |those )?tests?\b|\b(je )?(saute|ignore|d[ée]sactive|passe) (les |ces )?tests?\b|tests? (saut[ée]s?|ignor[ée]s?|d[ée]sactiv[ée]s?)\b/i, label: 'tests sautés' },
  { key: 'unrelated', re: /\b(unrelated to (my|this|the) change|out of scope)\b|sans rapport avec (mon|ce|le) changement|hors (du )?p[ée]rim[èe]tre|non li[ée]e? (à|au) (mon|ce)/i, label: '« sans rapport avec le changement »' },
  { key: 'should-work', re: /\b(should (now )?work|probably fixed)\b|(devrait|devraient) (maintenant )?(marcher|fonctionner|passer)|normalement (ça|c'est) (bon|corrig[ée])/i, label: '« devrait marcher » sans preuve' },
]

/** Phrases found in `text` and not yet reported (`seen` lists their keys). */
export function findPhrases(text: string, seen: readonly string[]): Phrase[] {
  return PHRASES.filter(p => !seen.includes(p.key) && p.re.test(text))
}

export function deliveryMsg(found: readonly Phrase[]): string {
  return `[Livraison] La réponse invoque : ${found.map(p => p.label).join(', ')}. Demander la preuve (commande lancée et sa sortie) avant de s'y fier.`
}
