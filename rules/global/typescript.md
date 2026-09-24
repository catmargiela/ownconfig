---
paths:
  - "**/*.{ts,tsx,mts,cts}"
  - "**/tsconfig*.json"
---
# TypeScript / React / Next.js

Loaded only when TypeScript files are involved. Formatting, `tsc --noEmit` and
leftover `console.log` are checked at the end of each answer; these are the rest.

## Types
- No `any`, no `as` to silence the compiler, no `@ts-ignore`: fix the type. `unknown` for untrusted input, then narrow.
- Explicit parameter and return types on exported functions and shared utilities; let locals infer.
- String-literal unions over `enum`; `interface` for extendable object shapes, `type` for unions and mapped types.
- Types shared with the Go API come from the contract (generated or mirrored), never re-invented per client: see skill `contract-first`.

## Boundaries
- Validate at the edge with a schema (Zod or the project's validator): route handlers, Server Actions, form input, `JSON.parse`, env vars. Infer the type from the schema.
- Server Actions and route handlers are public endpoints: authenticate and authorize inside them.
- Nothing secret in `NEXT_PUBLIC_*` or client components.

## React
- Props typed with a named interface; no `React.FC` by default.
- Server Components by default in the App Router; `"use client"` only where state, effects or browser APIs are needed.
- Effects are for synchronizing with the outside world, not for deriving state; list every dependency.
- Every async UI path has loading, error and empty states; buttons that submit are disabled while pending.

## Style
- Immutable updates (spread, `map`, `filter`); no mutation of props or state.
- `async/await` with errors narrowed from `unknown`; never swallow a rejected promise.
- Agent `web-reviewer` for components, `rebenga:typescript-reviewer` for logic.
