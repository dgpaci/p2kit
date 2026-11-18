import { expect, test } from 'claude-code/testing'

import { getObjectives, parseObjectives } from '../hooks/objectives'
import { buildProject } from '../hooks/project'

const BRIEF = `---
product: brief
---
# Brief

## Objectives
Ticked only after the Board states in chat that the objective is met.

- [x] **O-1** Management products prepared by skills — brief, PID. *Done when:* each has its
  skill and appears on the desk.
- [ ] **O-2** Nothing gets lost. *Done when:* every open issue shows.
- [ ] ~~**O-3** Dropped idea~~
- [ ] **O-4** Assign from the desk

## Scope
- [ ] **O-9** not an objective: outside the section
`
const WP = (id: string, front: string) => ({ path: `/t/p/.pm/work-packages/${id}.md`, text: `---\nid: ${id}\n${front}---\n` })
const files = (brief: string | null, workPackages: { path: string; text: string }[]) => ({
  path: '/t/p', project: 'name: P\nstage: { current: 2 }\n',
  products: brief === null ? [] : [{ path: '/t/p/.pm/brief.md', text: brief }], workPackages,
})

test('the objectives checklist of a brief: id, title up to the dash or Done when, ticked, struck through', async () => {
  expect(parseObjectives(BRIEF)).toEqual([
    { id: 'O-1', title: 'Management products prepared by skills', isMet: true, isDropped: false },
    { id: 'O-2', title: 'Nothing gets lost', isMet: false, isDropped: false },
    { id: 'O-3', title: 'Dropped idea', isMet: false, isDropped: true },
    { id: 'O-4', title: 'Assign from the desk', isMet: false, isDropped: false },
  ])
  expect(parseObjectives('# Brief\n\n## Scope\n- [ ] **O-1** x\n')).toBeNull()
})

test('per objective the work packages naming it, cancelled ones left out, and how many are completed or archived', async () => {
  const project = buildProject(files(BRIEF, [
    WP('WP-01', 'status: completed\nobjectives: [O-1, O-2]\n'),
    WP('WP-02', 'status: in-progress\nobjectives: [O-2]\n'),
    WP('WP-03', 'status: cancelled\nobjectives: [O-4]\n'),
    WP('WP-04', 'status: archived\nobjectives: O-2\n'),
  ]), '2026-11-18')
  expect(project.objectives.map(o => [o.id, o.wps, o.done])).toEqual([
    ['O-1', ['WP-01'], 1], ['O-2', ['WP-01', 'WP-02', 'WP-04'], 2], ['O-3', [], 0], ['O-4', [], 0],
  ])
  expect(project.workPackages[1].objectives).toEqual(['O-2'])
  expect(project.errors).toEqual([])
})

test('an id the brief lacks is an error; a brief without the section shows nothing and no error', async () => {
  const errors: string[] = []
  getObjectives(BRIEF, [{ id: 'WP-06', status: 'draft', objectives: ['O-9'] } as never], errors)
  expect(errors).toEqual(['WP-06: objectives: O-9 is not in the brief'])

  const plain = buildProject(files('# Brief\n\nNo checklist.\n', [WP('WP-01', 'status: draft\nobjectives: [O-1]\n')]), '2026-11-18')
  expect(plain.objectives).toEqual([])
  expect(plain.errors).toEqual([])
  expect(buildProject(files(null, []), '2026-11-18').objectives).toEqual([])
})
