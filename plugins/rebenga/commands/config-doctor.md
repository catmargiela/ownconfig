---
description: Checks that ~/.claude still matches the config repository — links, registered hooks, settings.json, theme, plugin version, git state, dispatcher, Python engine.
disable-model-invocation: true
---

Reply to the user in French.

Claude Code configuration diagnosis. Read-only: fix nothing unless the user
asks.

## 1. Diagnose

Run exactly:

```bash
node ~/.claude/bin/config-doctor.js
```

If the file is missing, the link itself is missing: say so and suggest
`node ~/.claude-config/install.js`, then stop.

## 2. Present the result

Copy the lines verbatim into a code block, then, for each `FAIL` and each
`WARN`, one line: the cause and the command that fixes it.

| Check | Fix |
|---|---|
| Links, registered hooks | `node ~/.claude-config/install.js` (idempotent, backs up settings.json) |
| Unreadable settings.json | restore the latest copy from `~/.claude/backups/settings.json.ccx-*` |
| Theme | `/theme`, or recreate the file with the `theme-edit` skill |
| rebenga plugin | `claude plugin marketplace update ownconfig && claude plugin update rebenga@ownconfig` |
| Repository | `git -C ~/.claude-config status`, then pull or commit as appropriate |
| Dispatcher | `CCX_DEBUG=1` then re-run the command to see the module at fault |
| token-saver engine | install Python ≥ 3.10 (Homebrew) or set `CCX_PYTHON`; without it, compression stays in Node |

Run no fix without consent. Everything `OK`: say so in one line.
