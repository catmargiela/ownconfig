'use strict';
/**
 * PreToolUse / Bash — bash-hygiene. Avertit, ne refuse JAMAIS.
 *
 * Quatre pièges qui ont chacun coûté un aller-retour, voire un faux « ça marche » :
 *   1. glob non cité sans correspondance — zsh échoue (« no matches found »)
 *      au lieu de passer le motif tel quel comme bash ;
 *   2. `ssh hôte "…'…'…"` — quotes imbriquées, réinterprétées côté distant ;
 *   3. `$?` ou `&&` après un pipe sans `pipefail` — on lit le statut de la
 *      dernière commande du pipe (`head`, `tail`), pas celui qui compte ;
 *   4. `sleep N` long — attendre une condition, pas une durée.
 *
 * Chaque avertissement ne sort qu'une fois par commande et par session.
 */
const fs = require('fs');
const path = require('path');
const { enabled, warn, readState, writeState } = require('./util');
const { stripQuoted, stripHeredocs } = require('./pre-bash');

/** Motif shell (`*` seul) → RegExp sur un nom de fichier. */
function globToRegExp(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + body + '$');
}

/**
 * Le motif correspond-il à au moins une entrée ? Seul le dernier segment peut
 * contenir `*` : sinon on ne sait pas trancher, et on se tait.
 */
function globMatches(token, cwd) {
  const dir = path.dirname(token);
  if (/[*?[]/.test(dir)) return true;
  const base = path.resolve(cwd || process.cwd(), dir);
  const re = globToRegExp(path.basename(token));
  // Comme zsh sans GLOB_DOTS : `*` ne capte pas les fichiers cachés.
  const hidden = !path.basename(token).startsWith('.');
  try {
    return fs.readdirSync(base).some((n) => re.test(n) && !(hidden && n.startsWith('.')));
  } catch {
    return false;
  }
}

/**
 * Globs non cités sans correspondance. Conservateur : seuls les mots portant
 * `*`, sans expansion ($, `, {, ~), sans échappement ni `**`.
 */
function unmatchedGlobs(cmd, cwd) {
  const stripped = stripQuoted(cmd);
  // Après un `cd` (ou `pushd`), le glob s'évalue dans un autre dossier que `cwd` :
  // impossible de savoir s'il correspond, donc on se tait plutôt que d'avertir à tort.
  if (/(^|[;&|(]\s*)(cd|pushd)\s/.test(stripped)) return [];
  const words = stripped.split(/[\s;&|()<>]+/).filter(Boolean);
  return words.filter((w) =>
    w.includes('*') && !/[$`{}~\\'"]/.test(w) && !w.includes('**')
    // `$((3*4))` découpé devient `3*4` : de l'arithmétique, pas un glob.
    && (w === '*' || !/^[\d*+\-/%]+$/.test(w))
    && !globMatches(w, cwd));
}

/** `ssh … "…'…"` ou `ssh … '…"…'`, hors corps de heredoc. */
function nestedSshQuotes(cmd) {
  const text = stripHeredocs(cmd);
  return /\bssh\b[^|;&\n]*?\s"[^"]*'[^"]*"/.test(text) || /\bssh\b[^|;&\n]*?\s'[^']*"[^']*'/.test(text);
}

/** Statut de sortie lu après un pipe, sans `pipefail` ni `PIPESTATUS`. */
function pipeStatus(cmd) {
  const raw = stripHeredocs(cmd);
  if (/pipefail|PIPESTATUS|pipestatus/.test(raw)) return false;
  const stripped = stripQuoted(cmd);
  const pipe = /(^|[^|])\|(?![|&])/;
  if (!pipe.test(stripped)) return false;
  // `$?` après le premier pipe (même dans une chaîne : `echo "rc=$?"`).
  const firstPipe = raw.search(/(^|[^|])\|(?![|&])/);
  if (firstPipe >= 0 && raw.slice(firstPipe).includes('$?')) return true;
  // `a | b && c` : c dépend du statut de b, pas de a.
  return stripped.split(/[;\n]/).some((seg) => {
    const p = seg.search(pipe);
    return p >= 0 && /&&|\|\|/.test(seg.slice(p + 2));
  });
}

/** Plus longue attente `sleep N` en secondes. */
function longestSleep(cmd) {
  const units = { s: 1, m: 60, h: 3600, d: 86400 };
  let max = 0;
  for (const m of stripQuoted(cmd).matchAll(/\bsleep\s+(\d+(?:\.\d+)?)([smhd]?)\b/g)) {
    max = Math.max(max, Number(m[1]) * (units[m[2]] || 1));
  }
  return max;
}

function findings(cmd, cwd) {
  const out = [];
  const globs = unmatchedGlobs(cmd, cwd);
  if (globs.length) {
    out.push({ id: 'glob', msg: `Glob non cité sans correspondance (${globs.slice(0, 3).join(', ')}) : zsh échoue avec « no matches found » au lieu de passer le motif. Le citer ('${globs[0]}') s'il est destiné à la commande (find -name, grep --include).` });
  }
  if (nestedSshQuotes(cmd)) {
    out.push({ id: 'ssh', msg: "Commande ssh avec quotes imbriquées : elle est réinterprétée par le shell distant. Plus sûr : `ssh hôte 'bash -s' <<'EOF'` … `EOF`, ou copier un script (scp) puis l'exécuter." });
  }
  if (pipeStatus(cmd)) {
    out.push({ id: 'pipe', msg: 'Statut de sortie lu après un pipe sans `set -o pipefail` : `$?` et `&&` reflètent la DERNIÈRE commande du pipe (head, tail, grep), pas celle en amont. Ajouter `set -o pipefail;` ou tester la commande seule.' });
  }
  const wait = longestSleep(cmd);
  if (wait >= 5) {
    out.push({ id: 'sleep', msg: `\`sleep\` de ${wait} s : attendre une durée fixe gaspille du temps ou échoue trop tôt. Préférer l'outil Monitor ou une boucle qui attend une condition (fichier présent, port ouvert, statut prêt).` });
  }
  return out;
}

function run(input) {
  const cmd = input?.tool_input?.command;
  if (!cmd || !enabled(['standard', 'strict'])) return;
  const found = findings(cmd, input.cwd);
  if (!found.length) return;

  const seen = readState(input.session_id, 'hygiene', {});
  const key = String(cmd).trim().slice(0, 200);
  const fresh = found.filter((f) => !seen[`${f.id}|${key}`]);
  if (!fresh.length) return;
  const next = { ...seen };
  for (const f of fresh) next[`${f.id}|${key}`] = 1;
  writeState(input.session_id, 'hygiene', next);
  warn(['[Hygiène Bash]', ...fresh.map((f) => '  - ' + f.msg)].join('\n'));
}

module.exports = { run, findings, unmatchedGlobs, nestedSshQuotes, pipeStatus, longestSleep, globToRegExp };
