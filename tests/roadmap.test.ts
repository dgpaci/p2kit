import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

const PROJECT = 'name: Portal\nstatus: delivery\nstage: { current: 2, name: Build, start: 2026-10-01 }\n'

const wp = (id: string, stage: number, status: string, extra = '') => ({
  path: `/p/.pm/work-packages/${id}.md`,
  text: `---\nid: ${id}\ntitle: ${id} title\nstage: ${stage}\nstatus: ${status}\n${extra}---\n`,
})

const WPS = [
  wp('WP-01', 2, 'in-progress', 'horizon: now\nrank: 2\n'),
  wp('WP-02', 2, 'authorized', 'horizon: now\nrank: 1\n'),
  wp('WP-03', 2, 'completed', 'horizon: now\nrank: 3\n'),
  wp('WP-04', 2, 'draft', 'horizon: next\n'),
  wp('WP-05', 2, 'draft', 'horizon: next\nrank: 1\n'),
  wp('WP-06', 3, 'draft', 'horizon: later\nrank: 1\n'),
  wp('WP-07', 3, 'draft'),
  wp('WP-08', 3, 'cancelled', 'horizon: later\n'),
]

test('the roadmap places the open work packages in their horizon, by rank then id', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS }, '2026-11-16')

  expect(project.workPackages.map(w => [w.id, w.horizon, w.rank])).toEqual([
    ['WP-01', 'now', 2],
    ['WP-02', 'now', 1],
    ['WP-03', 'now', 3],
    ['WP-04', 'next', null],
    ['WP-05', 'next', 1],
    ['WP-06', 'later', 1],
    ['WP-07', '', null],
    ['WP-08', 'later', null],
  ])
  // Completed and cancelled work packages leave the roadmap; an open one with no horizon is unplaced; no rank sorts last.
  expect(project.roadmap).toEqual({ now: ['WP-02', 'WP-01'], next: ['WP-05', 'WP-04'], later: ['WP-06'], unplaced: ['WP-07'] })
  expect(project.errors).toEqual([])
})

test('an unknown horizon or a rank that is not a number is an error; the work package stays unplaced or unranked', async () => {
  const project = buildProject(
    { path: '/p', project: PROJECT, products: [], workPackages: [wp('WP-09', 2, 'draft', 'horizon: soon\n'), wp('WP-10', 2, 'draft', 'horizon: now\nrank: first\n')] },
    '2026-11-16',
  )
  expect(project.workPackages.map(w => [w.id, w.horizon, w.rank])).toEqual([['WP-09', '', null], ['WP-10', 'now', null]])
  expect(project.roadmap).toEqual({ now: ['WP-10'], next: [], later: [], unplaced: ['WP-09'] })
  expect(project.errors).toEqual(['WP-09: horizon soon is not now, next or later', 'WP-10: rank is not a number'])
})

test('a project with no work package has an empty roadmap', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-11-16')
  expect(project.roadmap).toEqual({ now: [], next: [], later: [], unplaced: [] })
})
