# Vault repair — implementation plan

Design: `docs/superpowers/specs/2026-11-15-vault-repair-design.md` (approved 2026-11-15).
Branch: `feat/vault-repair`. One commit per step, tests first, `node test.js` green
before each commit. Steps 1 to 7 are code and go in one PR; step 8 is the live
migration of the owner's vault and runs only after that PR is merged.

## Step 1 — Project identity: `chemin:` as a list

Files: `hooks/lib/vault/naming.js`, new `hooks/lib/vault/identity.js`, `test-vault.js`.

- New module `identity.js` (keeps `naming.js` under control):
  - `declaredPaths(raw)`: reads `chemin:` from the frontmatter only. Accepts a
    scalar, an inline list `[a, b]` and a block list (`- a`). Strips quotes,
    expands a leading `~`.
  - `pagesByPath()`: one pass over `Projets/*.md` returning
    `{ file, paths, real, hasContent, mtimeMs }`.
- `resolveProjectFile(cwd)` uses it: exact working directory first, then git
  root; among several candidates, the page with real content
  (`cleanForInjection` non-empty) wins, then the oldest.
- Tests: list forms parsed; a page found from each of its paths; a `chemin:`
  written in the body is ignored; conflict resolved by content then age.

## Step 2 — Page creation rules

Files: `identity.js`, `hooks/lib/vault/pages.js`, `hooks/lib/vault.js`, `test-vault.js`.

- `canHavePage(cwd)` in `identity.js` returns `{ ok, why }`. False when: no git
  root; real path under `<os.tmpdir()>/claude-*`; under `~/.claude`; equal to the
  home directory.
- `ensureProjectPage` returns `null` when `canHavePage` is false and creates
  nothing. An already existing page is still returned.
- `record()` in `vault.js` handles `pageFile === null`: journal block written,
  `updateProjectEntries` skipped.
- `journalTemplate` writes the header as plain text (`# <date> — <name>`) when
  there is no page.
- Tests: no page for a scratchpad path, `~/.claude/x`, the home directory, a
  folder outside git; the journal block exists in each case; a git repository
  elsewhere under the temp directory still gets its page.

## Step 3 — Journals follow the page

Files: `naming.js`, `vault.js`, `inject.js`, `pages.js`, `test-vault.js`.

- `memoryName(cwd)` in `naming.js`: basename of the resolved page when it
  exists, else `projectName(cwd)`.
- `record()`, `sessionJournal`, `journalFile`, `linkJournal`, `latestJournal`
  and the injection title use `memoryName`. `writeSession` receives it as both
  `name` and `page`.
- A session that started before the change keeps the journal stored in its
  state (`acc.journal`): no mid-session rename.
- Tests: a repository whose page has another name writes
  `<date> — <page>.md` with `projet: <page>`; two repositories of one page share
  the injected "last session"; the dashboard links resolve.

## Step 4 — Profile out of the injection

Files: `inject.js`, `store.js`, `pages.js`, `scaffold-vault.js`, `vault-lint.js`,
`skills/vault-note/SKILL.md`, `CLAUDE.md`, `README.md`, `test-vault.js`.

- Remove the profile part of `buildInjection`, `BUDGET.profil` and
  `CC_VAULT_BUDGET_PROFIL`. `DIRS.profil` stays (existing folders are not touched).
- `scaffold-vault.js` no longer seeds `Profil/`; index and page templates drop
  the `[[Façon de coder]]` links.
- `vault-lint.js` drops the profile cost row and checks.
- Tests: nothing from `Profil/Façon de coder.md` is injected even when it has
  content; scaffold creates no `Profil/` page.

`CLAUDE.md` is the owner's instruction file: the two-line change to its
"Mémoire longue" section is shown to him in the PR description.

## Step 5 — `bin/vault-page.js` and the skill

Files: new `bin/vault-page.js`, `install.js` (`SCRIPTS`), `skills/vault-note/SKILL.md`,
`test-vault.js`, `test-status.js` if the doctor link count is asserted there.

- `node vault-page.js [dir] [--json]`: prints the page path, creating it under
  the step 2 rules. When the directory cannot have a page: exit 1, reason on
  stderr, today's journal path on stdout.
- Linked to `~/.claude/bin/vault-page.js` by the installer.
- Skill rewritten around it: get the path from the script, never choose a page
  name; journal-only fallback; a preference true everywhere is proposed as a
  `CLAUDE.md` line and written only after a yes; profile row and tree entry removed.
- Tests: creates once then returns the same path; exit code and output on an
  excluded directory; `--json` shape.

## Step 6 — Visibility

Files: `vault-lint.js` (split if it passes 400 lines: `vault-lint/project.js`),
new `plugins/rebenga/commands/vault-status.md`, `bin/config-doctor.js`,
`plugins/rebenga/.claude-plugin/plugin.json` (version 0.6.0), `test-vault.js`,
`test-status.js`.

- `vault-lint.js --project [dir] [--show]`: page used, declared paths, characters
  written versus injected, truncation, last-session source; `--show` prints the
  exact injected text. New finding: pages whose path is an excluded location.
  Orphan rule updated for journals without a page (step 2).
- `/rebenga:vault-status`: runs it for the current directory and reports in
  plain French, problems first.
- `config-doctor`: `checkVault()` → `OK Vault N pages` or
  `WARN Vault n sans chemin, n doublons, n hors projet`; silent `OK` line with
  the reason when the vault is disabled or absent.
- Tests: `--project` on a truncated page and on a directory without page;
  doctor line in both states.

## Step 7 — Documentation, review, PR

- `README.md`: vault section (tree, table of moments, identity rules, budgets,
  new command and script), `Contenu` table.
- Agents, in parallel: `code-reviewer` on the diff; `security-reviewer` on
  `vault-page.js` and `identity.js` (path handling, writes outside the vault).
- Fix findings, `node test.js`, `bash bin/check-plugin.sh`, push, open the PR.

## Step 8 — Migration of the real vault (after merge, with the owner)

Not scripted. Each sub-step is shown before it runs.

1. Copy `Claude/` to `~/.claude/backups/vault-<timestamp>/`; verify file count.
2. Add `chemin:` to the five rich pages.
3. Merge the three twins into their rich page; show each merged page.
4. List the placeholder-only pages; delete after the owner's yes.
5. Rename and relink the journals of merged pages.
6. `node vault-lint.js --verbose`: zero pages without path, zero twins, zero
   excluded pages. Then `/rebenga:vault-status` in two real repositories.

## Risks

- **Mid-session state**: sessions open during the upgrade hold `acc.journal`;
  step 3 keeps using it.
- **Public repository**: fixtures and examples use neutral names only.
- **Hook cost**: `pagesByPath()` reads every project page at `Stop`. Today's
  `resolveProjectFile` already does; measure in the existing performance test
  and keep the current bound.
