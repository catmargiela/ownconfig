/** Streak of identical Bash commands, as loop-guard tracks it. */
export type LoopState = { last: string; count: number; warned: boolean }

/** Per rate-limit window (`five_hour`, `seven_day`): the reset and the highest threshold announced. */
export type QuotaSeen = Record<string, { resetsAt: string | null; level: number }>

declare module 'claude-code' {
  interface PluginState {
    ccx: {
      /** Destructive commands already fact-forced this session (pre-bash). */
      destructive: string[]
      /** `<finding id>|<command>` pairs already warned about (bash-hygiene). */
      hygiene: string[]
      /** Current streak of identical Bash commands (loop-guard). */
      loop: LoopState | null
      /** Files already fact-forced this session, strict profile (pre-edit). */
      factSeen: string[]
      /** Context reasons (`window`, `cost`) already warned about since the last compaction (context-monitor). */
      contextWarned: string[]
      /** Rate-limit thresholds already announced (quota-alert). */
      quotaSeen: QuotaSeen
      /** Phrase keys already reported this session (delivery-check). */
      deliverySeen: string[]
      /** When the current turn started, in `$.clock.now()` milliseconds (turn-timer). */
      turnStart: number | null
    }
  }
}
