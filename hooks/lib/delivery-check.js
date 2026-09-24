'use strict';
/**
 * Stop — rationalization check on the final answer (warning only).
 *
 * "Pre-existing bug", "skipping the tests for now", "unrelated to my change":
 * phrases that often close an answer whose claim was never proven. When the
 * last assistant message contains one, the user gets a one-line warning to ask
 * for the proof. Never blocks; once per phrase and per session.
 *
 * The answer is read from the tail of the transcript (last 256 KB), never the
 * whole file; an answer longer than that is cut, fails to parse and is skipped
 * (the check then looks at the previous one — a missed warning, never a crash).
 * Off in `minimal`, with CCX_DISABLED=1 or CCX_DELIVERY_CHECK=off.
 */
const fs = require('fs');
const { enabled, readState, writeState, warn } = require('./util');

const TAIL = 256 * 1024;
const PHRASES = [
  // An excuse, not a description: "pre-existing bug", "the failure is pre-existing",
  // « bug préexistant », « c'était déjà cassé » — never "pre-existing tests pass".
  { key: 'preexisting', re: /\bpre-?existing (bugs?|issues?|errors?|failures?|problems?)\b|\b(is|are|was|were) (a |an )?pre-?existing\b|\balready (broken|failing)\b|\b(bugs?|probl[èe]mes?|erreurs?|[ée]checs?|d[ée]fauts?) (d[ée]j[àa] )?pr[ée]-?existant(e|s|es)?\b|\b(est|[ée]tait|sont|[ée]taient) (d[ée]j[àa] )?pr[ée]-?existant|d[ée]j[àa] (cass[ée]|en [ée]chec|rouge)/i, label: 'problème « préexistant »' },
  { key: 'skip-tests', re: /\bskip(ping|ped)? (the |these |those )?tests?\b|\b(je )?(saute|ignore|d[ée]sactive|passe) (les |ces )?tests?\b|tests? (saut[ée]s?|ignor[ée]s?|d[ée]sactiv[ée]s?)\b/i, label: 'tests sautés' },
  { key: 'unrelated', re: /\b(unrelated to (my|this|the) change|out of scope)\b|sans rapport avec (mon|ce|le) changement|hors (du )?p[ée]rim[èe]tre|non li[ée]e? (à|au) (mon|ce)/i, label: '« sans rapport avec le changement »' },
  { key: 'should-work', re: /\b(should (now )?work|probably fixed)\b|(devrait|devraient) (maintenant )?(marcher|fonctionner|passer)|normalement (ça|c'est) (bon|corrig[ée])/i, label: '« devrait marcher » sans preuve' },
];

function lastAssistantText(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      const msg = d && d.message;
      if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const text = msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
      if (text.trim()) return text;
    }
  } catch { /* unreadable: nothing to check */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  return '';
}

/** Phrases found in `text` and not yet reported (`seen` maps key → 1). */
function findPhrases(text, seen = {}) {
  return PHRASES.filter((p) => !seen[p.key] && p.re.test(text));
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  if (String(process.env.CCX_DELIVERY_CHECK || '').trim().toLowerCase() === 'off') return;
  const sid = input && input.session_id;
  const text = lastAssistantText(input && input.transcript_path);
  if (!text) return;
  const seen = readState(sid, 'delivery', {});
  const found = findPhrases(text, seen);
  if (!found.length) return;
  writeState(sid, 'delivery', { ...seen, ...Object.fromEntries(found.map((p) => [p.key, 1])) });
  warn(`[Livraison] La réponse invoque : ${found.map((p) => p.label).join(', ')}. Demander la preuve (commande lancée et sa sortie) avant de s'y fier.`);
}

module.exports = { run, findPhrases, lastAssistantText, PHRASES };
