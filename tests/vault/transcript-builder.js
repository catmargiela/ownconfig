'use strict';
/**
 * Synthetic Claude Code transcripts (JSONL) for the vault tests. Shapes follow
 * the real format: one entry per line, `message.role`, content blocks,
 * `tool_use` / `tool_result` pairs, `timestamp`, `gitBranch`, `isMeta`.
 */
const fs = require('fs');
const path = require('path');

const BASE = Date.parse('2026-01-15T09:30:00Z');

const user = (content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const text = (t) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
const toolUse = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError = false) => user([{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]);

const edit = (id, file) => [toolUse(id, 'Edit', { file_path: file, old_string: 'a', new_string: 'b' }), toolResult(id, 'The file has been updated.')];
const bash = (id, command, output, isError = false) => [toolUse(id, 'Bash', { command }), toolResult(id, output, isError)];
const fail = (id, output) => bash(id, 'npm run lint', output, true);

/** Flattens entries and stamps them with increasing timestamps, branch and session. */
function session(entries, { branch = 'main', sessionId = 'synthetic', start = BASE } = {}) {
  return entries.flat().map((e, i) => ({
    parentUuid: null, isSidechain: false, sessionId, gitBranch: branch,
    timestamp: new Date(start + i * 60000).toISOString(), ...e,
  }));
}

const FINAL = [
  'Refonte de la capture terminée.',
  '',
  '## Bilan',
  '',
  '| Étape | État |',
  '|---|---|',
  '| Filtrage | fait |',
  '| Rendu | fait |',
  '',
  '```bash',
  'node test.js',
  '```',
  '',
  'result: capture refaite, 42 tests verts',
].join('\n');

/** A realistic session: prompts, slash command, agent hand-back, commit, PR, guard refusal. */
function fullSession(projectDir) {
  return session([
    user('refais la capture du journal, les blocs sont illisibles'),
    user('<command-message>plan</command-message>\n<command-name>/plan</command-name>\n<command-args>découper vault.js en modules</command-args>'),
    user('# Plan\n\n## Steps\n\nExpanded command body injected by the harness.', { isMeta: true }),
    user('<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'),
    user('Another Claude session sent a message: worker finished, see report'),
    user([{ type: 'text', text: '<agent-message from="worker">Hand-back: 3 files changed</agent-message>' }]),
    text('Je commence par lire les fichiers.'),
    edit('t1', path.join(projectDir, 'src', 'a.js')),
    edit('t1b', '/tmp/scratch-notes.md'),
    fail('t2', 'PreToolUse:Bash hook error: [Fact-Forcing Gate] cite la demande avant ce Bash'),
    fail('t3', 'Exit code 1\nError: Cannot find module ./missing'),
    bash('t4', 'git add hooks && git commit -m "feat: capture per session"',
      '[feat/journal abc1234def] feat: capture per session\n 3 files changed, 120 insertions(+)'),
    bash('t5', 'gh pr create --fill', 'https://github.com/octo-org/demo-project/pull/42\n'),
    bash('t6', 'git log --oneline -3', 'abc1234 feat: capture per session\n'),
    text(FINAL),
  ], { branch: 'feat/journal' });
}

const writeJsonl = (file, entries) => fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

function appendJsonl(file, entries, opts = {}) {
  const stamped = session(entries, { start: Date.now(), ...opts });
  fs.appendFileSync(file, stamped.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/** Transcript of about `bytes`: reads, edits, long answers, a few screenshots. */
function writeLarge(file, bytes, projectDir) {
  const fd = fs.openSync(file, 'w');
  let size = 0, i = 0;
  const chunk = 'lorem ipsum dolor sit amet '.repeat(150);
  while (size < bytes) {
    const turn = [
      user(`demande numéro ${i} sur le module ${i % 7}`),
      toolUse(`r${i}`, 'Read', { file_path: path.join(projectDir, 'src', `f${i % 50}.js`) }),
      toolResult(`r${i}`, chunk),
      ...edit(`e${i}`, path.join(projectDir, 'src', `f${i % 50}.js`)),
      text(`Réponse ${i}.\n\n- point\n- autre point\n\n${chunk.slice(0, 1500)}`),
    ];
    if (i % 40 === 0) turn.push(user([{ type: 'image', source: { type: 'base64', data: 'A'.repeat(200000) } }]));
    const lines = session(turn, { start: BASE + i * 600000 }).map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeSync(fd, lines);
    size += Buffer.byteLength(lines);
    i++;
  }
  fs.closeSync(fd);
}

module.exports = { user, text, toolUse, toolResult, edit, bash, fail, session, fullSession, writeJsonl, appendJsonl, writeLarge, FINAL };
