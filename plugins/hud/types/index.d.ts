/** One rate-limit window (`five_hour`, `seven_day`). */
export type Limit = { kind: string; percent: number; resetsAt: string | null }

/** The session's figures, as the engine last measured them. */
export type Usage = {
  tokens: number | null
  window: number
  percent: number | null
  limits: Limit[]
  usd: number | null
  startedAt: number
}

/** One finished turn of the main conversation. */
export type TurnPoint = { percent: number; usd: number; seconds: number; tools: number }

/** One row of the context breakdown. */
export type Category = { name: string; tokens: number }

/** What the vault gives a session started in this folder. */
export type Memory = {
  name: string
  hasPage: boolean
  why: string
  mode: 'entier' | 'sommaire' | 'vide'
  written: number
  injected: number
  budget: number
  startTokens: number
  hasLastSession: boolean
  sections: string[]
  staleRefs: number
}

export type PreviousSession = {
  isClosed: boolean
  startedAt: string | null
  endedAt: string | null
  usd: number | null
  bilan: string
}

/** The work session of this conversation (`/startsession`), and the one before. */
export type WorkSession = {
  isOpen: boolean
  startedAt: string | null
  baseUsd: number
  added: number
  removed: number
  previous: PreviousSession | null
}

/** What is read outside the engine: vault, work-session ledger, git. */
export type Probe = {
  at: number
  memory: Memory | null
  memoryNote: string
  work: WorkSession | null
  branch: string
  dirty: number
}

declare module 'claude-code' {
  interface PluginState {
    hud: {
      usage: Shaped<Usage | null>
      turns: Shaped<TurnPoint[]>
      categories: Shaped<Category[]>
      probe: Shaped<Probe | null>
      now: number
      isBandHidden: boolean
    }
  }
}
