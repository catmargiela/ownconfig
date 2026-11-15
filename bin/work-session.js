#!/usr/bin/env node
'use strict';
/**
 * work-session — opens or closes a work session (skills `startsession` and
 * `endsession`).
 *
 *   node ~/.claude/bin/work-session.js start <session-id> [dir] [--json]
 *   node ~/.claude/bin/work-session.js end   <session-id> [dir] [--json] < closing-summary
 *
 * `start` prints what was done before on the project. `end` prints the hours,
 * the cost and the lines changed since the start, and writes them, with the
 * closing summary read from stdin, in today's journal.
 *
 * Exit codes: 0 done; 2 wrong usage or unusable session id.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(path.dirname(fs.realpathSync(__filename)), '..');
const ws = require(path.join(REPO, 'hooks', 'lib', 'vault', 'worksession.js'));
const { printable } = require(path.join(REPO, 'hooks', 'lib', 'vault', 'store.js'));

function stdinText() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const [action, sid, dir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!['start', 'end'].includes(action) || !ws.validSid(sid)) {
    process.stderr.write('Usage : work-session.js start|end <identifiant de session> [dossier]\n' +
      'L\'identifiant de session est absent ou invalide.\n');
    process.exit(2);
  }
  const cwd = path.resolve(dir || process.cwd());
  const result = action === 'start' ? ws.start(sid, cwd) : ws.end(sid, cwd, printable(stdinText(), true));
  if (flags.includes('--json')) process.stdout.write(JSON.stringify(result) + '\n');
  else process.stdout.write(printable(action === 'start' ? ws.describeStart(result) : ws.describeEnd(result), true) + '\n');
  if (action === 'end' && result.bilan.includes('[secret retiré]')) {
    process.stderr.write('Un secret a été retiré du bilan avant écriture.\n');
  }
}

if (require.main === module) main();
