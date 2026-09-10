'use strict';
/**
 * PostToolUse / Edit|Write|MultiEdit — accumulateur.
 *
 * On n'exécute NI formatage NI typecheck ici : le faire à chaque édition paie le
 * coût de démarrage du typechecker autant de fois qu'il y a de fichiers touchés.
 * On empile, et `stop-quality` traite le lot une seule fois en fin de réponse.
 */
const { readState, writeState } = require('./util');

const MAX_TRACKED = 200;

function run(input) {
  const filePath = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!filePath) return;
  const list = readState(input.session_id, 'edited', []);
  if (list.includes(filePath) || list.length >= MAX_TRACKED) return;
  list.push(filePath);
  writeState(input.session_id, 'edited', list);
}

module.exports = { run };
