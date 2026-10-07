/** Streak of identical Bash commands, as loop-guard tracks it. */
export type LoopState = { last: string; count: number; warned: boolean }

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
    }
  }
}
