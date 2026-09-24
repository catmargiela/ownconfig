---
description: Turns a behaviour to forbid into a tested hook check in the config repository — from a description or from analysing recent sessions.
disable-model-invocation: true
argument-hint: "[behaviour to forbid, or empty to analyse sessions]"
---

Reply to the user in French.

Hookify: `$ARGUMENTS`

An instruction repeated in the chat gets forgotten; a check in the dispatcher
does not. The goal is a tested hook module, never a rule hastily written into
the live config.

## 1. Find the rule

- **Argument given**: start from it. Ask for a concrete example of a faulty
  command or edit if there is none.
- **Empty argument**: run the `rebenga:conversation-analyzer` agent on the
  last 20 sessions. Show its ranked list, then ask **which rule to
  implement**. Only one per run.

## 2. Specify before writing

Present and get approval for:

| Field | Content |
|---|---|
| Event | `pre-bash`, `pre-edit`, `post-edit`, `stop`, `pre-compact` or `session-start` |
| Target | field read from the input: `tool_input.command`, `file_path`, written content |
| Trigger | exact condition, with 3 examples that must trigger and 3 that must not |
| Action | **deny** (exit 2, French message saying what to do instead) or **warning** (`util.warn()`, once per target and per session) |
| Profiles | `minimal` = hard denials only; `standard` by default; `strict` for zeal |
| False positives | where it may bite wrongly (quoted text, heredoc, comment) and how to avoid it |

When in doubt, warn rather than deny: a wrong denial blocks the work.

## 3. Implement in the config repository

In `~/.claude-config`, **on a branch** (`git switch -c feat/hook-<nom>`).
Installed hooks point to this repository: if the checkout is linked directly,
work in a `git worktree` so nothing changes in the current session.

1. Read `hooks/dispatch.js`, `hooks/lib/util.js` and a neighbouring module
   (`bash-hygiene.js` for a warning, `secret-guard.js` for a denial)
   in full. Reuse `stripQuoted` / `stripHeredocs` from `pre-bash.js`.
2. Create `hooks/lib/<nom>.js`: `run(input)` that returns early if
   `!enabled([...profils])`, the detection as an exported pure function, then
   `deny(message)` or `warn(message)`. No exception may propagate.
3. Add it to the `EVENTS` table in `dispatch.js`, in the right place: denials
   before warnings, without reordering existing modules.
4. Tests in `test.js`, new `group(...)`: positive cases, negative cases
   (including the identified false positives), one test per relevant profile
   and one with `CCX_DISABLED=1`, plus a real call via `hook(...)` that checks
   the exit code.
5. README: row in the `Hooks` table, profiles if needed, counters in the intro.

## 4. Prove

`node test.js` → the full output, zero `FAIL`. An existing test that turns
red is fixed in the new module, **never** by modifying or removing the
test nor by weakening an existing safeguard.

## 5. Stop there

Show the diff, the test output and the deny or warning message as it will be
displayed. Do not merge, do not re-run `install.js`, do not enable anything in
the live config without an explicit yes. No commit unless asked; if asked:
`feat(hooks): …`.
