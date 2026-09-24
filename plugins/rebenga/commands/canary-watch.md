---
description: Captures the observable state of a production site, then compares it after a deployment — statuses, assets, console errors, latency, key elements — and returns a PASS/FAIL verdict.
disable-model-invocation: true
argument-hint: "<url> [--baseline|--compare|--watch]"
---

Reply to the user in French.

Watch: `$ARGUMENTS` (default mode: `--compare` if a baseline exists,
`--baseline` otherwise).

`deploy-verify` proves the infra, the `prod-e2e` skill proves the user flows.
Here we check what a visitor sees, compared with the previous state. Without a
URL, ask for it and stop.

## Rules

- **Read-only**: GET and HEAD only. No form, no POST, no login with a real
  account.
- No load testing: a few requests per endpoint, sequential.
- Any credentials come from environment variables, never typed on the command
  line nor written to the baseline file.

## What we measure

Targets are read from `.claude/canary/<hôte>.json` if the baseline exists,
otherwise asked for (or inferred from the page, then validated):

1. **Page**: HTTP status, `content-type`, total time
   (`curl -sS -o /dev/null -w '%{http_code} %{content_type} %{time_total}\n'`).
2. **Key assets**: hashed scripts and CSS, fonts, main image — status,
   `content-type`, size.
3. Listed **endpoints**: median latency over 3 calls.
4. **Console**: load-time errors via Playwright if it is installed in the
   project (`page.on('console')`, `pageerror`). Otherwise, record it as « non mesuré ».
5. **DOM**: presence of the key selectors (`h1`, `nav`, CTA, app root).

## `--baseline`

Capture everything above into `.claude/canary/<hôte>.json` of the current
project: date, deployed commit if known, measured values, targets. Offer to add
`.claude/canary/` to `.gitignore`. Only re-baseline on a state deemed
healthy.

## `--compare`

Measure again, compare with the baseline:

| Check | FAIL if |
|---|---|
| Page | status differs from the baseline, or ≥ 400 |
| Assets | a 4xx/5xx, or `content-type` changed (JS served as `text/html`) |
| Console | an error absent from the baseline |
| Latency | more than double the baseline on an endpoint |
| DOM | a key element missing |

An asset size change is normal after a deployment: show it, do not count it as
a failure.

## `--watch`

Do not loop here. Suggest `/loop 5m /rebenga:canary-watch <url> --compare`
during the risk window, stopping at the first FAIL or after one hour
(12 runs). An interval under 2 minutes adds nothing.

## Report

```
Canary : <hôte> — compare vs baseline du <date>
[✓] Page       200 text/html 0.41 s (baseline 0.38 s)
[✓] Assets     14/14 en 200, types inchangés
[✗] Console    1 nouvelle erreur : TypeError dans main-8c1d….js
[✓] Latence    /api/health 45 ms (baseline 40 ms)
[ ] DOM        non mesuré (Playwright absent)
Verdict : FAIL
```

Each line cites the measurement; anything not measured says so.
