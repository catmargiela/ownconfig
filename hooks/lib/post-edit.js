'use strict';
/**
 * PostToolUse / Edit|Write|MultiEdit — accumulateur.
 *
 * On n'exécute NI formatage NI typecheck ici : le faire à chaque édition paie le
 * coût de démarrage du typechecker autant de fois qu'il y a de fichiers touchés.
 * On empile, et `stop-quality` traite le lot une seule fois en fin de réponse.
 *
 * Deux listes : `edited` est le lot de la réponse en cours (vidé par
 * `stop-quality`), `touched` couvre toute la session (lu par `companion-check`).
 */
const { readState, writeState } = require('./util');

const MAX_TRACKED = 200;
const MAX_SESSION = 500;

function push(sessionId, name, filePath, max) {
  const list = readState(sessionId, name, []);
  if (list.includes(filePath) || list.length >= max) return;
  writeState(sessionId, name, [...list, filePath]);
}

function run(input) {
  const filePath = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!filePath) return;
  push(input.session_id, 'edited', filePath, MAX_TRACKED);
  push(input.session_id, 'touched', filePath, MAX_SESSION);
}

module.exports = { run };
