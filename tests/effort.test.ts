import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

const PROJECT = `name: Portal
status: delivery
stage: { current: 2, name: Build, start: 2026-10-01 }
tolerances:
  time: { limit: 10, used: 2, unit: days }
  effort: { limit: 5, used: 1, unit: hours }
`

const wp = (id: string, stage: number, status: string, extra = '') => ({
  path: `/p/.pm/work-packages/${id}.md`,
  text: `---\nid: ${id}\ntitle: ${id} title\nstage: ${stage}\nstatus: ${status}\n${extra}---\n`,
})

const WPS = [
  wp('WP-01', 2, 'completed', 'estimate: 10\nactual: 14\n'),
  wp('WP-02', 2, 'in-progress', 'estimate: 20\nactual: 8\n'),
  wp('WP-03', 2, 'in-progress', 'estimate: 6\nactual: 9\n'),
  wp('WP-04', 2, 'completed', 'estimate: 8\nactual: 5\n'),
  wp('WP-05', 2, 'cancelled', 'estimate: 5\nactual: 7\n'),
  wp('WP-06', 2, 'draft', 'estimate: 12\n'),
  wp('WP-07', 3, 'completed', 'estimate: 4\nactual: 10\n'),
]

test('each work package gets its estimate, actual and deviation; the current stage sums them', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS }, '2026-11-16')

  // deviation: actual − estimate on a completed work package; on an open one only an overrun counts (never below 0);
  // null when a figure is missing or the work package is cancelled.
  expect(project.workPackages.map(w => [w.id, w.estimate, w.actual, w.deviation])).toEqual([
    ['WP-01', 10, 14, 4],
    ['WP-02', 20, 8, 0],
    ['WP-03', 6, 9, 3],
    ['WP-04', 8, 5, -3],
    ['WP-05', 5, 7, null],
    ['WP-06', 12, null, null],
    ['WP-07', 4, 10, 6],
  ])
  // The stage: its work packages that are not cancelled and carry both figures (WP-01..04).
  expect(project.effort).toEqual({ stage: 2, estimate: 44, actual: 36, deviation: 4, counted: 4 })
  expect(project.errors).toEqual([])
})

test('the effort tolerance takes the stage deviation as used when the figures are there', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS }, '2026-11-16')

  // 4 / 5 = 80 % → amber; the written used: 1 is replaced. Other areas keep what is written.
  expect(project.tolerances).toEqual([
    { area: 'time', limit: 10, used: 2, unit: 'days', light: 'green', isComputed: false },
    { area: 'effort', limit: 5, used: 4, unit: 'hours', light: 'amber', isComputed: true },
  ])
  expect(project.light).toBe('amber')
})

test('without figures the effort tolerance keeps its written used; a saving counts as 0', async () => {
  const none = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [wp('WP-01', 2, 'in-progress')] }, '2026-11-16')
  expect(none.effort).toBe(null)
  expect(none.workPackages[0]).toMatchObject({ estimate: null, actual: null, deviation: null })
  expect(none.tolerances[1]).toEqual({ area: 'effort', limit: 5, used: 1, unit: 'hours', light: 'green', isComputed: false })

  const saving = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [wp('WP-04', 2, 'completed', 'estimate: 8\nactual: 5\n')] }, '2026-11-16')
  expect(saving.effort).toEqual({ stage: 2, estimate: 8, actual: 5, deviation: -3, counted: 1 })
  expect(saving.tolerances[1]).toEqual({ area: 'effort', limit: 5, used: 0, unit: 'hours', light: 'green', isComputed: true })
})

test('a figure that is not a number is an error and reads as missing', async () => {
  const project = buildProject(
    { path: '/p', project: PROJECT, products: [], workPackages: [wp('WP-08', 2, 'completed', "estimate: many\nactual: '3'\n")] },
    '2026-11-16',
  )
  expect(project.workPackages[0]).toMatchObject({ estimate: null, actual: null, deviation: null })
  expect(project.effort).toBe(null)
  expect(project.errors).toEqual(['WP-08: estimate is not a number', 'WP-08: actual is not a number'])
})
