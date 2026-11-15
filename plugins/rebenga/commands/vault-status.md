---
description: Shows what the Obsidian vault holds for the current project — the page used, how much of it is injected at session start, and what is wrong in the vault.
disable-model-invocation: true
---

Reply to the user in French.

Read-only diagnosis of the long-term memory. Fix nothing unless the user asks.

## 1. Diagnose

Run exactly, from the current working directory:

```bash
node ~/.claude-config/vault-lint.js --project
node ~/.claude/bin/config-doctor.js | grep -E '^(OK|WARN|FAIL) +Vault'
```

If the first command says the vault is inactive, give the reason it printed and
stop.

## 2. Present the result

In plain words, problems first, no jargon:

1. **Which page is used** for this folder, and the folders it covers. No page:
   say why, and that notes go to the journal.
2. **How much Claude receives**: characters written against characters
   injected. If the page is cut, say that only its beginning is read.
3. **Whether the last session's results are injected.**
4. **The vault as a whole**, from the `Vault` line: pages without folder,
   duplicates, pages for folders that are not projects.

Then, only if something is wrong, one line per problem with its fix:

| Problem | Fix |
|---|---|
| A page without `chemin:` | add the key to its frontmatter with the folder(s) it covers |
| Two pages for one folder | merge the empty one into the written one, then delete it |
| A page for a folder that is not a project | delete it once the user has confirmed |
| A page cut at the budget | put what matters first, remove what is outdated |

For the details of every page: `node ~/.claude-config/vault-lint.js --verbose`.
To see the exact text injected: add `--show` to the first command, and show it
only if the user asks.

Deleting or merging a page changes the user's notes: list what would change and
wait for a yes.
