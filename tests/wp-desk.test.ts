import { expect, test } from 'claude-code/testing'

import { getItemProgress } from '../hooks/milestones'
import { buildProject, getWorkThemes } from '../hooks/project'
import { parseObjective, parsePhaseOutcomes } from '../hooks/stage'

const PLAN = `# Context: wf/x
Parent: main

## Objective
The desk shows what each phase adds,
not the list of commits.

## Work Plan
- [x] **Phase 1**: Flow metrics  \`vast\`
  > Done: lead and review times in a Metrics tab.
  > Files: hooks/flow.ts
  - Done: tests pass
- [ ] **Phase 2**: Snapshot
  - Pattern reference: hooks/register.tsx
  - Done: the desk writes desk.json
- [ ] **Phase 3**: Bare

## Notes
  - Done: a note line, not a phase
`

test('what each phase adds: its Done summary once written, else its Done criterion; the plan objective on one line', async () => {
  expect(parsePhaseOutcomes(PLAN)).toEqual({ 1: 'lead and review times in a Metrics tab.', 2: 'the desk writes desk.json', 3: '' })
  expect(parseObjective(PLAN)).toBe('The desk shows what each phase adds, not the list of commits.')
  expect(parseObjective('# no objective\n')).toBe('')
})

test('a milestone-linked work package progresses by its closed items, from the item list when read, else from the counts', async () => {
  expect(getItemProgress(null)).toBeNull()
  expect(getItemProgress({ pulls: [], isReadyToClose: false })).toBeNull()
  expect(getItemProgress({ milestone: { title: 'M', open: 1, closed: 18, due: '' }, pulls: [], isReadyToClose: false })).toEqual({ done: 18, total: 19 })
  const item = (number: number, state: 'open' | 'closed' | 'merged') => ({ kind: 'issue' as const, number, title: '', url: '', state })
  expect(getItemProgress({ milestone: { title: 'M', open: 5, closed: 5, due: '' }, milestoneItems: [item(1, 'open'), item(2, 'closed'), item(3, 'merged')], pulls: [], isReadyToClose: false }))
    .toEqual({ done: 2, total: 3 })
})

const WP = (id: string, status: string) => ({
  path: `/p/.pm/work-packages/${id}.md`,
  text: `---\nid: ${id}\nproduct: work-package\nstage: 1\nstatus: ${status}\nmilestone: M-${id}\nestimate: 10\nactual: 8\n---\n`,
})

test('an archived work package counts as delivered but leaves the work themes; a completed one stays until archived', async () => {
  const project = buildProject(
    {
      path: '/p', project: 'name: P\nstage: { current: 1 }\n', products: [],
      workPackages: [WP('WP-01', 'in-progress'), WP('WP-02', 'completed'), WP('WP-03', 'archived'), WP('WP-04', 'cancelled')],
      wpPlans: [{ wp: 'WP-02', ref: 'feature/x', path: '.phased/done/x/plan.md', text: PLAN }],
    },
    '2026-11-16',
  )
  expect(getWorkThemes(project).map(wp => wp.id)).toEqual(['WP-01', 'WP-02'])
  expect(project.progress).toEqual({ done: 2, total: 3 })
  expect(project.roadmap.unplaced).toEqual(['WP-01'])
  expect(project.workPackages.find(wp => wp.id === 'WP-03')!.deviation).toBe(-2)
  const delivery = project.workPackages.find(wp => wp.id === 'WP-02')!.delivery!
  expect(delivery.objective).toBe('The desk shows what each phase adds, not the list of commits.')
  expect(delivery.phases.map(phase => [phase.number, phase.outcome])).toEqual([[1, 'lead and review times in a Metrics tab.'], [2, 'the desk writes desk.json'], [3, '']])
})

test('a Done summary drops the check that opens it and the code quotes', async () => {
  expect(parsePhaseOutcomes('- [x] **Phase 1**: A\n  > Done: `checks/phase-1.py` GREEN — tables `a.b` and a form\n')).toEqual({ 1: 'tables a.b and a form' })
})
