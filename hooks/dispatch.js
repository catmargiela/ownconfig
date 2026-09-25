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
 *   node dispatch.js <pre-edit|pre-bash|post-edit|pre-compact|stop|session-start|prompt>
 */

const EVENTS = {
  // Refus sur le contenu d'abord : un secret ou une migration cassée se refuse
  // avant que le fact-forcing ne consomme son unique passage.
  'pre-edit': ['./lib/secret-guard', './lib/migration-guard', './lib/pre-edit'],
  // Refus d'abord (serveur au premier plan, commit non conforme). L'hygiène ne
  // fait qu'avertir. La compression passe en DERNIER : un refus (`deny`) termine
  // le process en sortie 2 avant elle, donc une commande refusée n'est jamais
  // réécrite.
  'pre-bash': ['./lib/secret-guard', './lib/pre-bash', './lib/dev-server-guard', './lib/commit-gate',
    './lib/bash-hygiene', './lib/loop-guard', './lib/compress'],
  'post-edit': ['./lib/post-edit'],
  // La capture vault passe AVANT les gates : ce qui doit être mémorisé l'est,
  // même si un gate interrompt ensuite la fin de réponse.
  'pre-compact': ['./lib/vault#onCompact', './lib/vault/history#onCompact'],
  // Un seul module interrompt par passage (sortie 2) : le typecheck d'abord, puis
  // les compagnons, puis le contexte. Les suivants reprennent au Stop d'après.
  // delivery-check (avertit) et la notification passent en DERNIER : ils ne
  // tournent que si aucun gate n'a renvoyé l'agent au travail.
  // L'historique du vault commite juste après la capture, avant tout gate.
  'stop': ['./lib/vault#onStop', './lib/vault/history#onStop', './lib/stop-quality', './lib/companion-check', './lib/context-monitor',
    './lib/delivery-check', './lib/turn-timer#onStop'],
  // Le bilan hebdo n'écrit rien sur stdout : seul vault#onStart est injecté.
  'session-start': ['./lib/vault/weekly#onStart', './lib/vault#onStart'],
  // Chaque message de l'utilisateur : alerte de quota (limites copiées par la status bar).
  'prompt': ['./lib/quota-alert', './lib/turn-timer#onPrompt'],
};

/** Nom Claude Code de l'événement, pour le canal d'avertissement JSON. */
const HOOK_NAMES = { 'pre-edit': 'PreToolUse', 'pre-bash': 'PreToolUse', 'post-edit': 'PostToolUse',
  prompt: 'UserPromptSubmit' };

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
  // Avertissements et réécriture d'entrée accumulés par les modules : une seule
  // sortie JSON, jamais de décision de permission.
  try {
    require('./lib/util').flushOutput(input.hook_event_name || HOOK_NAMES[event]);
  } catch (err) {
    if (process.env.CCX_DEBUG === '1') process.stderr.write(`[ccx:${event}] warnings: ${err.message}\n`);
  }
  process.exit(0);
});
// Aucun stdin (invocation manuelle) : ne pas rester bloqué.
process.stdin.on('error', () => process.exit(0));
