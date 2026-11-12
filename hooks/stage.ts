import type { Phase, PhaseState } from '../types'

const STATE: Record<string, PhaseState> = { x: 'done', '>': 'in-progress', ' ': 'todo', '!': 'failed', '~': 'blocked' }
const PHASE_LINE = /^- \[(.)\] \*\*Phase (\d+)\*\*:\s*(.*)$/
const TAGS = /(\s*`[^`]*`)+\s*$/

/** The phases of a phased-workflow plan, in file order. */
export function parsePhases(text: string): Phase[] {
  return text.split('\n').flatMap(line => {
    const match = PHASE_LINE.exec(line.trimEnd())
    const state = match && STATE[match[1]]
    return match && state ? [{ number: Number(match[2]), title: match[3].replace(TAGS, '').trim(), state }] : []
  })
}

/** Done over total, the phase in progress (else the first not done), and how many failed. */
export function getPhaseSummary(phases: Phase[]): { done: number; total: number; current: Phase | null; failed: number } {
  return {
    done: phases.filter(phase => phase.state === 'done').length,
    total: phases.length,
    current: phases.find(phase => phase.state === 'in-progress') ?? phases.find(phase => phase.state !== 'done') ?? null,
    failed: phases.filter(phase => phase.state === 'failed').length,
  }
}

/** The plan of a branch among its `.phased` paths: the active one, else the archived one of the issue. */
export function findPlanPath(paths: string[], issue: number | null): string | undefined {
  const active = paths.find(path => /^\.phased\/active\/[^/]+\/plan\.md$/.test(path))
  if (active || issue === null) return active
  return paths.find(path => new RegExp(`^\\.phased/done/${issue}-[^/]+/plan\\.md$`).test(path))
}
