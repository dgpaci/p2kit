import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const LOG = `entries:
  - { id: D-001, date: 2026-11-17, kind: event, source: forge, text: 'issue closed: Fix login', ref: '#41' }
  - { id: D-002, date: 2026-11-17, kind: action, source: meeting, text: 'send the price list', owner: Marco Bianchi, due: 2026-11-19 }
  - { id: D-003, date: 2026-11-18, kind: action, text: 'book the room', status: done }
  - { id: D-004, date: 2026-11-18, kind: problem, text: 'test server down', register: I-004 }
`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/logged\n  - path: /t/plain\n',
  '/t/logged/.pm/project.yaml': 'name: Portal\nstage: { current: 2, name: Build, start: 2026-10-01 }\n',
  '/t/logged/.pm/registers/daily-log.yaml': LOG,
  '/t/plain/.pm/project.yaml': 'name: Plain\n',
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } } as const

test('the desk shows a Daily log tab and the overdue actions, in the page and the pane', async ($, on) => {
  // wf:contract: The Daily log is the last section of the Registers tab (board.ts REGISTERS, register.tsx registers), headed "Daily log · <n> open actions" (#75).
  // wf:contract: Its body: a block per day, newest first, the entries in file order; with no log it is named on the "Empty: …" line with /pm-log.
  // wf:contract: Recap, page and pane: in Needs attention one red line per overdue action, "<id> <text> · <owner> · due <due>" (owner part only when set).
  // wf:contract: The page script still contains no "${"; the pane state shape becomes projects-15.
  const files = (path: string) => ({ path, project: FILES[`${path}/.pm/project.yaml`], products: [], workPackages: [], dailyLog: FILES[`${path}/.pm/registers/daily-log.yaml`] })
  const logged = buildProject(files('/t/logged'), '2026-11-20')
  const page = renderBoard({ projects: [logged, buildProject(files('/t/plain'), '2026-11-20')], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].dailyLog).toEqual(logged.dailyLog)
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toContain("['log', 'Daily log', p => logOf(p).length, p => openLogActions(p).length + ' open actions', '/pm-log', dailyLog],\n]")
  expect(script).toContain("...logOf(p).filter(d => d.isOverdue)")
  expect(script).not.toContain('${')

  // The pane, from a real read: Portal has one open action, overdue; Plain has no Daily Log.
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
  await ui.press({ key: 'open:/t/logged' })
  expect(await ui.find({ type: 'Text', text: 'D-002 send the price list · Marco Bianchi · due 2026-11-19' })).toBeTruthy()
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: 'Daily log · 1 open actions' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '2026-11-18' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'D-001 · event · issue closed: Fix login · #41' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'D-002 · action · send the price list · Marco Bianchi · due 2026-11-19 · open' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'D-003 · action · book the room · done' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'D-004 · problem · test server down · → I-004' })).toBeTruthy()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/plain' })
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: /^Empty: .*Daily log \(\/pm-log\)/ })).toBeTruthy()
  await ui.press({ key: 'tab:documents' })
  expect(await ui.find({ type: 'Text', text: /^Daily log/ })).toBeFalsy()
  await ui.unmount()
})
