import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

const PROJECT = 'name: Portal\nstage: { current: 1, name: Build, start: 2026-11-01 }\n'

const wp = (id: string, extra = '') => ({
  path: `/p/.pm/work-packages/${id}.md`,
  text: `---\nid: ${id}\ntitle: ${id} title\nstage: 1\nstatus: in-progress\nestimate: 10\n${extra}---\n`,
})

const sheet = (login: string, month: string, lines: string[]) => ({
  login, path: `/p/.pm/timesheets/${login}/${month}.yaml`, text: `# crystallized by /pm-log\nentries:\n${lines.map(l => `  - ${l}\n`).join('')}`,
})

const TIMESHEETS = [
  sheet('pm', '2026-11', [
    "{ date: 2026-11-25, ref: '#85', wp: WP-01, kind: dev, minutes: 90 }",
    "{ date: 2026-11-26, ref: '#85', wp: WP-01, kind: dev, minutes: 30, sent: true }",
    '{ date: 2026-11-26, kind: desk, minutes: 45 }',
  ]),
  sheet('dev1', '2026-11', ["{ date: 2026-11-26, ref: '#90', wp: WP-02, kind: dev, minutes: 720 }", '{ date: 2026-11-26, kind: meeting, minutes: 60 }']),
]

test('the timesheet hours of a work package replace its hand-typed actual, and its deviation follows', async () => {
  const project = buildProject({
    path: '/p', project: PROJECT, products: [], timesheets: TIMESHEETS,
    workPackages: [wp('WP-01', 'actual: 14\n'), wp('WP-02'), wp('WP-03', 'actual: 3\n')],
  }, '2026-11-26')

  expect(project.workPackages.map(w => [w.id, w.tracked, w.actual, w.deviation])).toEqual([
    ['WP-01', 2, 2, 0],
    ['WP-02', 12, 12, 2],
    ['WP-03', null, 3, 0],
  ])
  expect(project.effort).toEqual({ stage: 1, estimate: 30, actual: 17, deviation: 2, counted: 3 })
  expect(project.time).toEqual({ hours: 15.75, byKind: { dev: 14, desk: 0.75, meeting: 1 }, people: ['dev1', 'pm'] })
  expect(project.errors).toEqual([])
})

test('a timesheet line without positive minutes is reported and left out; no timesheet, no time', async () => {
  const bad = sheet('pm', '2026-12', ["{ date: 2026-12-01, ref: '#85', wp: WP-01, kind: dev, minutes: lots }", '{ date: 2026-12-01, kind: desk, minutes: 30 }'])
  const project = buildProject({ path: '/p', project: PROJECT, products: [], timesheets: [bad], workPackages: [wp('WP-01', 'actual: 14\n')] }, '2026-12-01')

  expect(project.errors).toEqual(["timesheets/pm/2026-12.yaml: 2026-12-01 #85 minutes is not a positive number"])
  expect(project.workPackages[0].actual).toBe(14)
  expect(project.time).toEqual({ hours: 0.5, byKind: { desk: 0.5 }, people: ['pm'] })
  expect(buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-12-01').time).toBe(null)
})
