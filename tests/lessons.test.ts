import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

const PROJECT = 'name: Portal\nprofile: agile\nstatus: delivery\nstage: { current: 2, name: Build, start: 2026-10-01 }\n'

const LESSONS = `retrospectives:
  - { date: 2026-11-07, iteration: 1, stage: 2 }
  - { date: 2026-11-21, iteration: 2, stage: 2 }
lessons:
  - { id: L-001, date: 2026-11-07, iteration: 1, kind: keep, text: 'short daily sync' }
  - { id: L-002, date: 2026-11-07, iteration: 1, kind: change, text: 'review pull requests within a day' }
actions:
  - { id: A-001, date: 2026-11-07, text: 'add a review reminder', issue: 512, status: done }
  - { id: A-002, date: 2026-11-21, text: 'split the checkout work package' }
`

test('the Lessons Log gives the retrospectives, lessons and actions in file order and the date of the last retrospective', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], lessons: LESSONS }, '2026-11-21')

  expect(project.lastRetro).toBe('2026-11-21')
  expect(project.retrospectives).toEqual([
    { date: '2026-11-07', iteration: 1, stage: 2 },
    { date: '2026-11-21', iteration: 2, stage: 2 },
  ])
  expect(project.lessons).toEqual([
    { id: 'L-001', date: '2026-11-07', iteration: 1, kind: 'keep', text: 'short daily sync' },
    { id: 'L-002', date: '2026-11-07', iteration: 1, kind: 'change', text: 'review pull requests within a day' },
  ])
  // An action without issue has issue null; without status it is open.
  expect(project.actions).toEqual([
    { id: 'A-001', date: '2026-11-07', text: 'add a review reminder', issue: 512, status: 'done' },
    { id: 'A-002', date: '2026-11-21', text: 'split the checkout work package', issue: null, status: 'open' },
  ])
  expect(project.errors).toEqual([])
})

test('the last retrospective is the latest date, whatever the order; none gives an empty date', async () => {
  const shuffled = 'retrospectives:\n  - { date: 2026-11-21 }\n  - { date: 2026-11-07 }\n'
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], lessons: shuffled }, '2026-11-21')
  expect(project.lastRetro).toBe('2026-11-21')
  expect(project.retrospectives[0]).toEqual({ date: '2026-11-21', iteration: null, stage: null })

  const none = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-11-21')
  expect([none.lastRetro, none.retrospectives, none.lessons, none.actions]).toEqual(['', [], [], []])
  expect(none.errors).toEqual([])
})

test('a broken Lessons Log is one error, not one per list', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], lessons: 'lessons:\n  - id: L-001\n      kind: keep\n' }, '2026-11-21')
  expect(project.errors.filter(error => error.startsWith('lessons.yaml: '))).toHaveLength(1)
  expect(project.lessons).toEqual([])
  expect(project.name).toBe('Portal')
})
