'use strict';
/**
 * Découpage d'une commande Bash en commandes simples, pour les gardes pre-bash.
 *
 * La détection passe par `stripQuoted` (pre-bash) : le texte cité est une
 * donnée, jamais une commande. `git commit -m "next dev"` ne lance pas de
 * serveur, et `echo "git commit"` ne committe rien.
 *
 * Les valeurs citées (message de commit) sont lues à part par `shellWords`,
 * un découpage fidèle au shell sur le sous-ensemble courant.
 */
const { stripQuoted, stripHeredocs } = require('./pre-bash');

/** Préfixes qui ne changent pas la commande lancée. */
const WRAPPERS = new Set(['env', 'exec', 'command', 'builtin', 'nohup', 'time', 'sudo']);

/** Retire affectations `VAR=x`, préfixes neutres et redirections. */
function cleanWords(text) {
  const raw = text.trim().replace(/^[({\s]+/, '').replace(/[)}\s]+$/, '').split(/\s+/).filter(Boolean);
  const words = [];
  for (let i = 0; i < raw.length; i += 1) {
    const w = raw[i];
    if (/^\d*[<>]+$/.test(w)) { i += 1; continue; } // `> fichier` : cible ignorée
    if (/^\d*[<>]/.test(w)) continue; // `>fichier`, `2>/dev/null`
    words.push(w);
  }
  let start = 0;
  while (start < words.length) {
    const w = words[start];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w)) start += 1;
    else if (start > 0 && WRAPPERS.has(words[start - 1]) && w.startsWith('-')) start += 1;
    else break;
  }
  return words.slice(start);
}

/**
 * Commandes simples d'une ligne de commande : `{ words, background }`.
 * `background` vaut true pour un segment terminé par un `&` simple.
 */
function segments(cmd) {
  const text = stripQuoted(String(cmd || ''))
    .replace(/\d*>&\d*-?/g, ' ') // 2>&1, >&2 : pas un opérateur de contrôle
    .replace(/&>>?/g, ' > ')
    .replace(/\|&/g, '|');
  const parts = text.split(/(&&|\|\||[;\n|&])/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const words = cleanWords(parts[i]);
    if (words.length) out.push({ words, background: parts[i + 1] === '&' });
  }
  return out;
}

/**
 * Mots réels d'une commande (quotes résolues), opérateurs comme mots à part.
 * Un mot qui contient une substitution (`$(`, backquote) est marqué `dynamic`.
 * Quote non refermée : null (on ne devine pas).
 */
function shellWords(cmd) {
  const s = stripHeredocs(String(cmd || ''));
  const words = [];
  let cur = null;
  let dynamic = false;
  const push = () => { if (cur !== null) words.push({ value: cur, dynamic }); cur = null; dynamic = false; };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return null;
      cur = (cur || '') + s.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let val = '';
      for (; j < s.length && s[j] !== '"'; j += 1) {
        if (s[j] === '\\' && j + 1 < s.length) { j += 1; val += s[j]; continue; }
        val += s[j];
      }
      if (j >= s.length) return null;
      if (/\$[({]|`/.test(val)) dynamic = true;
      cur = (cur || '') + val;
      i = j + 1;
    } else if (/\s/.test(c) || /[;&|]/.test(c)) {
      push();
      if (/[;&|\n]/.test(c)) words.push({ value: c, op: true });
      i += 1;
    } else {
      if (c === '$' || c === '`') dynamic = true;
      if (c === '\\') { cur = (cur || '') + (s[i + 1] || ''); i += 2; continue; }
      cur = (cur || '') + c;
      i += 1;
    }
  }
  push();
  return words;
}

module.exports = { segments, cleanWords, shellWords, WRAPPERS };
