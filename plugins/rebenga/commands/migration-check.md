---
description: Checks the SQL migrations in the diff — static checks, dry run in a rolled-back transaction, sqlc regeneration, Go build and vet.
argument-hint: "[migration file, empty = migrations in the diff]"
---

Reply to the user in French.

Check the migrations. Target: `$ARGUMENTS`

A faulty migration often prevents the API from starting: the whole service
goes down, not just a feature. Each step reports its output.

## 1. Scope

Find the migrations folder and the tool (`goose` in the `Makefile`, the
`go.mod` or the code; `schema:` in `sqlc.yaml`). If `$ARGUMENTS` is empty:
new or modified files of that folder in `git status --porcelain` and
`git diff --name-only HEAD`. None: say so and stop.

## 2. Static checks

For each file, cite `fichier:ligne` for every defect:

- **No `;` in a comment.** goose splits on semicolons without recognising
  comments: a `;` in prose cuts the statement in two. `psql` can read a
  comment, so the dry run in 3 **does not detect** this defect. Prefer `--`
  to `/* */`.
- `-- +goose Up` and `-- +goose Down` present; `Down` actually undoes `Up`.
- `$$ … $$` bodies (functions, `DO`) wrapped in `-- +goose StatementBegin` /
  `StatementEnd`.
- Mixed `AND` and `OR`: parenthesised. Same care for `||` next to an
  operator like `~*`, whose precedence is surprising.
- `-- +goose NO TRANSACTION` or `CREATE INDEX CONCURRENTLY`: the in-transaction
  dry run is impossible; flag it instead of attempting it.

## 3. Dry run, always rolled back

**Development** database by default, found in `.env.example`, the compose file
or the `CLAUDE.md`, DSN read from the environment, never printed. Production:
only if the user explicitly asks, and the same rolled-back run.

Extract the `Up` section, wrap it and pass it **via stdin**, never as an
argument in double quotes (`$$` there becomes the shell's PID):

```bash
{ echo 'BEGIN;'; sed -n '/+goose Up/,/+goose Down/p' fichier.sql; echo 'ROLLBACK;'; } \
  | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"
```

Then replay `Up` followed by `Down` in a single rolled-back transaction. Never
`COMMIT`, never `goose up` against production from here. The last line of
output must be `ROLLBACK`.

## 4. Generated code and compilation

- sqlc present: `make sqlc` if the target exists, else `sqlc generate`, then
  `git status --short` to show what changed.
- `go build ./...` then `go vet ./...` in the Go module.

These steps see neither operator precedence nor goose splitting:
they complement the dry run, they do not replace it.

## Report

```
00043_add_status.sql
[✓] Statique      Up/Down, aucun ; en commentaire
[✓] Essai (dev)   BEGIN … ROLLBACK, 0 erreur
[✓] sqlc          2 fichiers régénérés
[✗] go vet        internal/orders/store.go:88 — …
```

Skipped or impossible step: say so, with the reason.
