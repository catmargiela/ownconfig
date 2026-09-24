---
name: postgres-patterns
description: Postgres indexing, EXPLAIN reading, N+1 and keyset pagination with sqlc, locking, and zero-downtime goose migrations. Use on a slow query, a new index, a new migration, a schema change, or a job queue in Postgres.
---

# Postgres patterns

Reply to the user in French.

Measure before indexing, and ship schema changes that the currently running
code survives. Verification of a migration is `/rebenga:migration-check`;
review of SQL and schema is the `rebenga:database-reviewer` agent.

## Indexing

| Need | Index |
|---|---|
| Equality / range / `ORDER BY` | btree (default) |
| Rows a query always filters on (`WHERE deleted_at IS NULL`, `status = 'pending'`) | partial: `... WHERE deleted_at IS NULL` |
| Several columns | composite: equality columns first, then the range/sort column |
| Index-only scan of a few extra columns | covering: `(user_id, created_at) INCLUDE (total)` |
| `jsonb` containment (`@>`, `?`) | GIN (`jsonb_path_ops` if only `@>`) |
| `ILIKE '%foo%'`, fuzzy search | GIN with `gin_trgm_ops` (`pg_trgm`) |

- Every foreign key used in joins or `ON DELETE` gets an index; Postgres does
  not create one.
- `(a, b)` serves `WHERE a = ?` and `WHERE a = ? AND b = ?`, not `WHERE b = ?`.
- An unused index costs every write: check `pg_stat_user_indexes.idx_scan`
  before keeping one "just in case".
- Types: `bigint`/`uuid` ids, `timestamptz` (never `timestamp`), `text` with a
  `CHECK` over `varchar(n)`, `numeric` or integer minor units for money.

## Reading EXPLAIN

Run `EXPLAIN (ANALYZE, BUFFERS)` on production-like data (in a transaction you
roll back for writes). Look for:

- `Seq Scan` on a large table with a selective filter: missing or unusable index.
- `rows=` estimated vs actual off by 10x or more: stale stats, run `ANALYZE`.
- `Rows Removed by Filter` large: the index does not cover the filter.
- `shared read` high vs `shared hit`: cold cache or too much data touched.
- `Sort` with `external merge`: `work_mem` too low or a missing sort index.
- Nested Loop with a large outer side: often an N+1 moved into SQL.

## N+1 with sqlc

A loop calling `q.GetItemsByOrder(ctx, id)` per order is N+1. Replace with one
query taking an array — `WHERE order_id = ANY(sqlc.arg(ids)::bigint[])` — and
group in Go, or a single `JOIN` query returning flat rows. Same for inserts:
batch with `unnest` arrays or `:copyfrom`.

## Pagination: keyset, not OFFSET

`OFFSET 10000` reads and discards 10 000 rows, and shifts when rows are
inserted. Use a keyset on a unique, indexed ordering:

```sql
-- name: ListOrders :many
SELECT * FROM orders
WHERE user_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT $4;
```

Index `(user_id, created_at DESC, id DESC)`. The `id` tiebreaker is mandatory;
the first page drops the row comparison (separate query or `sqlc.narg`).
The API exposes it as an opaque cursor (see `api-design`).

## Locking

- Every migration and long job sets `SET lock_timeout = '5s'` (and a
  `statement_timeout`): better to fail and retry than to queue behind a lock
  and block all traffic.
- Job queue: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n` in a short
  transaction; workers never wait on each other.
- Keep transactions short; no network call inside a transaction.
- Read-modify-write: `SELECT ... FOR UPDATE` or an atomic `UPDATE ... SET n = n + 1`,
  never read in Go and write back.

## Zero-downtime migrations (goose)

During a deploy, old and new code run against the same schema. Every
migration must be compatible with both.

**Expand / contract**: add the new shape (expand), deploy code that writes
both and reads the new one, backfill, then remove the old shape (contract) in a
later deploy. Never rename or drop a column in the same deploy as the code
change that stops using it.

**Index on a live table**:

```sql
-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created
  ON orders (user_id, created_at DESC);
-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_user_created;
```

`CONCURRENTLY` cannot run in a transaction, hence `NO TRANSACTION`; one index
per migration file. A failed build leaves an `INVALID` index: drop and retry.

**New required column**, across several migrations/deploys:

1. `ADD COLUMN x type NULL` (no volatile default; a constant default is fine
   on PG 11+).
2. Code writes `x` for new rows.
3. Backfill in batches (`UPDATE ... WHERE id IN (SELECT id ... LIMIT 5000)`),
   outside a long transaction, from a script or a `NO TRANSACTION` migration.
4. `ADD CONSTRAINT x_not_null CHECK (x IS NOT NULL) NOT VALID`, then
   `VALIDATE CONSTRAINT x_not_null` (no long exclusive lock); on PG 12+ a
   later `SET NOT NULL` reuses the validated check.

Same `NOT VALID` then `VALIDATE` for new foreign keys and checks.

**Also dangerous on a large table**: changing a column type (rewrite), adding
a `UNIQUE` constraint directly (build the unique index concurrently, then
`ADD CONSTRAINT ... USING INDEX`), `VACUUM FULL`.

Every migration has a working `Down`, or states why it is irreversible.

## Checklist

- [ ] Slow query: `EXPLAIN (ANALYZE, BUFFERS)` before and after, pasted
- [ ] New index justified by a query, created `CONCURRENTLY` on live tables
- [ ] No OFFSET pagination on growing tables; no N+1 loop over sqlc calls
- [ ] Migration compatible with the code currently deployed
- [ ] `lock_timeout` set; constraints added `NOT VALID` then validated
- [ ] `/rebenga:migration-check` run (static checks, dry run, sqlc, build), output shown
