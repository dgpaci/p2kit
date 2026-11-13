import { expect, mock, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

const files = (stage: string) => ({
  path: '/p',
  project: `name: Ops\nstatus: delivery\nstage: ${stage}\n`,
  products: [],
  workPackages: [],
})

test('a stage is not continuous unless project.yaml says so; a non-boolean value is an error', () => {
  const plain = buildProject(files('{ current: 2, name: Build, start: 2026-10-01, planned_end: 2026-12-15 }'), '2026-11-13')
  expect(plain.stage.isContinuous).toBe(false)
  expect(plain.errors).toEqual([])

  const continuous = buildProject(files('{ current: 1, name: Delivery, start: 2026-01-10, continuous: true }'), '2026-11-13')
  expect(continuous.stage.isContinuous).toBe(true)
  expect(continuous.stage.plannedEnd).toBe('')
  expect(continuous.errors).toEqual([])

  const wrong = buildProject(files('{ current: 1, continuous: yes }'), '2026-11-13')
  expect(wrong.stage.isContinuous).toBe(false)
  expect(wrong.errors).toContain('stage.continuous: expected true or false')
})

// One registered project with a continuous stage: two work packages open, one completed, one cancelled.
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /src/ops\n',
  '/src/ops/.pm/project.yaml': 'name: Ops\nstatus: delivery\nstage: { current: 1, name: Delivery, start: 2026-01-10, continuous: true }\n',
  '/src/ops/.pm/work-packages/WP-01.md': '---\nid: WP-01\ntitle: One\nstage: 1\nstatus: completed\n---\n',
  '/src/ops/.pm/work-packages/WP-02.md': '---\nid: WP-02\ntitle: Two\nstage: 1\nstatus: in-progress\n---\n',
  '/src/ops/.pm/work-packages/WP-03.md': '---\nid: WP-03\ntitle: Three\nstage: 1\nstatus: authorized\n---\n',
  '/src/ops/.pm/work-packages/WP-04.md': '---\nid: WP-04\ntitle: Four\nstage: 1\nstatus: cancelled\n---\n',
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/src/ops/.pm': [{ name: 'project.yaml', kind: 'file' }, { name: 'work-packages', kind: 'dir' }],
  '/src/ops/.pm/work-packages': ['WP-01.md', 'WP-02.md', 'WP-03.md', 'WP-04.md'].map(name => ({ name, kind: 'file' as const })),
}

const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('a continuous stage shows open and completed work packages, with no percentage and no end, in the pane', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  const ran = await $.command.run({ command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(ran.text).toStartWith('1 registered projects.')

  const ui = await $.ui.mount(PANE)
  // Overview.
  expect(await ui.find({ type: 'Text', text: '2 open · 1 completed' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /[▓░]/ })).toBeFalsy()

  // Recap.
  await ui.press({ key: 'open:/src/ops' })
  expect(await ui.find({ type: 'Text', text: 'Stage 1 · Delivery · since 2026-01-10 · continuous' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^2 open · 1 completed · / })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /[▓░]/ })).toBeFalsy()

  // Work packages tab.
  await ui.press({ key: 'tab:wps' })
  expect(await ui.find({ type: 'Text', text: '2 open · 1 completed' })).toBeTruthy()
})
