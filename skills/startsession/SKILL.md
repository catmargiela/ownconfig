---
name: startsession
description: Opens a work session on the current project — timestamps it, records the cost baseline, and reminds the user what was done before. User-invoked with /startsession.
disable-model-invocation: true
---

# Opening a work session

Reply to the user in French.

Run exactly, from the current working directory:

```bash
node ~/.claude/bin/work-session.js start ${CLAUDE_SESSION_ID}
```

Show the user what it printed, unchanged and in full: when the session opened,
what the previous session on this project did and cost, the last results of the
journal. Add nothing the script did not say, and do not start working: wait for
what the user wants to do.

If the previous session was not closed, say it in one line and move on; nothing
is lost, its journal was written anyway.

Exit code 2: the session id did not reach the script. Say so; do not guess one.
