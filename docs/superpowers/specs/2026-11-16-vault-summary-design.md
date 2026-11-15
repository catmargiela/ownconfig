# Vault summary injection — design

Date: 2026-11-16 · Status: approved · Scope: lot 2 of 3

## Intent

At session start a project page is cut at `BUDGET.projet` (3 000 characters).
Nine pages of the owner's vault are longer; the longest holds 45 000 characters,
so whole sections (production, pitfalls) never reach the model, and nothing
tells it they exist. The model must at least know what the page contains and
where to read it, at the same start-up cost and with no upkeep by the owner.

## Approaches

- **A. Summary (chosen).** A page within the budget is injected whole. A longer
  one is injected as a summary: its introduction, then every `##` section with
  its title, its size and its first lines, plus the path of the page and the
  instruction to read the relevant section. Deterministic, free, inspectable.
- **B. Raise the budget.** The longest page would cost about 11 000 tokens at
  every session, paid again at every turn.
- **C. Summary written by a model.** Costs money, changes from run to run, and a
  wrong summary would go unnoticed.

Limit of A, accepted: the model has to open the page for the detail and may not.

## Design

- New module `hooks/lib/vault/summary.js`, `summarize(clean, budget, file)`.
  Input is the text already cleaned by `cleanForInjection`.
- Output never exceeds the budget. Order: one note line (this is a summary, full
  text at `<file>`), the introduction (at most a fifth of the budget), then the
  sections in page order.
- The characters left are shared between sections: a section that fits its
  share is given whole; the others share what remains equally and are cut at a
  line end, their title showing their real size. A cut section lists its `###`
  sub-headings. When there are too many sections for any excerpt, titles only.
- `inject.js` uses it for the project part; the journal part is unchanged.
- `audit.js` and `vault-lint.js` report the real injected size and the mode
  (whole or summary). A summarised page is information, no longer a defect.
- Also fixed here: the lint reported links to pages in sub-folders it did not
  index (`Profil/`) as broken.

## Non-goals

Reminders to write, clean-up of pages, journal changes (lot 3). No change to the
budget values or to the page format.

## Tests

Whole page under the budget; summary never above the budget, including with 200
sections; every section title present; a small section kept whole; the path of
the page present; lint output for a summarised page.
