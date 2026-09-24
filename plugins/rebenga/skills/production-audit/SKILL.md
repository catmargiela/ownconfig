---
name: production-audit
description: Evidence-based ship-or-block review of a client release from local files only — diff, auth, migrations, env, jobs, observability, rollback, tests, Tauri signing. Use before a release, or when the user asks « on peut livrer ? » ("can we ship?").
---

# Production audit

Reply to the user in French.

Green CI is not a release decision. This audit reads what is about to ship and
answers one question: ship, ship with reservations, or block. It happens
**before** the release; `/rebenga:deploy-verify` proves the deployment once
done, and `/rebenga:canary-watch` watches the live site afterwards. Say so if
the user asks for one of those instead.

## Rules

- **Local evidence only**: files, `git`, local builds and tests. No network,
  no production access, no external scanner, no upload of code anywhere.
- Secrets: variable **names** only, never a value, never `cat .env`.
- No change to the code. Every checklist item cites a proof: `file:line` or a
  command and its output. No proof = « non vérifié », which counts as a risk.

## 1. Release surface

```bash
git status --short --branch
git describe --tags --abbrev=0                 # last tag
git log --oneline <tag>..HEAD
git diff --stat <tag>..HEAD
```

Uncommitted or unpushed work in the release is itself a finding. From the
diff, list what is touched: Next.js routes and components, Go handlers,
migrations, workers, `src-tauri/`, CI and deploy files.

## 2. Checklist

| # | Item | What to look for |
|---|---|---|
| 1 | Auth and permissions | new or changed Go routes behind the right middleware, role checks server-side, Next.js middleware and server actions; a client-only check is a blocker |
| 2 | Migrations | reversible (a `down` exists and makes sense), zero-downtime (no lock on a big table, no column dropped still read by the running version, `NOT NULL` with default); run `/rebenga:migration-check` for the proof |
| 3 | Env and secrets | every new variable read (`os.Getenv`, `process.env`, `NEXT_PUBLIC_*`) present in `.env.example` and the deploy config; no secret in a `NEXT_PUBLIC_` variable or in the diff |
| 4 | Jobs and cron | new or changed workers, schedules, retries: idempotent, safe if run twice or during the deploy |
| 5 | Errors and observability | errors returned or logged with context, no swallowed `err`, no PII in logs, health endpoint still valid, alert on the new failure mode if there is one |
| 6 | Rollback | previous tag redeployable as is; if a migration is not backward-compatible, the rollback plan says how |
| 7 | Tests | each changed behaviour exercised by a test (`rebenga:pr-test-analyzer` can map it); run the affected suites: `go test ./...`, `tsc --noEmit`, the Next build, e2e on critical paths |
| 8 | Tauri (if touched) | version bumped consistently, updater `pubkey` and endpoints unchanged, signing secrets referenced by name in CI; see `rebenga:tauri-release` |
| 9 | API contract | a response or payload changed while an installed desktop app still reads it: see `rebenga:contract-first` |

Items that do not apply are marked « n/a » with the reason, not dropped.

## 3. Score and verdict

Each item: 2 = proven OK, 1 = minor risk or partial proof, 0 = problem or not
verified. Score = total / (2 × applicable items), as a percentage.

- **BLOQUER** if any of: auth missing on sensitive data, irreversible or
  locking migration without a plan, secret exposed, no rollback path, a
  failing test on a changed path. Whatever the score.
- **SHIP AVEC RÉSERVES** from 70 % with no blocker: the reservations are
  named, with who accepts them.
- **SHIP** from 90 % with no blocker.

## Output

```
Audit de production : v1.8.0 → HEAD (23 commits, 41 fichiers)
Verdict : SHIP AVEC RÉSERVES — 75 % (12/16)

[2] Auth          RequireRole("admin") sur POST /invoices — api/router.go:88
[1] Migrations    00043 réversible, mais index non CONCURRENTLY — migrations/00043_idx.sql:3
[2] Env           STRIPE_WEBHOOK_SECRET ajouté à .env.example:14 et deploy/compose.yml:37
[2] Jobs          relance idempotente (clé unique) — worker/reminders.go:61
[1] Observabilité erreur loguée sans l'id de facture — api/invoice.go:120
[2] Rollback      v1.8.0 redéployable, migration additive
[2] Tests         go test ./... ok (212), tsc ok, build Next ok
[0] Tauri         non vérifié : signature absente du workflow (.github/workflows/release.yml)
[n/a] Contrat     aucun payload modifié

Réserves : index à créer CONCURRENTLY ; vérifier la signature Tauri avant de publier.
Prochaine action : corriger 00043, puis relancer /rebenga:migration-check.
```

Each line cites its proof; anything not verified says so and costs points.
