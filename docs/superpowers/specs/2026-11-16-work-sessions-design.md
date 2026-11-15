# Work sessions and vault history — design

Date: 2026-11-16 · Status: approved · Scope: lot 3 of 3 (first part)

## Intent

The owner wants to mark the start and the end of a working session himself:
`/startsession` opens it, timestamps it and reminds him what was done before on
the project; `/endsession` closes it, reports its cost and duration, and Claude
then writes by itself what is worth keeping, and says what it wrote. A session
is one Claude Code conversation.

Measured reason: the only reminder to write in the vault fires when the context
is nearly full, so short sessions never note anything (four real projects hold
ten recorded sessions and no decision). And since Claude now writes alone, a
page spoilt by a bad note must be recoverable.

## Approaches

- **A. Two user-invoked skills over one script (chosen).** The status line
  already receives the cost; it saves it per conversation. A script records
  start and end, computes the difference, writes the journal. Deterministic
  numbers, model only for the notes.
- **B. Hooks guess the session.** No command to type, but the end of a session
  cannot be known from a hook, which is why notes are missing today.
- **C. Parse the transcript for token usage.** Needs a price table that goes
  stale; the status line already has the real figure.

## Design

- `bin/statusline.sh` writes `state/ccx/<sid>.cost.json` (`cost`, `added`,
  `removed`) when it changes. Hooks and commands never receive the cost.
- `hooks/lib/vault/worksession.js` + `bin/work-session.js start|end <sid> [dir]`.
  - `start`: stores the baseline, appends to `state/ccx/worksessions.jsonl`,
    prints the previous session of the project (hours, cost, its closing
    summary, or "not closed" with its last known cost) and the last results of
    the journal.
  - `end`: cost and lines since the baseline, duration from the timestamps;
    writes a managed region `claude:worksession:<sid>` in today's journal with
    the closing summary read from stdin; appends to the ledger.
  - Without `/startsession`, `end` reports the whole conversation and says so.
- Skills `startsession` and `endsession` (`disable-model-invocation`), which
  pass `${CLAUDE_SESSION_ID}` to the script. At the end Claude writes the
  durable notes in the project page through `vault-note` rules, without asking,
  and lists them.
- `hooks/lib/vault/history.js` (taken from PR #13): a bare git repository
  outside the vault, one commit at Stop and before compaction when something
  changed. Local only. `CC_VAULT_HISTORY=off`. One `config-doctor` line.
- Not taken from PR #13: weekly digest, guard event log, `council` skill.

## Non-goals

A session spanning several conversations. A page maintenance command (later).

## Tests

Snapshot written by the status line; start/end difference when the session
opens mid-conversation; end without start; previous session closed and not
closed; journal region rewritten, not duplicated; unsafe session id refused;
history: commit only on change, nothing inside the vault, previous version
recoverable, off switch.
