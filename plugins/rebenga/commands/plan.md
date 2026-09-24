---
description: Explore the codebase and produce an approved implementation plan before writing a single line of code.
disable-model-invocation: true
argument-hint: "<feature to plan>"
---

Reply to the user in French.

Plan: $ARGUMENTS

Follow these steps in order. **No code is written before the user's explicit
approval.**

## 1. Check the request

If `$ARGUMENTS` is empty, ask the user what they want to plan, then
stop. Do not guess.

## 2. Delegate the exploration

Launch the Agent tool with `subagent_type: "rebenga:planner"`. Pass it:

- the request as is: `$ARGUMENTS`;
- the useful context already known in the session — mentioned files, stated
  constraints, decisions taken, project stack.

Wait for its plan. Do not redo the exploration here in parallel.

## 3. Switch to plan mode

Call the `EnterPlanMode` tool. If it is not loaded, load it first with
ToolSearch, query `select:EnterPlanMode,ExitPlanMode`.

In plan mode:

- review the planner's plan, check any cited paths that look doubtful;
- refine it: missing steps, absent verification, underestimated risk;
- settle what can be settled, keep genuine open questions visible.

Present the final plan with `ExitPlanMode` for approval.

## 4. Wait

Until the user has approved, create or modify no file.
If they ask for changes, revise the plan and present it again. Once
approved, follow the steps in order and run each one's verification
before moving to the next.
