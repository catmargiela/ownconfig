---
name: vault-note
description: Write to the Obsidian vault — project context, a decision made, a working preference, state before compaction. Use when the user says "note ça" / "note this", "retiens ça" / "remember this", "mets ça dans mon vault" / "put this in my vault", before compacting, or when a structural decision has just been made.
---

# Writing to the vault

Reply to the user in French.

The Obsidian vault is long-term memory. A session's context disappears at
compaction; what is in the vault comes back in every following session.

Location: `~/Documents/Obsidian Vault/Claude/` (or `$CC_VAULT`).

```
Claude/
├── Index Claude.md
├── Profil/
│   ├── Façon de coder.md    ← injected in EVERY session, all projects
│   └── Stack.md
├── Projets/<Projet>.md      ← injected on this project only
└── Journal/<date> — <Projet>.md
```

## Coexistence rule

Blocks delimited by `<!-- claude:xxx:start -->` … `<!-- claude:xxx:end -->`
are managed by the hooks. **Everything else belongs to the user.**

To modify a page: read, edit the target section with `Edit`, never
rewrite the whole file with `Write`. An accidentally erased note cannot be
recovered.

## Where to write what

| Information | Destination |
|---|---|
| True across all projects (preference, convention, settled decision) | `Profil/Façon de coder.md` |
| True for this project only (architecture, pitfall, command) | `Projets/<Projet>.md` |
| True at a given moment (work state, what remains) | `Journal/<date> — <Projet>.md` |

The most frequent misfiling: putting in the profile what only concerns
one project. The profile is re-read in every session, on every project — it is paid for
everywhere. When in doubt, write in the project page.

## What is worth noting

- **A decision and its reason.** « On est passés à X parce que Y échouait sur Z. »
  The *why* is the only thing the code does not say.
- **A verified pitfall.** What wasted time, and how to work around it.
- **A preference expressed by the user.** When they correct a way of
  doing things, it is durable — noting it avoids having them correct it again.
- **The state of work in progress**, before compaction or at the end of a session.

## What is not worth noting

- What the code already says: file tree, dependency list, signatures.
- The details of a debugging session that ended well.
- A generality true for any project ("write tests"). It is already
  in the global `CLAUDE.md`.

A project page rarely exceeds 60 useful lines. Beyond that, it becomes
context paid for in every session for information no one ever re-reads.

## Writing

```bash
V="$HOME/Documents/Obsidian Vault/Claude"
```

Always read the page before touching it:

```bash
cat "$V/Projets/<Projet>.md"
```

Then `Edit` the relevant section. Link pages together with
`[[Nom de page]]` links — this is what builds the Obsidian graph and lets you
find a context by following links.

## Before a compaction

This is the most important moment: afterwards, the details no longer exist.

1. Write in today's journal: what was done, where the work stands, what
   remains, and any decision made during the session.
2. Move up into `Projets/<Projet>.md` what is durable (a decision, a
   pitfall) — the journal is dated, the project page is permanent.
3. Only then, suggest `/compact` to the user.

A compaction done after this writing loses only tokens. Done before,
it loses information.
