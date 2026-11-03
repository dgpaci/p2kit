import { expect, mock, test } from 'claude-code/testing'

// One registered project, as the fake file system holds it.
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /src/portal\n  - path: /src/gone\n',
  '/src/portal/.pm/project.yaml':
    'name: Portal\nstatus: delivery\nstage: { current: 2, name: Build }\nroles:\n  executive: Anna\ntolerances:\n  cost: { limit: 10, used: 12, unit: EUR }\n',
  '/src/portal/.pm/brief.md': '---\ntitle: Project Brief\nstatus: approved\n---\n',
  '/src/portal/.pm/work-packages/WP-01.md': '---\nid: WP-01\ntitle: Login\nstage: 2\nstatus: completed\n---\n',
  '/src/portal/.pm/registers/risks.yaml': 'risks:\n  - { id: R-1, title: API change, probability: high, impact: high, status: open }\n',
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/src/portal/.pm': [{ name: 'project.yaml', kind: 'file' }, { name: 'brief.md', kind: 'file' }, { name: 'work-packages', kind: 'dir' }],
  '/src/portal/.pm/work-packages': [{ name: 'WP-01.md', kind: 'file' }],
}

const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the overview lists the registered projects and Details drills into one', async ($, on) => {
  const opened: string[] = []
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    opened.push(e.argv[1])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ran = await $.command.run({ command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(ran.text).toStartWith('2 registered projects.')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'Portal' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /▓{10} 1\/1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /\.pm\/project\.yaml not found/ })).toBeTruthy()

  await ui.press({ key: 'open:/src/portal' })
  expect(await ui.find({ type: 'Text', text: 'Executive: Anna' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /R-1 \[9\] API change/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'cost: 12 / 10 EUR' })).toBeTruthy()

  await ui.press({ key: 'doc:/src/portal/.pm/brief.md' })
  expect(opened).toContain('/src/portal/.pm/brief.md')

  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 'open:/src/gone' })).toBeTruthy()
  await ui.unmount()
})
