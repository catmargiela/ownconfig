---
name: e2e-testing
description: End-to-end testing patterns for web apps with Playwright — locators, fixtures, reused auth, flakiness, CI. Use when the talk is about end-to-end tests, user journeys to test, Playwright or a flaky test.
---

# End-to-end tests

Reply to the user in French.

An e2e test is expensive to write, run and maintain. It is justified when it
protects a journey whose failure costs money or users.

## When to write one

- **Yes**: sign-up, login, payment, the product's main journey, integration
  between front end, API and database that no other test covers.
- **No**: business logic, validation edge cases, formatting. A unit test covers
  them faster and more precisely.

Aim for a few solid journeys, not an e2e copy of the unit suite.

## Locators

In order of preference: `getByRole('button', { name: 'Payer' })`,
`getByLabel('E-mail')`, `getByText`, then `getByTestId`. They follow what the
user sees and fail when accessibility breaks. Never a selector based on a CSS
class or a position in the DOM.

## Fixtures and data

- `test.extend` to provide a page already in the right state or a test user
  created through the API.
- Each test creates its own data, with a unique identifier, and depends on no
  other test.
- Set up state through the API rather than clicks: faster, less brittle.

## Authentication

A `setup` project logs in once and writes `storageState` to a git-ignored
file. The other projects declare it in `use.storageState` and depend on setup
through `dependencies`. Credentials from environment variables, never
hardcoded.

## Waiting

- Web-first assertions: `await expect(locator).toHaveText(...)` waits on its own.
- For a specific call: `const res = page.waitForResponse('**/api/cart')`
  before the action, then `await res` after.
- Forbidden: `page.waitForTimeout(ms)`. A fixed delay is either too long or
  too short on CI.

## Flakiness

A flaky test is a bug, in the test or in the app. Reproduce it with
`npx playwright test --repeat-each=10 fichier.spec.ts`, read the trace, and
fix the cause: missing wait, shared data, animation, clock. Do not raise
`retries` or mark it `skip` to silence it.

## Running

```bash
npx playwright test                     # headless, all configured browsers
npx playwright test e2e/checkout.spec.ts --project=chromium
npx playwright test --trace on          # full trace for debugging
npx playwright show-report
```

On CI: `npx playwright install --with-deps chromium`, `webServer` in the
config to start the app, `forbidOnly: !!process.env.CI`, and `test-results/`
published as an artifact on failure.

## Delegating

To write, run and debug the tests, use the `rebenga:e2e-runner` agent. Give it
the journey to cover, the base URL and the app's start command.
