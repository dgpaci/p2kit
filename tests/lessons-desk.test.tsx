import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const LESSONS = `retrospectives:
  - { date: 2026-11-07, iteration: 1, stage: 2 }
  - { date: 2026-11-21, iteration: 2, stage: 2 }
lessons:
  - { id: L-001, date: 2026-11-07, iteration: 1, kind: keep, text: 'short daily sync' }
  - { id: L-002, date: 2026-11-21, iteration: 2, kind: change, text: 'review pull requests within a day' }
actions:
  - { id: A-001, date: 2026-11-07, text: 'add a review reminder', issue: 512, status: done }
  - { id: A-002, date: 2026-11-21, text: 'split the checkout work package', issue: 520 }
  - { id: A-003, date: 2026-11-21, text: 'pair on the payment API' }
`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/agile\n  - path: /t/plain\n',
  '/t/agile/.pm/project.yaml': 'name: Portal\nstage: { current: 2, name: Build, start: 2026-10-01 }\n',
  '/t/agile/.pm/registers/lessons.yaml': LESSONS,
  '/t/plain/.pm/project.yaml': 'name: Plain\n',
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('the desk shows the date of the last retrospective and a Lessons tab, in the page and the pane', async ($, on) => {
  // wf:contract: Overview row, browser page and pane: no "last retro", "next report" or "open issues" fact; the pane row reads "high risks <n>".
  // wf:contract: Recap, page and pane: in Needs attention one line per open action, "<id> <text>" followed by " #<issue>" when it has one.
  // wf:contract: A "Lessons" section of the Registers tab (board.ts REGISTERS and register.tsx tabs), its subtitle "<n> open actions".
  // wf:contract: Its body, in this order: "Last retrospective <date>" (or "No retrospective yet."); the actions, open first, with id, text,
  // wf:contract: issue (a link to the forge issue on the page when the origin is a forge, "#<n>" in the pane) and status; then the lessons,
  // wf:contract: newest first, with date, iteration, kind (keep | change) and text. The pane shows one line per action and per lesson with the same fields.
  // wf:contract: The page script still contains no "${" and passes node --check; the pane state shape becomes projects-11.
  // The page: the Lessons Log is embedded; the row fact, attention lines and tab are in the script.
  const files = (path: string) => ({ path, project: FILES[`${path}/.pm/project.yaml`], products: [], workPackages: [], lessons: FILES[`${path}/.pm/registers/lessons.yaml`] })
  const agile = buildProject(files('/t/agile'), '2026-11-25')
  const page = renderBoard({ projects: [agile, buildProject(files('/t/plain'), '2026-11-25')], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].lastRetro).toBe('2026-11-21')
  expect(data.projects[0].actions).toEqual(agile.actions)
  expect(data.projects[1].lastRetro).toBe('')
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  for (const gone of ["'last retro '", "'next report '", "'open issues '"]) expect(script).not.toContain(gone)
  expect(script).toContain("...openActions(p).map(a => el('div', { textContent: actionText(a) })),")
  expect(script).toContain("a.id + ' ' + a.text + (a.issue === null ? '' : ' #' + a.issue)")
  expect(script).toContain("p => openActions(p).length + ' open actions', '/pm-retro', lessons],")
  for (const label of ["'Last retrospective '", "'No retrospective yet.'", "'', 'Action', 'Issue', 'Status'", "'Date', 'Iteration', 'Kind', 'Lesson'", "'/issues/' + number"]) expect(script).toContain(label)
  expect(script).not.toContain('${')

  // The pane, from a real read: Portal has two open actions, Plain has no Lessons Log.
  mock.store(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(RUN)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'high risks 0' })).toBeTruthy()
  await ui.press({ key: 'open:/t/agile' })
  expect(await ui.find({ type: 'Text', text: 'A-002 split the checkout work package #520' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'A-003 pair on the payment API' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'A-001 add a review reminder #512' })).toBeFalsy()
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: 'Lessons · 2 open actions' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Last retrospective 2026-11-21' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'A-002 · split the checkout work package · #520 · open' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'A-001 · add a review reminder · #512 · done' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '2026-11-21 · iteration 2 · change · review pull requests within a day' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '2026-11-07 · iteration 1 · keep · short daily sync' })).toBeTruthy()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/plain' })
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: /^Empty: .*Lessons \(\/pm-retro\)/ })).toBeTruthy()
  await ui.unmount()
})
