---
name: prod-e2e
description: A Playwright suite versioned in the repo and run safely against production — disposable test accounts, read-only journeys, credentials from environment variables. Use when verifying production after a deploy, testing in prod, or writing production e2e tests.
---

# E2e tests against production

Reply to the user in French.

Verifying production with tests means accepting that they run on real data.
So the suite must be more careful than a dev suite: it can break nothing,
pollute nothing, and leave nothing behind.

## A suite, not a script

- It lives **in the project's repo**, for example `e2e/prod/`, with its own
  Playwright project (`projects: [{ name: 'prod', testDir: 'e2e/prod' }]`) or
  its own config. It is reviewed, versioned and rerun on every deploy.
- No throwaway script in a temp folder: what is not in the repo will not be
  rerun.
- The Playwright MCP plugin is for **exploring** a screen or reproducing a bug
  by hand. What you learn from it then becomes a test in the suite.

## Test accounts

- Dedicated, disposable accounts, named `e2e-<horodatage>-<aléa>`, created by
  the suite's setup (through the API if possible) and **deleted** in teardown,
  even on failure (`globalTeardown` or a fixture with cleanup).
- Never a real user's account, never a shared admin account. Minimum
  permissions for the covered journeys.
- If the project does not allow creating an account cleanly, say so and ask
  for a permanent test account rather than working around it.

## What to test

- **Reads first**: login, main pages, search, displaying a record,
  downloading a document, API health.
- Writes: only on objects created by the suite itself, prefixed `e2e-`, and
  deleted at the end.
- **Forbidden**: deleting, modifying or sending anything on real data,
  triggering a payment, an email or a notification to a real person, a bulk
  import.

## Credentials and configuration

- URL and credentials from environment variables only
  (`E2E_BASE_URL`, `E2E_ADMIN_TOKEN`…), documented in `.env.example` without
  values. Never in the code, never in a committed `storageState`.
- The `storageState` file goes to a git-ignored path.

## Running

```bash
E2E_BASE_URL=https://<domaine> npx playwright test --project=prod
npx playwright test --project=prod --reporter=list   # readable count
npx playwright test --project=prod --trace on        # for debugging
```

Headless by default, `retries: 0`: a production failure is read, not rerun
until green. Report `N réussis / M échoués / K ignorés`, the failing tests
with their cause, and confirm that the `e2e-*` accounts were actually deleted.

## Delegating

To write, run and debug the suite, use the `rebenga:e2e-runner` agent. Give it
the production URL, the journeys to cover, the names of the environment
variables and the user's **explicit approval** to run against production —
without that approval, it refuses.
