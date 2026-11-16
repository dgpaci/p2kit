import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

const PROJECT = 'name: Portal\nprofile: agile\nstatus: delivery\nstage: { current: 2, name: Build, start: 2026-10-01 }\n'

const wp = (id: string, status: string) => ({
  path: `/p/.pm/work-packages/${id}.md`,
  text: `---\nid: ${id}\ntitle: ${id} title\nstage: 2\nstatus: ${status}\n---\n`,
})
const WPS = [wp('WP-01', 'completed'), wp('WP-02', 'in-progress'), wp('WP-03', 'cancelled'), wp('WP-04', 'completed')]

const ITERATIONS = `iterations:
  - number: 2
    goal: Checkout end to end
    start: 2026-11-10
    end: 2026-11-21
    stage: 2
    status: open
    work_packages: [WP-01, WP-02, WP-03]
  - number: 1
    goal: Login
    start: 2026-10-27
    end: 2026-11-07
    stage: 2
    status: closed
    work_packages: [WP-04]
    delivered: [WP-04]
    result: login shipped to staging
`

test('the iterations register gives every iteration by number and the open one with its progress', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS, iterations: ITERATIONS }, '2026-11-16')

  expect(project.profile).toBe('agile')
  expect(project.iterations).toEqual([
    { number: 1, goal: 'Login', start: '2026-10-27', end: '2026-11-07', stage: 2, status: 'closed', workPackages: ['WP-04'], delivered: ['WP-04'], result: 'login shipped to staging' },
    { number: 2, goal: 'Checkout end to end', start: '2026-11-10', end: '2026-11-21', stage: 2, status: 'open', workPackages: ['WP-01', 'WP-02', 'WP-03'], delivered: [], result: '' },
  ])
  // done: its completed work packages; planned: its work packages that are not cancelled.
  expect(project.iteration).toEqual({ ...project.iterations[1], done: 1, planned: 2, isOverdue: false })
  expect(project.errors).toEqual([])
})

test('an iteration past its end is overdue; two open ones and an unknown work package are errors', async () => {
  const two = `iterations:
  - number: 3
    goal: A
    start: 2026-11-01
    end: 2026-11-14
    work_packages: [WP-01, WP-09]
  - number: 4
    goal: B
    start: 2026-11-15
    end: 2026-11-15
    status: open
    work_packages: [WP-02]
`
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS, iterations: two }, '2026-11-16')

  // A missing status reads as open; with two open, the current one is the highest number.
  expect(project.iterations.map(one => one.status)).toEqual(['open', 'open'])
  expect(project.iteration?.number).toBe(4)
  expect(project.iteration?.isOverdue).toBe(true)
  expect(project.iteration?.stage).toBe(null)
  expect(project.errors).toContain('iterations: more than one open (3, 4)')
  expect(project.errors).toContain('iterations: 3: unknown work package WP-09')
})

test('no register means no iteration; a broken one is an error and the project still loads', async () => {
  const none = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS }, '2026-11-16')
  expect(none.iterations).toEqual([])
  expect(none.iteration).toBe(null)
  expect(none.errors).toEqual([])

  const broken = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WPS, iterations: 'iterations:\n  - number: 1\n      goal: x\n' }, '2026-11-16')
  expect(broken.iterations).toEqual([])
  expect(broken.errors.filter(error => error.startsWith('iterations.yaml: '))).toHaveLength(1)
  expect(broken.name).toBe('Portal')
})
