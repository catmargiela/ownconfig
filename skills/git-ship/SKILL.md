---
name: git-ship
description: Prepare a clean commit or pull request — splitting, conventional message, PR description. Use when about to commit, push or open a PR.
---

# Committing and opening a PR

Reply to the user in French.

## Before committing

```bash
git status                # what is about to go out
git diff                  # what was actually written
```

Never run `git add -A` without having read `git status`. Build files,
`.env`, dumps, screenshots and test artifacts slip in silently.

One commit = one coherent change. If the message needs an "and", there are
probably two commits.

## Message

```
<type>(<portée>): <ce que ça change, à l'impératif, en minuscule>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

The subject says **what changes**. The body, if any, says **why** — it is
the only information the diff does not contain.

```
fix(upload): rejeter les fichiers > 5 Mo avant lecture en mémoire

Le contrôle de taille arrivait après le buffer complet, ce qui permettait
de saturer la RAM du serveur avec quelques requêtes simultanées.
```

Never `--no-verify`. If a pre-commit hook fails, it has a reason.

## Pull request

Title: same form as a commit message.

Body, in this order:

1. **Ce que ça change** — two or three lines, in user language.
2. **Pourquoi** — the problem solved, or the ticket.
3. **Comment tester** — the exact steps a reviewer must follow to
   verify it themselves. This is the most useful section and the most often botched.
4. **Risques** — what could break elsewhere, what was not covered.

Build the summary from **all** the commits on the branch
(`git log main..HEAD`), not just the last one.

## Guardrails

- Never push to `main` or force-push without an explicit request.
- Prefer `--force-with-lease` over `--force`: it refuses to overwrite
  someone else's work.
- Check the target branch before opening the PR.
