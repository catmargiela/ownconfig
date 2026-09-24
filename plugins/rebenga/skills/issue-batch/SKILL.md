---
name: issue-batch
description: Work through a batch of GitHub issues in parallel, then comment on them, close them and move them to "Done" on a GitHub Projects board. Use when the user says « fais les issues #X, #Y » ("do issues #X, #Y"), « traite les issues ouvertes » ("handle the open issues"), « mets-les en done » ("mark them done").
---

# GitHub issue batch

Reply to the user in French.

A closed issue announces a shipped fix. So only what is merged and verified
gets closed, and the board must reflect exactly the same thing.

## 1. Preflight

- `gh auth status`: read the scopes actually shown. `repo` is required; to
  move cards on a Projects v2 board, `project` is also required.
- `project` scope missing: tell the user to run
  `gh auth refresh -s project` themselves (interactive flow), then rerun
  `gh auth status` to confirm it. While it is missing, issues are handled but
  **no card is moved** — flag it in the final report.
- Repo and board: read them from the project's `CLAUDE.md` or `git remote -v`,
  otherwise ask. Never guess an owner or a board number.

## 2. Fetch and split

- Read each issue through the GitHub MCP server (`issue_read`) or
  `gh issue view <n> --json number,title,body,labels,state`.
- Set aside issues already closed or whose fix already exists (look for the
  commit or the PR): list them separately, with the proof.
- Group into batches whose touched files are **disjoint**. Two issues on the
  same file go to the same agent, or run in sequence.

## 3. Implement

- One subagent per batch, launched in parallel in a single message, with
  `isolation: "worktree"` so they don't step on each other.
- Each agent gets: the issue text, the target files, the test command, and the
  instruction to return the diff and the test output.
- Review each diff with `code-reviewer` (and `security-reviewer` on auth,
  payment, upload, SQL). Fix before integrating.
- Integrate, then run the full suite on the merged result — not just in each
  worktree.

## 4. Close out, issue by issue

Only if the fix is merged (or pushed to the agreed branch) and the tests are
green:

1. Comment (in French): what changed, in two or three lines, and the link to
   the commit or the PR. `gh issue comment <n> --body-file <fichier>`.
2. Close with a reason: `gh issue close <n> --reason completed` (or
   `"not planned"` for a dismissed issue, with the explanation in a comment).
3. Board: fetch the IDs, **never guess them**:
   - `gh project view <num> --owner <owner> --format json` → project id;
   - `gh project field-list <num> --owner <owner> --format json` → id of the
     `Status` field and id of the `Done` option;
   - `gh project item-list <num> --owner <owner> --format json` → card id.
   Then `gh project item-edit --id <item> --project-id <projet>
   --field-id <champ> --single-select-option-id <option>`.

## Forbidden

- Closing an issue whose fix is neither merged nor verified.
- Working around a missing scope (another token, raw API with a plaintext secret).
- Declaring a card "Done" without rereading its status after `item-edit`.

## Final report

An `issue → statut` table: fermée + Done / fermée, carte non déplacée (et
pourquoi) / ouverte (bloquante, avec la raison) / déjà faite (preuve). Then the
commands run and their actual output, and what is left for the user to do.
