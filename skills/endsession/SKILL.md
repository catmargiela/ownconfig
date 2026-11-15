---
name: endsession
description: Closes the work session — reports its hours, cost and lines changed, writes the closing summary in the journal and the durable notes in the project page. User-invoked with /endsession.
disable-model-invocation: true
---

# Closing a work session

Reply to the user in French.

## 1. Close it, with a closing summary

Write the summary yourself from this conversation, in French, eight lines at
most, facts only:

- **Fait** : what was actually done and verified.
- **Reste** : what is unfinished or not verified, and the next step.

Pass it on stdin, from the current working directory:

```bash
node ~/.claude/bin/work-session.js end ${CLAUDE_SESSION_ID} <<'BILAN'
Fait :
- …
Reste :
- …
BILAN
```

The script writes hours, cost, lines changed and this summary in today's
journal. Never put a secret, a token or a password in the summary.

Exit code 2: the session id did not reach the script. Say so and stop.

## 2. Write what is worth keeping — without asking

Follow the `vault-note` skill: get the page from
`node ~/.claude/bin/vault-page.js`, read it, and `Edit` the right section.

Write only what a later session needs and the code does not say: a decision
with its reason, a verified pitfall. Replace a note this session made obsolete
instead of adding a contradicting one. Nothing durable happened: write nothing,
and say so. A rule true on every project is not written: show the line you
would add to `~/.claude/CLAUDE.md` and wait for a yes.

If the script printed no page (exit code 1 of `vault-page.js`), the journal
summary is enough.

## 3. Tell the user

First the line the script printed (hours, cost, lines), unchanged. Then the
notes you wrote, one line each, with the page they went to — or "rien de durable
à noter". The vault is versioned: a note can be undone, so do not ask for
confirmation.
