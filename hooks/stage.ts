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

// A Done summary often opens with the check that passed ("`checks/phase-1.py` GREEN — "): the reader wants what follows.
const toReadable = (outcome: string): string => outcome.replace(/^[^—]*\bGREEN\s*—\s*/, '').replaceAll('`', '')

const OUTCOME_LINE = /^\s+> Done:\s*(.*)$/
const CRITERION_LINE = /^\s+- Done:\s*(.*)$/

/** What each phase adds, by phase number: its `> Done:` summary once written, else its `- Done:` criterion; '' when the plan has neither. */
export function parsePhaseOutcomes(text: string): Record<number, string> {
  const outcomes: Record<number, { summary: string; criterion: string }> = {}
  let current: number | null = null
  for (const line of text.split('\n')) {
    const phase = PHASE_LINE.exec(line.trimEnd())
    if (phase) {
      current = Number(phase[2])
      outcomes[current] = { summary: '', criterion: '' }
      continue
    }
    if (/^#/.test(line)) current = null
    if (current === null) continue
    const summary = OUTCOME_LINE.exec(line)
    const criterion = CRITERION_LINE.exec(line)
    if (summary && !outcomes[current].summary) outcomes[current].summary = summary[1].trim()
    if (criterion && !outcomes[current].criterion) outcomes[current].criterion = criterion[1].trim()
  }
  return Object.fromEntries(Object.entries(outcomes).map(([number, one]) => [number, toReadable(one.summary || one.criterion)]))
}

/** The `## Objective` paragraph of a plan, on one line; '' when there is none. */
export function parseObjective(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex(line => /^## Objective\s*$/.test(line))
  if (start < 0) return ''
  const end = lines.findIndex((line, n) => n > start && /^#{1,2} /.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).map(line => line.trim()).filter(Boolean).join(' ')
}
