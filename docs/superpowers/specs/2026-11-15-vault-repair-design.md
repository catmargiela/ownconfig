# Vault repair — design

Date: 2026-11-15 · Status: awaiting approval · Scope: lot 1 of 3

## Intent

The Obsidian vault is Claude Code's long-term memory: a project page is injected
at `SessionStart`, a journal block is written at `Stop` and `PreCompact`. The
owner rarely opens Obsidian and does not intend to maintain it by hand. Today the
memory is wrong without him noticing, and he cannot tell what it does.

This lot repairs what is broken without changing the principle of the system.
The memory must be right with zero manual upkeep, and one command must show what
Claude knows about the current project.

## What is broken today

Measured with `node vault-lint.js` on the real vault (26 project pages, 55 journals):

- **The five richest pages inject nothing.** `Sessios.md` (32 000 chars),
  `CRM OMPT.md` (16 600), `Drawgengine OMPT.md`, `Vortex.md` and `nunu.md` have
  no `chemin:` in their frontmatter, so `resolveProjectFile` never finds them.
  They were written through the `vault-note` skill, which lets the model pick a
  page name by itself.
- **Auto-created twins take their place.** `software.md` is the page injected on
  `sessios/software`; `danilov-crm.md` on `danilov/crm`; `vortex-soft.md` on
  `vortex/soft`. Knowledge is split between the twin and the rich page.
- **13 pages are empty templates**, three of them for places that are not
  projects: a scratchpad directory under `/tmp` (`lt-proj`), `~/.claude/projects`
  (`projects`) and the home directory (`rebenga`).
- **The profile page is an empty template** (`Profil/Façon de coder.md`). The
  global `~/.claude/CLAUDE.md` already carries the owner's durable preferences
  and is loaded in every session.
- **Nothing surfaces any of this.** `vault-lint.js` detects most of it, but it is
  not exposed as a command and `config-doctor` does not call it.

Not a defect: `/home/rebenga/Documents` is a symlink to `/data/Documents`, and
`resolveProjectFile` already compares real paths. The two prefixes seen in
`chemin:` values are cosmetic.

## Goals

1. A session opened in a repository always finds its one project page, including
   a page that covers several repositories.
2. No page is ever created for a place that is not a project.
3. The existing vault is cleaned once: rich pages linked, twins merged, empty
   pages removed, with nothing lost.
4. One command shows which page is used for the current directory, what is
   injected and what is wrong.
5. One memory per kind of knowledge, written down where the model reads it.

## Non-goals (later lots)

- Injecting an index instead of the truncated page (lot 2). The 3 000-char cut
  stays for now; the status command reports it.
- Reminders to write notes, note labels, periodic clean-up, journal changes
  (lot 3), and PR #13.
- Semantic search, a database, LLM summaries of sessions.

## Anti-goals

- Losing or rewriting hand-written text. The managed-region invariant stays:
  hooks write only inside `<!-- claude:x:start/end -->`.
- A system that works only if the owner maintains it.
- Slowing the hooks: `Stop` must stay in the millisecond range.

## Approaches considered

**A. Keep `chemin:` as the identity, make it a list, and close the two leaks**
(skill and auto-creation). Smallest change; keeps every existing page valid;
pages stay self-describing in Obsidian. Chosen.

**B. Identify a project by its git remote (`depot: owner/repo`).** Survives a
moved folder, but needs a second mechanism for repositories without a remote and
for non-git folders, and does not fix the real cause: pages created without any
identity.

**C. A registry file mapping paths to pages.** One place to look, but invisible
from Obsidian and one more file that can drift from the pages.

A was chosen by the builder of this design (the owner delegated the how): the
measured failures come from pages created without identity, not from the way
identity is matched.

## Design

### 1. Project identity

- `chemin:` accepts one path or a YAML list of paths. `resolveProjectFile`
  matches any of them, real paths compared as today. Exact working directory
  still wins over the git root.
- When two pages declare the same path, the one with real content wins, then the
  older one; `vault-lint` reports the conflict.

### 2. Page creation

`ensureProjectPage` creates a page only when the working directory is inside a
git repository and is not in an excluded location: a Claude Code session
scratchpad (`<tmpdir>/claude-*`), anything under `~/.claude`, and the home
directory itself. Other git repositories under the temp directory keep a page:
the test suite builds its fixtures there, and no escape hatch is added for it.

Outside these conditions the session still gets its journal block; it simply has
no project page, and the journal header shows the project name as plain text
instead of a link. `vault-lint` no longer reports such journals as orphans.

### 2b. Journals follow the page

