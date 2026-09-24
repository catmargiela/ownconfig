---
description: Independent double review of a diff or PR against a PASS/FAIL checklist, with a fix loop capped at three rounds.
disable-model-invocation: true
argument-hint: [PR number, paths, or empty for the current diff]
---

Reply to the user in French.

Double review requested. Arguments: `$ARGUMENTS`

## Procedure

1. Scope:
   - a PR number: `gh pr diff <n>` and `gh pr view <n>` for the goal;
   - paths: `git diff HEAD -- <chemins>`;
   - nothing: `git diff HEAD`, then `HEAD~1` if that is empty.
   Empty diff: say so and stop. Read the changed files to understand the
   change, without starting the review yourself.
2. Build a checklist of **8 to 12 binary checks**, tailored to this diff.
   Each check has a verifiable PASS condition, not a judgement call. Baseline:
   - the logic does what the goal states, edge cases included;
   - no swallowed error nor fallback that masks a failure;
   - every changed behaviour is exercised by a test that asserts it;
   - no weakened safeguard (lint, typecheck, disabled test, `nolint`,
     `eslint-disable`, `any`, `--no-verify`);
   - no hardcoded secret, token or personal path;
   - inputs validated at the boundary (handler, Tauri command, form).
   Add depending on the diff: goose migration reversible and without a long
   lock, parameterised sqlc query, `ctx` propagated, SWR error state rendered,
   Rust `Result` surfaced to the front, no `unwrap` on external input.
   Show the checklist to the user before launching the reviewers.
3. Launch **two reviewers in parallel**, in a single message with two
   Agent calls: by default `code-reviewer` and `rebenga:silent-failure-hunter`
   (or `rebenga:go-reviewer`, `web-reviewer`, `rebenga:rust-tauri-reviewer`
   depending on the dominant stack). Same prompt for both: the goal, the
   checklist, the diff command, and the instruction « tu es seul à relire, rends PASS ou FAIL
   pour chaque contrôle avec la preuve `fichier:ligne` ; en cas de doute, FAIL ».
   Neither sees the other's output.
4. Verdict gate:
   - both return PASS on every check: verdict **PASS**, done;
   - otherwise: list the failing checks, with each reviewer's evidence,
     and propose a targeted fix per check.
5. Apply the fixes **only after the user's consent**, limited to what was
   flagged. Then re-run step 3 with two fresh reviewers, without passing them
   the previous reports.
6. **Three rounds maximum.** Beyond that, stop and present what is still
   failing for a manual decision.

## Forbidden

- Averaging or silently settling a disagreement: a check PASS for one and
  FAIL for the other is reported as a disagreement, with both pieces of evidence.
- Turning a check to PASS by loosening its condition between two rounds.
- Committing, pushing or fixing without explicit consent.
- Giving a reviewer the other's report or a previous round's report.

## Report format

| # | Contrôle | Relecteur A | Relecteur B | Preuve |
|---|---|---|---|---|
| 1 | … | PASS / FAIL | PASS / FAIL | `fichier:ligne` |

Then: disagreements (check, each one's position); rounds run (N/3);
final verdict **PASS**, **FAIL** (with the remaining checks) or **ESCALADÉ**.
