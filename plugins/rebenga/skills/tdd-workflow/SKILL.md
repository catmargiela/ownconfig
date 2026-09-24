---
name: tdd-workflow
description: Test-first RED, GREEN, REFACTOR loop with proof at every step. Use when the code must be written tests first, for a new feature or a bug fix done test-first.
---

# TDD workflow

Reply to the user in French.

Test-first is only worth anything if every step is proven by the runner's
output. "The test fails" without pasted output is a claim, not a proof.

## Loop

1. **RED** — one test for one behavior. Run it. Show the failure, and check
   that it fails on the assertion — not on a broken import or a typo.
2. **GREEN** — the minimal code that makes it pass. Run it. Show the success.
3. **REFACTOR** — clean up code and test. Rerun the relevant suite. Show that
   it stays green.

One behavior per round. Run the targeted test file during the loop, the full
suite at the end.

## Choosing the first test

- **Bug**: the test that reproduces exactly the reported defect. If it passes,
  the bug is not understood — investigate before fixing.
- **Feature**: the simplest nominal case that forces the public API into
  existence (signature, name, return type). Then the boundaries: empty input,
  `null`, limit value, network error.
- Test the behavior observable by the caller, never the implementation.

## Delegating

Launch the `rebenga:tdd-guide` agent when the implementation needs several
rounds of the loop or touches several files: it runs the whole loop and returns
the RED/GREEN proofs per behavior. For a single-test change, run the loop here.

This skill complements the existing `test-writer` agent, it does not replace
it: `test-writer` writes a feature's tests or reproduces a bug before the fix;
`tdd-guide` chains test and implementation until green. For a bug, you can have
`test-writer` write the reproduction, then run GREEN and REFACTOR.

## Forbidden

Weakening an assertion, `skip` or `only`, touching the runner config, mocking
the unit under test, a test reduced to a snapshot. A red is fixed in the code.

## Checklist

- [ ] Project runner and conventions identified before writing
- [ ] Every test seen failing, output shown
- [ ] Every test seen passing, output shown
- [ ] Full suite rerun after refactor, actual numbers reported
- [ ] No test weakened, skipped or deleted
- [ ] Skipped or uncovered tests explicitly flagged