Today the journal file name, its `projet:` key, `latestJournal` and the
injection title all come from `projectName(cwd)`, not from the resolved page. A
page renamed or shared by several repositories would keep producing journals
under the folder name, with links to a page that no longer exists.

- When a page exists for the working directory, the journal name is the page
  name (`<date> — <page>.md`); without a page it stays `projectName(cwd)`.
- `projet:`, the journal header link, the dashboard links and the injection
  title use the same name.
- For a page covering several repositories, "last session" is the latest
  journal of the page, whichever repository it came from.
- Only this naming changes. Journal content and format are untouched (lot 3).

### 3. Writing through the skill

- New script `bin/vault-page.js`: prints the page path for a directory
  (default: cwd), creating it under the rules above. `--json` adds the resolved
  name, the declared paths and whether the page already existed.
- When the directory cannot have a page (section 2), the script exits non-zero,
  prints the reason and the path of today's journal. The skill then writes the
  note in that journal only and says so; it never invents a page.
- `skills/vault-note/SKILL.md` tells the model to obtain the page path from this
  script and never to choose a page name itself. The table "where to write what"
  loses the profile row.
- A preference true on every project is not written by the skill: it shows the
  owner the line it would add to `CLAUDE.md` and waits for a yes. That file is
  the owner's instructions and is versioned in a public repository.

### 4. Roles of the three memories

| Knowledge | Lives in |
|---|---|
| Rules the owner has validated, true everywhere | `~/.claude/CLAUDE.md` (versioned in this repo), edited only with his approval |
| Decisions, pitfalls and state of one project | vault project page and journal |
| What Claude learns by itself: facts about the machine and the user, corrections not yet promoted to a rule | Claude Code native memory |

- The profile is no longer injected; `BUDGET.profil` and
  `CC_VAULT_BUDGET_PROFIL` are removed; `scaffold-vault.js` stops seeding
  `Profil/`. Existing `Profil/` files are left in place, untouched.
- `CLAUDE.md` section "Mémoire longue" states the table above in two lines.

### 5. Visibility

- `vault-lint.js` gains `--project [dir]`: page used, declared paths, characters
  written versus injected, whether it is truncated, and the exact injected text
  with `--show`. It also reports pages for excluded locations.
- New plugin command `/rebenga:vault-status` runs it for the current directory
  and gives the result in plain French.
- `config-doctor` gets one line: number of pages, and a `WARN` when a page has no
  path, is a twin, or sits in an excluded location.

### 6. One-off migration of the existing vault

Done by Claude in a session with the owner, not by a script, because merging two
pages needs judgment.

1. Copy the whole `Claude/` folder to `~/.claude/backups/vault-<timestamp>/`.
2. Add `chemin:` to the five rich pages (`CRM OMPT` gets `danilov/crm` and
   `danilov/panel`).
3. Merge each twin into its rich page: hand-written sections are appended under
   a dated heading, the session list is merged, then the twin is deleted.
   Pairs: `software` → `Sessios`, `danilov-crm` → `CRM OMPT`,
   `vortex-soft` → `Vortex`.
4. Delete the pages that hold only placeholders, after showing the list.
5. Rename the journals of merged pages to the page name (section 2b) and rewrite
   their `[[old name]]` links and `projet:` key. If a journal of that date
   already exists under the new name, its session blocks are appended to it.
6. Run `vault-lint`: zero pages without path, zero twins, zero excluded pages.

The owner confirms the list of deletions before step 4.

## Constraints

- Node only, no dependency; CommonJS; files under 400 lines; style of the
  existing `hooks/lib/vault/*` modules.
- Tests run against a temporary HOME and vault, never the real one
  (`test-vault.js`, launched by `node test.js`).
- The repository is public: no client name or private path in code, tests or
  docs. This document names the owner's pages because the lint output is the
  evidence; examples in code and tests use neutral names.

## Tests

- A page with a list of paths is found from each of them.
- No page for a session scratchpad, `~/.claude/*`, the home directory, or a
  folder outside git; the journal block is still written.
- A session in a repository whose page has another name writes its journal under
  the page name; two repositories of one page share the "last session".
- `vault-page.js` on an excluded directory: non-zero exit, journal path printed.
- Conflict between two pages: content wins, lint reports it.
- No profile in the injection, even when `Profil/Façon de coder.md` has content.
- `vault-page.js` creates once, then returns the same path.
- `vault-lint --project` output for a truncated page and for a missing page.

## Left to the builder

- Exact wording of the lint and status output.
- How the YAML list is parsed (inline `[a, b]` and block form are both expected).
- Whether `vault-page.js` shares its exclusion list with `ensureProjectPage`
  through `naming.js` or a new small module.
