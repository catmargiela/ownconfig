---
description: Deploys with the project's script after consent, then proves from command output that services, migrations, health, proxy, bundle and .env are good.
disable-model-invocation: true
argument-hint: "[environment, empty = production]"
---

Reply to the user in French.

Deploy and verify. Environment: `$ARGUMENTS` (empty = production).

A deployment is only done when every line of the checklist has proof:
a command that was run and its output. Nothing below is hardcoded; everything
is **discovered** in the project or asked for.

## 1. Discover

Read, without running anything: the project's `CLAUDE.md` and `.claude/`, the
deployment script (`deploy.sh`, `deploy/`, `deploy` target of the `Makefile`),
the `docker-compose*.yml` files, `.env.example`. Derive from them:

- the deploy command and the target host (ssh alias, never a copied IP);
- the compose file and compose project used in production;
- the expected services: `docker compose -f <fichier> config --services`
  (**never** `config` alone, which prints the resolved variables);
- the services supposed to have a `healthcheck`;
- the health URL (`/health`, `/healthz`, `/status`…) in the `CLAUDE.md` or the
  router; the migrations folder and the tool (goose or other);
- the reverse proxy container and the path to its config.

Anything missing or ambiguous: ask. Do not guess a host.

## 2. Confirm

Deploying is an externally visible action. Show the exact command, the host,
the commit (`git log -1 --oneline`) and what is not pushed, then **wait for an
explicit yes**. Without a yes, stop there.

## 3. Deploy

Run the script as is and keep the entire output. On failure: stop, show the
error, do not re-run or fix anything on the server.

## 4. Verify, in order, stopping at the first red

1. **Services**: `docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'`
   on the host. Number of `running` services = number expected in 1; each
   service with a healthcheck is `healthy` (wait out `starting` without a fixed
   `sleep`: bounded loop or Monitor). If other projects share the host, check
   they are still running.
2. **Migrations**: applied version = highest number in the folder. With goose,
   `goose status` if the DSN is already in the container's environment, else
   `SELECT max(version_id) FROM goose_db_version WHERE is_applied` via `psql`
   in the database container, SQL in single quotes. Never type a DSN with a
   password on the command line.
3. **Health**: `curl -sS -o /dev/null -w '%{http_code}\n' <url>` → 200. For a
   new protected route, 401 versus 404 on a made-up path proves it
   exists.
4. **Proxy**: validation inside its container, for example
   `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
5. **Served bundle**: `curl -sS --compressed <url>/` and compare the hashed
   script names (or the build ID) with those of the local build just deployed;
   or the `ETag` before/after. Same hash as before = the old front is still served.
6. **`.env`**: lines without `=`, **never printing a value**:
   `awk 'NF && $0 !~ /^[[:space:]]*#/ && index($0, "=") == 0 { print NR }' .env`
   → line numbers only. Such a line makes `docker compose` reject the file on
   the next start. For keys: `cut -d= -f1`.

## Forbidden in production

No destructive command: no `down -v`, `rm`, `prune`, `DROP`,
`DELETE`, `TRUNCATE`, no `goose down`, no database writes. No hotfix on the
server. At the first red: stop, report, propose — do not fix without consent.

## Report

```
Déploiement : production — a1b2c3d (exit 0)
[✓] Services     7/7 running, 3/3 healthy
[✓] Migrations   version 42 = dernier fichier 00042_add_index.sql
[✓] Santé        GET /healthz → 200
[✓] Proxy        caddy validate → "Valid configuration"
[✗] Bundle       main-3f9a… servi, main-8c1d… attendu → arrêt
[ ] .env         non vérifié (arrêt avant)
```

Each ✓ cites the output that proves it; each unverified line says so.
