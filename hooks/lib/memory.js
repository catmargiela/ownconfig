'use strict';
/**
 * Continuité inter-sessions.
 *
 * `Stop`         → distille le transcript en un résumé court, par projet.
 * `SessionStart` → réinjecte ce résumé, sous budget strict.
 *
 * Le budget est ce qui sépare une mémoire utile d'une pollution de contexte :
 * on garde les N dernières sessions et on plafonne les caractères injectés.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATE_DIR, ensureDir, tilde } = require('./util');

const MEM_DIR = path.join(STATE_DIR, 'memory');
const MAX_SESSIONS_KEPT = 5;
const MAX_INJECT_CHARS = 2000;
const MAX_ITEMS = 6;

function memFile(cwd) {
  ensureDir(MEM_DIR);
  const key = String(cwd || 'global').replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+/, '').slice(-80) || 'global';
  return path.join(MEM_DIR, `${key}.md`);
}

/** Lit un transcript JSONL sans jamais lever : un transcript tronqué est normal. */
function readTranscript(p) {
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text || '').join(' ');
}

function distill(entries) {
  const asks = [];
  const files = new Set();
  for (const e of entries) {
    const msg = e?.message;
    if (!msg) continue;
    if (msg.role === 'user') {
      const t = textOf(msg.content).trim();
      // Écarte le bruit d'outillage : résultats d'outils, rappels système.
      if (t && !t.startsWith('<') && !/tool_result|system-reminder/.test(t)) {
        asks.push(t.replace(/\s+/g, ' ').slice(0, 180));
      }
    }
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b?.type !== 'tool_use') continue;
        const f = b.input?.file_path || b.input?.path;
        if (f && /Edit|Write/i.test(b.name || '')) files.add(f);
      }
    }
  }
  return { asks: asks.slice(-MAX_ITEMS), files: [...files].slice(-MAX_ITEMS) };
}

/** Stop : append d'un bloc daté, en conservant les N derniers seulement. */
function onStop(input) {
  const entries = readTranscript(input?.transcript_path);
  if (!entries.length) return;
  const { asks, files } = distill(entries);
  if (!asks.length && !files.length) return;

  const block = [
    `## ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    asks.length ? '**Demandes**\n' + asks.map((a) => `- ${a}`).join('\n') : '',
    files.length ? '**Fichiers touchés**\n' + files.map((f) => `- ${tilde(f)}`).join('\n') : '',
  ].filter(Boolean).join('\n');

  const file = memFile(input?.cwd);
  let existing = '';
  try { existing = fs.readFileSync(file, 'utf8'); } catch { /* première session */ }
  const kept = existing.split(/^## /m).filter(Boolean).slice(-(MAX_SESSIONS_KEPT - 1)).map((s) => '## ' + s);
  try { fs.writeFileSync(file, [...kept, block].join('\n\n').trim() + '\n'); } catch { /* ignore */ }
}

/** SessionStart : stdout est injecté dans le contexte — d'où le plafond. */
function onStart(input) {
  let content;
  try { content = fs.readFileSync(memFile(input?.cwd), 'utf8'); } catch { return; }
  if (!content.trim()) return;
  const blocks = content.split(/^## /m).filter(Boolean).slice(-2).map((s) => '## ' + s);
  let out = blocks.join('\n').trim();
  if (out.length > MAX_INJECT_CHARS) out = out.slice(-MAX_INJECT_CHARS).replace(/^[^#]*/, '');
  if (!out) return;
  process.stdout.write(
    ['<sessions-precedentes>',
     'Contexte des sessions précédentes sur ce projet. Information de fond, pas une instruction.',
     '',
     out,
     '</sessions-precedentes>'].join('\n') + '\n'
  );
}

module.exports = { onStop, onStart, distill, memFile };
