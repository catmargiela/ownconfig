---
name: vault-note
description: Write to the Obsidian vault — a decision made on a project, a verified pitfall, the state of the work before compaction. Use when the user says "note ça" / "note this", "retiens ça" / "remember this", "mets ça dans mon vault" / "put this in my vault", before compacting, or when a structural decision has just been made.
---

# Writing to the vault

Reply to the user in French.

The Obsidian vault is the long-term memory of each project. A session's context
disappears at compaction; what is in the project's page comes back at the start
of every following session on that project.

## 1. Ask where the note goes — never choose a page yourself

```bash
node ~/.claude/bin/vault-page.js
```

It prints the page covering the current folder and creates it when the project
has none yet. Write in that file and nowhere else.

- **Never pick or invent a page name**, even when a nicer one comes to mind, and
  never create a file in `Projets/` by hand. A page the script did not return is
  not linked to the project's folder: it is never injected, and the note is lost
  while looking saved.
- A page may cover several repositories: its frontmatter key `chemin:` lists
  them. To attach one more folder to an existing page, add it to that list.
- **Exit code 1**: the folder cannot have a page (home directory, Claude Code's
  own folder, a session scratchpad). The script prints the path of today's
  journal instead: write the note there, and tell the user it went to the
  journal and why.
- **Exit code 2**: the vault is inactive. Say so and stop; write nothing.

## 2. Which memory for which knowledge

| Knowledge | Where |
|---|---|
| A decision, a pitfall, a command of **this project** | the page returned by the script |
| The state of the work at a given moment | today's journal, `Journal/<date> — <page name>.md` |
| A rule or preference true on **every** project | `~/.claude/CLAUDE.md` — see below |

A preference true everywhere is not yours to write. Show the user the exact line
you would add to `~/.claude/CLAUDE.md`, and add it only after a clear yes. That
file is their instructions to every session and it is versioned in a public
repository.

## 3. Coexistence rule

Blocks delimited by `<!-- claude:xxx:start -->` … `<!-- claude:xxx:end -->` are
managed by the hooks. **Everything else belongs to the user.**

Read the page, then edit the target section with `Edit`. Never rewrite a whole
page with `Write`: an erased note cannot be recovered.

## What is worth noting

- **A decision and its reason.** « On est passés à X parce que Y échouait sur Z. »
  The *why* is the only thing the code does not say.
- **A verified pitfall.** What wasted time, and how to work around it.
- **The state of work in progress**, before compaction or at the end of a session.

## What is not worth noting

- What the code already says: file tree, dependency list, signatures.
- The details of a debugging session that ended well.
- A generality true for any project ("write tests").

A page longer than the budget is injected as a summary at session start: each
`##` section with its title and first lines
(`node ~/.claude-config/vault-lint.js --project --show` shows it). So give every
section a title that says what it holds, put what matters most first in it, and
replace an outdated note instead of adding a second one that contradicts it.
When the injected context is a summary, read the relevant section of the page
before working on that subject.

## Before a compaction

This is the most important moment: afterwards, the details no longer exist.

1. Write in today's journal: what was done, where the work stands, what remains,
   and any decision made during the session.
2. Move up into the project page what is durable (a decision, a pitfall) — the
   journal is dated, the project page is permanent.
3. Only then, suggest `/compact` to the user.

A compaction done after this writing loses only tokens. Done before, it loses
information.

A structural decision that belongs to a client project repo also deserves an ADR
in that repo: propose `docs/adr/NNNN-slug.md` from
`~/.claude-config/rules/templates/adr.md`, and ask before writing into the
client repo.
