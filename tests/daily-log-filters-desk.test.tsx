import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const LOG = `entries:
  - { id: D-001, date: 2026-11-17, kind: event, source: forge, text: 'issue closed: Fix login', ref: '#41' }
  - { id: D-002, date: 2026-11-17, kind: decision, source: meeting, text: 'keep the old layout' }
  - { id: D-003, date: 2026-11-18, kind: action, source: manual, text: 'book the room', status: done }
  - { id: D-004, date: 2026-11-18, kind: problem, text: 'test server down' }
  - { id: D-005, date: 2026-11-19, kind: note, text: 'Marco on holiday' }
  - { id: D-006, date: 2026-11-19, kind: action, text: 'send the price list', due: 2026-11-19 }
`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/logged\n',
  '/t/logged/.pm/project.yaml': 'name: Portal\nstage: { current: 2, name: Build, start: 2026-10-01 }\n',
  '/t/logged/.pm/registers/daily-log.yaml': LOG,
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } } as const

test('the Daily log tells its kinds apart and filters by day, kind and text, in the page and the pane', async ($, on) => {
  // wf:contract: Page: each entry's kind is a pill with class kind-<kind>, coloured per kind; its source a symbol (⑂ forge, ◎ meeting, ✎ manual).
  // wf:contract: Page: a filter bar heads the list (a day select, a chip per kind present, a search box) and redraws only the list.
  // wf:contract: Page: while a log filter is set the page does not reload itself; another project starts unfiltered.
  // wf:contract: Pane: a log line takes its kind's colour (decision cyan, action yellow, problem magenta, note green); an overdue action stays red.
  const files = (path: string) => ({ path, project: FILES[`${path}/.pm/project.yaml`], products: [], workPackages: [], dailyLog: FILES[`${path}/.pm/registers/daily-log.yaml`] })
  const page = renderBoard({ projects: [buildProject(files('/t/logged'), '2026-11-20')], refreshedAt: NOW, errors: [] })
  const style = page.slice(page.indexOf('<style>') + 7, page.indexOf('</style>'))
  for (const kind of ['decision', 'action', 'problem', 'note']) expect(style).toContain(`.pill.kind-${kind} {`)
  expect(style).toContain('.log-filters {')

  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toContain("const LOG_KINDS = ['event', 'decision', 'action', 'problem', 'note']")
  expect(script).toContain("const LOG_SOURCES = { forge: ['⑂', 'from the forge'], meeting: ['◎', 'from a meeting'], manual: ['✎', 'from notes'] }")
  expect(script).toContain("pill(d.kind || '—', 'kind-' + d.kind)")
  expect(script).toContain("el('div', { className: 'log-filters' }, day, ...chips, search, count, clear), list)")
  expect(script).toContain("placeholder: 'Search the log'")
  expect(script).toContain("'No entry matches the filters.'")
  expect(script).toContain('if (logFor !== p.path) {')
  // The search splits on whitespace: the template literal must keep the backslash.
  expect(script).toContain('.split(/\\s+/)')
  expect(script).toContain('if (dialogOpen || dragging) return; if (isLogFiltered()) return; if (!pickedItems.size) location.reload()')
  expect(script).not.toContain('${')

  // The pane, from a real read. ui.find ignores a color key: the colour is read from the found element's props.
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
  await ui.press({ key: 'tab:registers' })
  expect((await ui.find({ type: 'Text', text: 'D-002 · decision · keep the old layout' }))?.props.color).toBe('cyan')
  expect((await ui.find({ type: 'Text', text: 'D-003 · action · book the room · done' }))?.props.color).toBe('yellow')
  expect((await ui.find({ type: 'Text', text: 'D-004 · problem · test server down' }))?.props.color).toBe('magenta')
  expect((await ui.find({ type: 'Text', text: 'D-005 · note · Marco on holiday' }))?.props.color).toBe('green')
  expect((await ui.find({ type: 'Text', text: 'D-006 · action · send the price list · due 2026-11-19 · open' }))?.props.color).toBe('red')
  await ui.unmount()
})
