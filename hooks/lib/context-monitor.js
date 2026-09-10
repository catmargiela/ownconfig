'use strict';
/**
 * Surveillance du contexte — le volet « économie de tokens ».
 *
 * Chaque tour renvoie tout le contexte au modèle : un contexte qui double coûte
 * deux fois plus cher à CHAQUE tour suivant. Sans compaction, le coût cumulé
 * d'une session croît en carré du nombre de tours.
 *
 * Mesure incrémentale : on ne relit jamais le transcript entier (certains
 * dépassent 100 Mo), seulement les octets ajoutés depuis le dernier passage.
 * Le coût de la surveillance reste proportionnel au travail réel.
 *
 * Au franchissement du seuil, le hook interrompt une fois la fin de réponse pour
 * demander une note de vault puis une proposition de compaction — sans le vault,
 * compacter perd de l'information ; avec lui, compacter ne perd que des tokens.
 */
const fs = require('fs');
const { readState, writeState } = require('./util');

const LIMIT = Number(process.env.CC_CONTEXT_LIMIT) || 200000;
const WARN_AT = Number(process.env.CC_CONTEXT_WARN) || 0.7;
const IMAGE_TOKENS = 1600; // ordre de grandeur d'une capture d'écran plein écran
const MAX_DELTA = 64 * 1024 * 1024; // garde-fou si le transcript explose d'un coup

/** Estimation grossière mais stable : ~4 caractères par token. */
function estimateBlock(b) {
  if (!b || typeof b !== 'object') return 0;
  if (b.type === 'image') return IMAGE_TOKENS;
  if (b.type === 'tool_result' && Array.isArray(b.content)) {
    return b.content.reduce((n, x) => n + estimateBlock(x), 0);
  }
  if (b.type === 'text' || b.type === 'thinking') return String(b.text || b.thinking || '').length / 4;
  return JSON.stringify(b).length / 4;
}

function estimateLine(line) {
  let d;
  try { d = JSON.parse(line); } catch { return { tokens: 0, images: 0, reset: false }; }
  // Une compaction remet le contexte à plat : on repart du résumé.
  const reset = Boolean(d.isCompactSummary) || String(d.subtype || '').includes('compact');
  const c = d?.message?.content;
  let tokens = 0, images = 0;
  if (typeof c === 'string') tokens = c.length / 4;
  else if (Array.isArray(c)) {
    for (const b of c) {
      tokens += estimateBlock(b);
      if (b?.type === 'image') images++;
      if (b?.type === 'tool_result' && Array.isArray(b.content)) {
        images += b.content.filter((x) => x?.type === 'image').length;
      }
    }
  }
  return { tokens, images, reset };
}

/** Lit uniquement les octets ajoutés depuis le dernier passage. */
function measure(transcriptPath, state) {
  let size;
  try { size = fs.statSync(transcriptPath).size; } catch { return null; }

  let offset = state.offset || 0;
  if (size < offset) { offset = 0; state.tokens = 0; state.images = 0; } // transcript remplacé
  if (size === offset) return state;

  const length = Math.min(size - offset, MAX_DELTA);
  const buf = Buffer.alloc(length);
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, length, offset);
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }

  let tokens = state.tokens || 0;
  let images = state.images || 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = estimateLine(line);
    if (r.reset) { tokens = 0; images = 0; state.warned = []; }
    tokens += r.tokens;
    images += r.images;
  }
  return { offset: offset + length, tokens: Math.round(tokens), images, warned: state.warned || [] };
}

function advice(pct, tokens, images) {
  const lines = [
    `[Contexte] ~${Math.round(tokens / 1000)}k tokens estimés, soit ~${Math.round(pct * 100)} % de la fenêtre.`,
    '',
  ];
  if (images >= 3) {
    lines.push(
      `${images} images sont présentes dans ce contexte (~${Math.round((images * IMAGE_TOKENS) / 1000)}k tokens).`,
      "Une capture d'écran reste en contexte jusqu'à la compaction et se repaie à chaque tour.",
      ''
    );
  }
  lines.push(
    'À faire maintenant, dans cet ordre :',
    '',
    "1. Écrire l'état de la session dans le vault Obsidian (skill `vault-note`) : décisions",
    '   prises, où en est le travail, ce qui reste. C\'est ce qui rend la compaction indolore.',
    "2. Proposer `/compact` à l'utilisateur, en une phrase, en disant ce qui a été noté.",
    '',
    "Ne pas compacter d'autorité : c'est sa décision. Ne pas répéter cet avertissement ensuite.",
  );
  return lines.join('\n');
}

function run(input) {
  if (process.env.CC_CONTEXT_MONITOR === 'off') return;
  const tp = input?.transcript_path;
  if (!tp) return;

  const prev = readState(input.session_id, 'context', { offset: 0, tokens: 0, images: 0, warned: [] });
  const next = measure(tp, prev);
  if (!next) return;
  writeState(input.session_id, 'context', next);

  const pct = next.tokens / LIMIT;
  if (pct < WARN_AT) return;

  // Un seul avertissement par palier : le bruit répété serait ignoré.
  const step = pct >= 0.85 ? 'haut' : 'seuil';
  if ((next.warned || []).includes(step)) return;
  next.warned = [...(next.warned || []), step];
  writeState(input.session_id, 'context', next);

  process.stderr.write(advice(pct, next.tokens, next.images) + '\n');
  process.exit(2);
}

module.exports = { run, measure, estimateLine, estimateBlock, LIMIT, WARN_AT };
