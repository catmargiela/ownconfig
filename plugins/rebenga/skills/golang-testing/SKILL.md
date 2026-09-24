---
name: golang-testing
description: Go testing conventions — table-driven subtests, httptest handlers, a real Postgres instead of mocked sqlc, fuzzing, benchmarks, race detector, golden files. Use when writing Go tests, a Go test is flaky, or coverage of a Go package is questioned.
---

# Go testing

Reply to the user in French.

A Go test proves something only if it runs against the real thing where it
matters (the database) and runs clean under `-race`. Follow the repo's existing
conventions before adding your own.

## Conventions first

- Stdlib `testing` or `testify`: use what the package already uses. Do not mix
  both in one file. With testify, `require` for preconditions (stops the test),
  `assert` for independent checks.
- Test files next to the code, `package foo` for internals, `package foo_test`
  for the public API. Helpers call `t.Helper()`; cleanup goes through
  `t.Cleanup`, not `defer` in a helper.
- `t.TempDir()`, `t.Setenv()`, `t.Context()` (Go 1.24+) over hand-rolled setup.

## Table-driven tests

```go
tests := []struct {
    name    string
    in      string
    want    Amount
    wantErr error
}{
    {"integer", "12", Amount(1200), nil},
    {"empty", "", 0, ErrEmpty},
}
for _, tc := range tests {
    t.Run(tc.name, func(t *testing.T) {
        got, err := Parse(tc.in)
        if !errors.Is(err, tc.wantErr) { t.Fatalf("err = %v, want %v", err, tc.wantErr) }
        if got != tc.want { t.Errorf("got %v, want %v", got, tc.want) }
    })
}
```

- Unique, readable `name`: it is how `-run 'TestParse/empty'` targets a case.
- Compare errors with `errors.Is` / `errors.As`, never on the message string.
- Structs: `cmp.Diff(want, got)` (go-cmp) gives a readable diff.

## t.Parallel caveats

- Only for tests with no shared mutable state: no package globals, no
  `t.Setenv` (it panics with `t.Parallel`), no shared DB rows.
- Go ≥ 1.22 gives each loop iteration its own `tc`; on older `go.mod` versions,
  copy `tc := tc` before `t.Run`.
- A parent's `t.Cleanup` runs after its parallel subtests finish; a `defer` in
  the parent runs too early.

## HTTP handlers

```go
req := httptest.NewRequest(http.MethodPost, "/v1/orders", strings.NewReader(body))
rec := httptest.NewRecorder()
srv.Handler().ServeHTTP(rec, req)
```

Assert status, `Content-Type`, and the decoded body — including the error
envelope (see `api-design`). Go through the real router so middleware (auth,
request id, validation) is exercised. `httptest.NewServer` only when a real
client is needed (timeouts, TLS, streaming).

## Database: real Postgres, not mocked sqlc

Mocking sqlc's `Querier` tests your mock, not your SQL. Run against a real
Postgres at the same major version as production:

- testcontainers-go (`modules/postgres`) or the repo's docker compose `db`
  service; start it once in `TestMain`, apply goose migrations once.
- Isolation per test: open a transaction, build queries with
  `db.New(tx)` / `queries.WithTx(tx)`, `t.Cleanup(func(){ tx.Rollback(ctx) })`.
- Code that manages its own transactions or needs commit visibility: unique
  data per test (random ids/emails) or truncate in cleanup — not parallel.
- Guard with a build tag or `testing.Short()` so `go test -short` stays fast.
- Mock only external boundaries you do not own (payment, email, HTTP APIs),
  behind a small interface defined by the consumer.

## Fuzzing, benchmarks, golden files

- **Fuzz** every parser/decoder of untrusted input: `func FuzzParse(f *testing.F)`,
  seed with `f.Add(...)`, assert invariants (no panic, round-trip holds). Run
  `go test -fuzz=FuzzParse -fuzztime=30s ./pkg/...`; commit found inputs from
  `testdata/fuzz/`.
- **Benchmarks** only for a hot path under discussion: `for b.Loop()` (Go
  1.24+) or `for i := 0; i < b.N; i++`, `b.ReportAllocs()`. Compare with
  `-count=10` and `benchstat`, never on a single run.
- **Golden files** for large outputs (JSON responses, rendered text): store in
  `testdata/*.golden`, regenerate with a `-update` flag, review the diff before
  committing. A golden file nobody reads is a snapshot that proves nothing.

## Commands

```bash
go test -race -count=1 ./...                  # the default gate
go test -run 'TestOrders/refund' -v ./internal/orders
go test -coverprofile=cover.out ./... && go tool cover -func=cover.out
go vet ./...
```

`-count=1` defeats the test cache; `-race` is not optional for code with
goroutines. Coverage: read `cover -func` for critical paths (money, auth,
state transitions, error branches) — do not chase a percentage, and exclude
sqlc-generated code from the discussion.

## Checklist

- [ ] Existing conventions followed (stdlib vs testify, package naming)
- [ ] Error paths tested with `errors.Is`, not only the happy path
- [ ] SQL exercised against a real Postgres, rolled back per test
- [ ] Parsers of external input have a fuzz target
- [ ] `go test -race -count=1 ./...` run, output shown
- [ ] After writing, `rebenga:go-reviewer` for the code under test
