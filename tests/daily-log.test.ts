import { expect, test } from 'claude-code/testing'

import { toForgeIssues, toForgePulls } from '../hooks/milestones'
import { buildProject } from '../hooks/project'

const PROJECT = 'name: Portal\nstage: { current: 2, name: Build, start: 2026-10-01 }\n'

const LOG = `entries:
  - { id: D-001, date: 2026-11-17, kind: event, source: forge, text: 'issue closed: Fix login', ref: '#41' }
  - { id: D-002, date: 2026-11-17, kind: decision, source: meeting, text: 'the export keeps the old layout' }
  - { id: D-003, date: 2026-11-17, kind: action, source: meeting, text: 'send the price list', owner: Marco Bianchi, due: 2026-11-19 }
  - { id: D-004, date: 2026-11-18, kind: action, text: "check the customer's server", due: 2026-11-30, status: open }
  - { id: D-005, date: 2026-11-18, kind: action, text: 'book the room', due: 2026-11-10, status: done, issue: 530 }
  - { id: D-006, date: 2026-11-18, kind: problem, text: 'test server down', register: I-004 }
`

test('the Daily Log gives its entries in file order, open actions past due as overdue, and the last log date', async () => {
  // wf:contract: buildProject reads registers/daily-log.yaml `entries`: each as a DailyEntry, '' for an absent text field,
  // wf:contract: issue null when absent; an action without status is open, any other kind has status ''; an open action
  // wf:contract: whose due is before today is overdue. `lastLog` is the latest date, '' with no log.
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], dailyLog: LOG }, '2026-11-20')
  expect(project.dailyLog.map(d => [d.id, d.kind, d.status, d.isOverdue])).toEqual([
    ['D-001', 'event', '', false],
    ['D-002', 'decision', '', false],
    ['D-003', 'action', 'open', true],
    ['D-004', 'action', 'open', false],
    ['D-005', 'action', 'done', false],
    ['D-006', 'problem', '', false],
  ])
  expect(project.dailyLog[0]).toEqual({
    id: 'D-001', date: '2026-11-17', kind: 'event', source: 'forge', text: 'issue closed: Fix login', owner: '', due: '', status: '',
    issue: null, register: '', ref: '#41', isOverdue: false,
  })
  expect(project.dailyLog[2].owner).toBe('Marco Bianchi')
  expect(project.dailyLog[3].text).toBe("check the customer's server")
  expect(project.dailyLog[4].issue).toBe(530)
  expect(project.dailyLog[5].register).toBe('I-004')
  expect(project.lastLog).toBe('2026-11-18')
  expect(project.errors).toEqual([])

  const none = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-11-20')
  expect(none.dailyLog).toEqual([])
  expect(none.lastLog).toBe('')
})

test('a broken Daily Log is one error and an empty list', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], dailyLog: 'entries:\n  - id: D-001\n      kind: note\n' }, '2026-11-20')
  expect(project.dailyLog).toEqual([])
  expect(project.errors.length).toBe(1)
  expect(project.errors[0]).toMatch(/^daily-log\.yaml: /)
})

test('open forge issues and pulls carry their creation day, the day /pm-log reads them as opened', async () => {
  // wf:contract: ForgeIssue and ForgePull carry createdAt, the ISO day of created_at, '' when the forge gave none.
  const issues = toForgeIssues([
    { number: 7, title: 'New', html_url: 'https://h/issues/7', state: 'open', updated_at: '2026-11-17T10:00:00Z', created_at: '2026-11-17T09:00:00Z', labels: [], assignees: [] },
    { number: 8, title: 'No creation', html_url: 'https://h/issues/8', state: 'open', updated_at: '2026-11-16T10:00:00Z', labels: [], assignees: [] },
  ] as never)
  expect(issues.map(i => [i.number, i.createdAt])).toEqual([[7, '2026-11-17'], [8, '']])
  const pulls = toForgePulls([
    { number: 9, title: 'PR', html_url: 'https://h/pull/9', state: 'open', updated_at: '2026-11-17T10:00:00Z', created_at: '2026-11-16T23:00:00Z' },
  ] as never)
  expect(pulls[0].createdAt).toBe('2026-11-16')
})
