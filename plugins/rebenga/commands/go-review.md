---
description: Go review of the current diff or of the given paths, delegated to the go-reviewer agent.
argument-hint: [paths or empty for the current diff]
---

Reply to the user in French.

Go review requested. Arguments: `$ARGUMENTS`

## Procedure

1. Scope:
   - if arguments are given, they are the files or folders to review;
   - otherwise, `git diff HEAD --name-only -- '*.go'`, then `HEAD~1` if that is empty.
   No Go file: tell the user and stop.
2. Delegate the review with the Agent tool, `subagent_type: "rebenga:go-reviewer"`.
   Pass it the list of files and, if there is one, the goal of the change
   in one sentence. Do not review the files yourself: the agent handles it.
3. Relay its report as is or nearly: tooling output, findings
   with severity and file:line, verdict. Do not soften or drop a
   finding, do not add any.
4. If there are CRITIQUE or ÉLEVÉ findings, offer to fix them, without
   starting before the user's consent.

## Forbidden

- Announcing the code is sound if the agent reported a tool that failed or
  was not run: say so explicitly.
- Fixing by adding `//nolint`, `_ =` or by skipping a test.
