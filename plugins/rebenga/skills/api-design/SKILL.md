---
name: api-design
description: HTTP API conventions for the Go backend — naming, status codes, error envelope, validation errors, cursor pagination, idempotency, versioning, timestamps, money, rate limits. Use when designing a new endpoint, changing a response shape, or reviewing an API handler.
---

# API design

Reply to the user in French.

One API, two clients (Next.js front, Tauri desktop app): every endpoint must be
handled the same way. To change an existing endpoint, follow `contract-first`.

## Resources and methods

- Plural kebab-case nouns: `/v1/orders/{id}/line-items`. JSON fields in one case
  across the API (the repo's `snake_case` or `camelCase`), never both.
- `GET` read, `POST` create, `PATCH` partial, `PUT` full replace, `DELETE`.
  A non-CRUD action is a sub-resource verb: `POST /v1/orders/{id}/cancel`.
- Nest one level at most; beyond, filter: `/v1/line-items?order_id=…`.

## Status codes

| Case | Code |
|---|---|
| Read, update | 200 (204 if no body) |
| Created | 201 + `Location` header |
| Accepted for async processing | 202 |
| Malformed JSON, bad query param | 400 |
| Not authenticated / not allowed | 401 / 403 (404 if existence must not leak) |
| Not found | 404 |
| Conflict (duplicate, stale version, state transition refused) | 409 |
| Validation failed on well-formed input | 422 |
| Rate limited | 429 + `Retry-After` |
| Bug, unexpected error | 500 — never for a client mistake |
| Any error | never `200` with an error body |

## One error envelope

```json
{ "error": {
    "code": "validation_failed",
    "message": "Some fields are invalid.",
    "details": [ { "field": "email", "code": "invalid_format", "message": "…" } ],
    "request_id": "01J9…"
} }
```

- `code`: stable and documented; clients switch on it, never on `message`.
- `details`: one entry per invalid field, JSON path of the field
  (`items[2].quantity`), all errors at once rather than the first one.
- `request_id`: same value as the `X-Request-Id` response header and the logs.
- Map Go errors in one place (a middleware or `writeError` helper): domain
  sentinel errors (`ErrNotFound`, `ErrConflict`, a `ValidationError` type) via
  `errors.Is` / `errors.As` → status + code. `pgx.ErrNoRows` → 404, unique
  violation (`23505`) → 409. Anything unmapped → 500, generic message; the
  real error goes to the logs only (no SQL, no stack to the client).

## Pagination

Cursor-based, backed by a keyset query (see `postgres-patterns`):

```json
{ "data": [ … ], "page": { "next_cursor": "eyJ0IjoiMjAyNi0…", "has_more": true } }
```

- `?limit=50&cursor=…`, enforced max; `next_cursor` is `null` on the last page.
- The cursor is opaque (base64 of the sort key); clients never build or parse it.

## Idempotency

`POST` that creates something or moves money accepts an `Idempotency-Key`
header (client-generated UUID) — the Tauri app retries on flaky networks, and
without it a retry is a double order. Store key + request hash + response for a
bounded time (e.g. 24 h), unique on (key, caller):

- Same key, same body → replay the stored response.
- Same key, different body → 422 (or 409).
- Same key, still in progress → 409, client retries later.

## Versioning

- Major in the path (`/v1`); a new major only when nothing else can absorb it.
- Within a version, additive only; clients ignore unknown fields.
- Deprecation: `Deprecation` and `Sunset` headers plus a changelog entry; keep
  the old shape until the oldest supported desktop app no longer uses it.

## Data formats

- Timestamps: RFC 3339 in UTC with `Z` (`2026-09-24T08:30:00Z`); dates without
  time as `YYYY-MM-DD`. Never epoch numbers or local time.
- Money: integer minor units, never floats: `{"amount": 1299, "currency": "EUR"}`.
- IDs as strings in JSON (JS loses precision past 2^53 on `int64`).
- Enums as lowercase strings; a new value can break exhaustive clients.
- Absent vs `null`: decided per field, not left to `omitempty`.

## Rate limits

Limited routes send `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
(or the repo's existing `X-RateLimit-*`, not both). Over the limit: 429,
`Retry-After`, and the error envelope with `code: "rate_limited"`.

## Checklist

- [ ] Route, method and status codes follow the conventions above
- [ ] Errors go through the single envelope, 500 leaks nothing
- [ ] Lists paginated by cursor with an enforced max limit
- [ ] Creating/charging `POST` accepts `Idempotency-Key`
- [ ] Timestamps UTC RFC 3339, money in minor units, IDs as strings
- [ ] Change is additive, or `contract-first` followed for both clients
