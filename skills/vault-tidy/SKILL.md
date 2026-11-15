---
name: vault-tidy
description: Tidies the vault page of the current project — duplicates, contradicting notes, notes about files or branches that are gone, blocks taken over from an old page. Shows every change and waits for a yes. User-invoked with /vault-tidy.
disable-model-invocation: true
---

# Tidying a project page

Reply to the user in French.

The page is the user's notes. Nothing is removed, merged or moved before they
have seen it and said yes. Their text is never reworded: a note is kept as
written, moved as written, or removed.

## 1. Look

From the current working directory:

```bash
node ~/.claude/bin/vault-page.js
node ~/.claude-config/vault-lint.js --project
node ~/.claude-config/vault-lint.js --refs
```

The first prints the page (exit code 1: this folder has no page — say so and
stop). Read the whole page. The third lists files and branches the page quotes
that no longer exist on this machine: a lead, not a verdict. Before calling a
note outdated, check in the repository what replaced the missing thing; a path
may simply live in another repository or on a server.

## 2. Find

Only these four, each with the line numbers concerned:

1. **Duplicates** — the same fact noted twice. Keep the more complete one.
2. **Contradictions** — two notes that cannot both be true. The more recent
   one wins, when a date or the journal tells which; if nothing tells, ask.
3. **Outdated notes** — about something verified gone or replaced.
4. **Blocks "Repris de la page …"** — each note of the block moved, unchanged,
   to the section of the page where it belongs; the block heading then goes.

Leave everything else alone: style, order inside a section, long sections, a
note you merely find unimportant. Do not touch the frontmatter nor the
`<!-- claude:… -->` regions.

## 3. Show, then wait

Give the list grouped by the four kinds, numbered. For each change: what, where
(line), why, and the note itself quoted word for word — every note that would
be removed, merged or moved. A change whose text the user has not seen cannot
be accepted. Then the size of the page before and after. Nothing found: say the
page is clean and stop.

Only after that list, ask which changes to apply: all, some (by number), none.
Wait for the answer.

## 4. Apply

Only what was accepted, with `Edit`, one change at a time. Never `Write` the
whole page. Then run `node ~/.claude-config/vault-lint.js --project` again and
give the new size.

The vault is versioned: tell the user the previous version of the page can be
restored, and that the commands are in the README of `~/.claude-config`
(section "Historique").
