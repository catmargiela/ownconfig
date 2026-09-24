---
description: Cleans up dead code and unused dependencies and exports, on a green test baseline, via the refactor-cleaner agent.
disable-model-invocation: true
argument-hint: "[folder or empty for the whole repository]"
---

Reply to the user in French.

Clean up dead code. Scope: `$ARGUMENTS` (empty = the whole repository).

## 1. Baseline

Detect the build and test commands (`package.json` scripts, `go.mod`,
`pyproject.toml`, `Makefile`), then run them.

- Red: stop. Show the failure and suggest `/rebenga:build-fix` or fixing the
  tests first. A cleanup on a red baseline proves nothing.
- Green: record the exact figures (tests passed, duration) as the reference.

Measure the starting state:

```bash
git diff --stat HEAD            # doit être vide, sinon le signaler
git ls-files -- $ARGUMENTS | xargs cat | wc -l
```

Also record the number of declared dependencies (language manifest).

## 2. Delegate

Call the Agent tool with `subagent_type: rebenga:refactor-cleaner`. Pass it
the scope, the build and test commands validated in step 1, and the
reference test count.

## 3. Prove

Re-run build and tests **yourself** after the agent returns. Compare:

```bash
git diff --stat
git ls-files -- $ARGUMENTS | xargs cat | wc -l
```

## Report

```
Avant : 18 420 lignes, 46 dépendances, tests 128/128 ✓
Après : 18 008 lignes, 44 dépendances, tests 128/128 ✓
Supprimé : −412 lignes, −2 dépendances (lodash, moment), 1 fichier
Conservé volontairement : parseLegacy (référence dynamique)
API publique touchée : aucune
```

If the number of tests went down, flag it explicitly and give the
reason: a deleted test is not a cleanup.

Do not commit. Suggest the `git-ship` skill if the user wants to commit,
with one `refactor:` commit per category of removal.
