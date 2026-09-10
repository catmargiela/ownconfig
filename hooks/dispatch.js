#!/usr/bin/env node
'use strict';
/**
 * Point d'entrée unique des hooks.
 *
 * Un seul process Node par événement, qui exécute en interne tous les modules
 * concernés — au lieu d'un process par hook enregistré. C'est ce qui rend la
 * chaîne tenable quand le nombre de contrôles augmente.
 *
 * Contrat : un hook ne casse JAMAIS un appel d'outil. Toute erreur inattendue
 * se termine en sortie 0 (autorisé). Seul un refus délibéré sort en 2.
 *
 *   node dispatch.js <pre-edit|pre-bash|post-edit|stop|session-start>
 */

const EVENTS = {
  'pre-edit': ['./lib/pre-edit'],
  'pre-bash': ['./lib/pre-bash'],
  'post-edit': ['./lib/post-edit'],
  'stop': ['./lib/memory#onStop', './lib/stop-quality'],
  'session-start': ['./lib/memory#onStart'],
};

const event = process.argv[2];
const modules = EVENTS[event];
if (!modules) process.exit(0);

const MAX_STDIN = 2 * 1024 * 1024;
let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (raw.length < MAX_STDIN) raw += chunk.slice(0, MAX_STDIN - raw.length);
});
process.stdin.on('end', () => {
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { /* entrée illisible : on continue */ }

  for (const spec of modules) {
    const [id, fn = 'run'] = spec.split('#');
    try {
      const mod = require(id);
      if (typeof mod[fn] === 'function') mod[fn](input);
    } catch (err) {
      // Un module cassé dégrade un contrôle, il ne bloque pas le travail.
      if (process.env.CCX_DEBUG === '1') process.stderr.write(`[ccx:${event}] ${spec}: ${err.message}\n`);
    }
  }
  process.exit(0);
});
// Aucun stdin (invocation manuelle) : ne pas rester bloqué.
process.stdin.on('error', () => process.exit(0));
