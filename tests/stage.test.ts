import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { findPlanPath, getPhaseSummary, parsePhases } from '../hooks/stage'

// A phased-workflow plan as it sits on a stage branch.
const PLAN = `# Context: feature/498-certificato-testata-righe
Parent: develop | Issue: #498
Mode: manual

## Work Plan
- [x] **Phase 1**: Header model
  - Run: opus / medium
- [x] **Phase 2**: Rows model  \`vast\`
- [x] **Phase 3**: Print layout  \`ui\`
- [>] **Phase 4**: Signature flow
  > WIP: half done
- [ ] **Phase 5**: Migration of old certificates
- [!] **Phase 6**: Broken one
- [~] **Phase 7**: Waiting

## Notes
- [ ] a checklist item in the notes is not a phase
`

const PROJECT = 'name: Anaci\nstage: { current: 3, name: Certificate }\n'
const WP = (id: string, front: string) => ({ path: `/src/anaci/.pm/work-packages/${id}.md`, text: `---\nid: ${id}\nproduct: work-package\n${front}---\n` })
const WORK_PACKAGES = [
  WP('WP-03', 'title: Certificate header and rows\nstage: 3\nstatus: in-progress\nissue: 498\nbranch: feature/498-certificato-testata-righe\nbase: develop\n'),
  WP('WP-04', 'title: Release\nstage: 3\nstatus: authorized\nmilestone: v2.5\n'),
  WP('WP-05', 'title: Docs\nstage: 3\nstatus: draft\n'),
]

test('the phases of a plan: number, title without tags, state by marker', async () => {
  expect(parsePhases(PLAN)).toEqual([
    { number: 1, title: 'Header model', state: 'done' },
    { number: 2, title: 'Rows model', state: 'done' },
    { number: 3, title: 'Print layout', state: 'done' },
    { number: 4, title: 'Signature flow', state: 'in-progress' },
    { number: 5, title: 'Migration of old certificates', state: 'todo' },
    { number: 6, title: 'Broken one', state: 'failed' },
    { number: 7, title: 'Waiting', state: 'blocked' },
  ])
  expect(parsePhases('# no work plan here\n')).toEqual([])
})

test('the summary: done over total, the phase in progress first, else the first not done', async () => {
  const phases = parsePhases(PLAN)
  expect(getPhaseSummary(phases)).toEqual({ done: 3, total: 7, current: phases[3], failed: 1 })

  const notStarted = parsePhases('- [x] **Phase 1**: A\n- [ ] **Phase 2**: B\n')
  expect(getPhaseSummary(notStarted).current).toEqual({ number: 2, title: 'B', state: 'todo' })
  expect(getPhaseSummary(parsePhases('- [x] **Phase 1**: A\n')).current).toBeNull()
})

test('the plan of a branch: the active one, else the archived one of the issue', async () => {
  expect(findPlanPath(['.phased/done/12-old/plan.md', '.phased/active/498-cert/notes.md', '.phased/active/498-cert/plan.md'], 498))
    .toBe('.phased/active/498-cert/plan.md')
  expect(findPlanPath(['.phased/active/498-cert/tests/phase-1/plan.md'], 498)).toBeUndefined()
  expect(findPlanPath(['.phased/done/497-x/plan.md', '.phased/done/498-cert/plan.md'], 498)).toBe('.phased/done/498-cert/plan.md')
  expect(findPlanPath(['.phased/done/497-x/plan.md'], 498)).toBeUndefined()
  expect(findPlanPath([], null)).toBeUndefined()
})

test('work packages link to an issue, a milestone or a branch and carry the phases read from their branch', async () => {
  const project = buildProject(
    {
      path: '/src/anaci',
      project: PROJECT,
      products: [],
      workPackages: WORK_PACKAGES,
      wpPlans: [{ wp: 'WP-03', ref: 'origin/feature/498-certificato-testata-righe', path: '.phased/active/498-cert/plan.md', text: PLAN }],
      gitErrors: ['WP-04: no branch to read'],
    },
    '2026-11-12',
  )
  const [wp3, wp4, wp5] = project.workPackages

  expect(wp3.delivery).toMatchObject({
    issue: 498, milestone: '', branch: 'feature/498-certificato-testata-righe', base: 'develop',
    ref: 'origin/feature/498-certificato-testata-righe', planPath: '.phased/active/498-cert/plan.md', forge: null,
  })
  expect(wp3.delivery!.phases).toHaveLength(7)
  expect(wp3.delivery!.summary).toEqual({ done: 3, total: 7, current: 'Phase 4: Signature flow', failed: 1 })
  expect(wp4.delivery).toMatchObject({ issue: null, milestone: 'v2.5', branch: '', base: '', ref: '', planPath: '', phases: [] })
  expect(wp4.delivery!.summary).toEqual({ done: 0, total: 0, current: '', failed: 0 })
  expect(wp5.delivery).toBeNull()
  expect(project.errors).toContain('WP-04: no branch to read')
})

test('a project.yaml still carrying stages: is told to move its links to the work packages', async () => {
  const project = buildProject(
    { path: '/p', project: 'name: P\nstage: { current: 2 }\nstages:\n  - number: 2\n    issue: 498\n', products: [], workPackages: [] },
    '2026-11-12',
  )

  expect(project.errors).toContain('.pm/project.yaml: stages: is no longer read — link the work packages with /pm-link (docs/pm-schema.md)')
  expect(buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-11-12').errors).toEqual([])
})
