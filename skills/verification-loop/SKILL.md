---
name: verification-loop
description: Verification sequence to run before announcing that work is done, before opening a PR, or before a deployment. Use when about to say "c'est fait" / "it's done", "ça marche" / "it works" or "prêt à merger" / "ready to merge".
---

# Verification loop

Reply to the user in French.

"It works" is a claim that requires an executed command and its output.
This skill provides the sequence, in order from cheapest to most expensive.

## Order

The order is not arbitrary: each step is slower than the previous one, and
failing early avoids paying for the next ones. **Stop at the first red step**
and fix it before continuing.

### 1. The code compiles

```bash
# detect the package manager first: lockfile present
npm run build 2>&1 | tail -30
```

### 2. The types are correct

```bash
npx --no-install tsc --noEmit 2>&1 | head -30
```

A type error is not cosmetic. It gets fixed at the source — never with
`any`, `as`, `@ts-ignore` or loosening `tsconfig.json`.

### 3. Lint passes

```bash
npm run lint 2>&1 | head -30
```

Fix the code, not the rule.

### 4. Tests pass

```bash
npm test 2>&1 | tail -40
```

Report the real numbers: X passed, Y failed. A skipped test (`skip`) is
reported, it does not count as a success.

### 5. Nothing sensitive goes out with it

```bash
git diff --staged --name-only
git diff --staged | grep -nEi '(api[_-]?key|secret|password|token|BEGIN.*PRIVATE KEY)[\"'"'"']?\s*[:=]' || echo "aucun secret apparent"
```

Also check that no `.env`, database dump or credentials file is
in the diff.

### 6. The behavior, not just the toolchain

The five previous steps prove the code is well-formed, not that it does
what was asked. Re-read the initial request and check the relevant user path
— by launching the application if feasible.

## Report

Announce the result per step, with the real numbers:

```
build ✓  types ✓  lint ✓  tests 42/42 ✓  secrets ✓
Comportement vérifié : upload d'un fichier > 5 Mo rejeté avec le message attendu.
```

Any step not executed is declared as not executed. Never present a
skipped step as a success — it is the one failing that makes everything else
unusable.
