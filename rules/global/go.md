---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/sqlc.yaml"
  - "**/sqlc.yml"
---
# Go

Loaded only when Go files are involved. Formatting and `go vet` run on their own
at the end of each answer; these are the rules a tool cannot enforce.

## Errors
- Wrap with context: `fmt.Errorf("create invoice %d: %w", id, err)`. Never drop an error; `_ =` only with a comment saying why.
- Compare with `errors.Is` / `errors.As`, never on strings.
- Map errors to HTTP status in one place (the handler layer), not deep in services.
- No `panic` outside `main` / init wiring. No `log.Fatal` in library code.

## Context and I/O
- Every function that does I/O takes `ctx context.Context` first and passes it down; outgoing HTTP and DB calls have a deadline.
- Close what you open (`defer rows.Close()`, `defer resp.Body.Close()`), and check `rows.Err()`.
- Goroutines have an owner and a stop condition (ctx or errgroup); no fire-and-forget.

## Database (sqlc + goose)
- Queries live in `.sql` files; regenerate with `sqlc generate`, never edit generated code.
- A schema change is a new goose migration with a working `-- +goose Down`; never edit an applied one.
- Multi-statement writes run in one transaction (`tx, err := db.BeginTx(ctx, nil)`; `defer tx.Rollback()`).

## Design
- Accept interfaces, return structs; define small interfaces where they are consumed.
- Dependencies through constructors, not package globals.
- Logging with `log/slog`, structured keys, never secrets or full request bodies.
- Config and secrets from environment variables, validated once at startup.

## Tests
- Table-driven with `t.Run`; run `go test -race -count=1 ./...` before claiming green.
- Skill `golang-testing` for patterns; agent `rebenga:go-reviewer` for review.
