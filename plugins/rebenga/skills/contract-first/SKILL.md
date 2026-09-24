---
name: contract-first
description: Keep an API contract aligned between one provider (Go API, sqlc types) and several clients (Next.js front end, Tauri desktop app). Use before changing an endpoint, a payload, a response field or a shared type, or when a client breaks after an API-side change.
---

# Contract first

Reply to the user in French.

An endpoint has one provider and several readers. Renaming a field on the Go
side compiles, passes the Go tests, and silently breaks the front end and the
desktop app. So the contract is treated as a public interface: locate it, list
its readers, and change them together.

## 1. Locate the contract source

In this order; the first one found is authoritative:

1. A versioned schema: `openapi.yaml`, `api/*.json`, JSON Schema.
2. Otherwise, the Go handler's request and response structs, with their
   `json:"…"` and `omitempty` tags. An sqlc type exposed as is **is** the
   contract, including its `sql.NullString` and `pgtype.*` that change the
   serialization.

If client types are generated from the schema, note the generation command: it
is part of the change.

## 2. List the consumers

For each client (Next.js front end, Tauri app, script, other service):
`grep -rn` on the route (`/api/v1/orders`) **and** on every touched field, in
camelCase as well as snake_case. On the Tauri side, also check the Rust `serde`
structs and the `invoke` calls that relay the response. A client not listed is
a client you will break.

## 3. Classify the change

| Change | Nature |
|---|---|
| New optional field, new endpoint | additive |
| New required input field | breaking |
| Rename, removal | breaking |
| Type changed (`int` → `string`, epoch date → ISO) | breaking |
| Nullability: a field can become `null` or disappear (`omitempty`) | breaking |
| New enum value | breaking for a client with an exhaustive `switch` |

A breaking change: either a version (`/v2`, new field next to the old one,
dated deprecation), or a coordinated update of all clients **shipped
together**. An already installed desktop app does not update with the server:
for Tauri, the old contract must survive until the minimum supported version
drops it.

## 4. Change everyone in the same batch

Provider and every consumer in the same change set. Then prove each side with
its own command: `go build ./... && go test ./...`, `tsc --noEmit` and the Next
build, `cargo check` and the Tauri front end's typecheck. When feasible, add a
contract test: a Go test that serializes the response and compares it to a
JSON fixture, which the clients reuse in their tests.

## Output

```
| Champ          | Fournisseur (Go)        | Front Next         | Desktop Tauri      | Statut   |
|----------------|-------------------------|--------------------|--------------------|----------|
| order.total    | int64 cents → string    | formatPrice() mis à jour | struct serde mise à jour | cassant, coordonné |
| order.note     | nouveau, omitempty      | non lu             | non lu             | additif  |
| order.status   | + valeur "refunded"     | switch complété    | ⚠ match non exhaustif | bloquant |
```

Then the commands run on each side and their output. A blocking row or an
unverified side is stated, never left out.
