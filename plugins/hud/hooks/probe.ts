/**
 * What the engine does not know: the vault page of this folder, the work
 * session of this conversation, the git branch. The first two come from
 * `bin/hud-data.js`, which reuses the vault's own modules, so the HUD shows
 * what the hooks compute and never a second opinion.
 */
import type { Memory, PreviousSession, Probe, WorkSession } from '../types'

/** `bin/hud-data.js` of the config repository, linked into ~/.claude/bin by its installer. */
const SCRIPT = ['.claude', 'bin', 'hud-data.js']

type Runner = (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string }>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function toMemory(v: unknown): Memory | null {
  if (!isRecord(v)) return null
  const mode = v.mode === 'sommaire' || v.mode === 'entier' ? v.mode : 'vide'
  return {
    name: str(v.name),
    hasPage: v.hasPage === true,
    why: str(v.why),
    mode,
    written: num(v.written),
    injected: num(v.injected),
    budget: num(v.budget),
    startTokens: num(v.startTokens),
    hasLastSession: v.hasLastSession === true,
    sections: Array.isArray(v.sections) ? v.sections.map(str).filter(Boolean) : [],
    staleRefs: num(v.staleRefs),
  }
}

function toPrevious(v: unknown): PreviousSession | null {
  if (!isRecord(v)) return null
  return {
    isClosed: v.isClosed === true,
    startedAt: strOrNull(v.startedAt),
    endedAt: strOrNull(v.endedAt),
    usd: typeof v.usd === 'number' ? v.usd : null,
    bilan: str(v.bilan),
  }
}

function toWork(v: unknown): WorkSession | null {
  if (!isRecord(v)) return null
  return {
    isOpen: v.isOpen === true,
    startedAt: strOrNull(v.startedAt),
    baseUsd: num(v.baseUsd),
    added: num(v.added),
    removed: num(v.removed),
    previous: toPrevious(v.previous),
  }
}

/** `## main...origin/main [ahead 1]` and one line per changed file. */
export function parseGit(stdout: string): { branch: string; dirty: number } {
  const lines = stdout.split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines[0].slice(3) : ''
  const branch = head.replace(/^No commits yet on /, '').split('...')[0]?.split(' ')[0] ?? ''
  return { branch, dirty: Math.max(0, lines.length - (head ? 1 : 0)) }
}

/** Never throws: what cannot be read is left empty, with a note for the pane. */
export async function probe(run: Runner, home: string, sid: string, cwd: string, at: number): Promise<Probe> {
  const empty: Probe = { at, memory: null, memoryNote: '', work: null, branch: '', dirty: 0 }
  let out: Probe = empty
  try {
    const r = await run(['node', [home, ...SCRIPT].join('/'), sid, cwd], { timeoutMs: 8000 })
    const parsed: unknown = r.exitCode === 0 ? JSON.parse(r.stdout) : null
    out = isRecord(parsed)
      ? { ...empty, memory: toMemory(parsed.memory), memoryNote: str(parsed.memoryNote), work: toWork(parsed.work) }
      : { ...empty, memoryNote: 'Lecture du vault impossible.' }
  } catch {
    out = { ...empty, memoryNote: 'Lecture du vault impossible.' }
  }
  try {
    const g = await run(['git', '-C', cwd, '--no-optional-locks', 'status', '--porcelain', '-b'], { timeoutMs: 3000 })
    if (g.exitCode === 0) out = { ...out, ...parseGit(g.stdout) }
  } catch {
    // not a repository, or git missing: no branch shown
  }
  return out
}
