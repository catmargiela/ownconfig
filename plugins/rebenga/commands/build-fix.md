---
description: Re-runs the failing build, delegates the repair to the build-fixer agent, then proves it green with a fresh run.
argument-hint: "[build command, empty = auto-detect]"
---

Reply to the user in French.

Fix the build of the current repository. Command given: `$ARGUMENTS`

Success is measured by one thing only: the command passes again, and the
output shows it.

## 1. Find the command

If `$ARGUMENTS` is empty, detect it in this order, stopping at the first one
that applies:

- `package.json`: read `scripts` (targeted key: `jq '.scripts' package.json`).
  Take `build`, else `typecheck`, else `tsc --noEmit`. Infer the package manager
  from the lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else `npm`.
- `go.mod`: `go build ./...` then `go vet ./...`.
- `pyproject.toml` / `setup.cfg`: the declared type checker (`mypy`, `pyright`),
  else `python -m compileall -q .`.
- `Cargo.toml`: `cargo build`.
- `Makefile`: the `build` target if it exists (`make -n build` to check).

If nothing applies, or if several toolchains coexist without a clear signal,
ask the user rather than guess.

## 2. Confirm the failure

Run the command and keep the **entire** output. If it already passes, say so
and stop: there is nothing to fix.

## 3. Delegate

Call the Agent tool with `subagent_type: build-fixer` (user agent, no plugin
prefix). Pass it:

- the exact command and the working directory;
- the error output (the first 80 lines are enough if it is long);
- a reminder of what it must not do: no `any`, no `@ts-ignore`, no
  `eslint-disable`, no `--no-verify`, no deleted or skipped test,
  no loosened config.

## 4. Prove

Re-run the same command **yourself** after the agent returns. Do not rely on
its report alone.

- Green: show the last lines of output and the exit code.
- Still red: show the new error and say what remains. Do not present a
  partial fix as a success.

## Report

```
Commande : pnpm build
Cause : import de `formatDate` depuis un module renommé en `date-utils`
Fichiers touchés : src/lib/report.ts
Preuve : exit 0 — "✓ Compiled successfully"
```

If the agent had to stop on a choice that weakens a safeguard, relay its
question to the user as is.
