import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const wpText = (id: string, status: string, extra: string) => `---\nid: ${id}\ntitle: ${id} title\nstage: 2\nstatus: ${status}\n${extra}---\n`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/road\n  - path: /t/plain\n',
  '/t/road/.pm/project.yaml': 'name: Road\nstage: { current: 2, name: Build, start: 2026-10-01 }\n',
  '/t/road/.pm/roadmap.md': '---\nproduct: roadmap\ntitle: Roadmap\nstatus: draft\n---\n',
  '/t/road/.pm/roadmap-external.md': '---\nproduct: roadmap\ntitle: Roadmap (external)\nstatus: draft\n---\n',
  '/t/road/.pm/work-packages/WP-01.md': wpText('WP-01', 'in-progress', 'horizon: now\nrank: 2\ndue: 2026-12-01\n'),
  '/t/road/.pm/work-packages/WP-02.md': wpText('WP-02', 'authorized', 'horizon: now\nrank: 1\n'),
  '/t/road/.pm/work-packages/WP-03.md': wpText('WP-03', 'draft', 'horizon: later\n'),
  '/t/road/.pm/work-packages/WP-04.md': wpText('WP-04', 'draft', ''),
  '/t/plain/.pm/project.yaml': 'name: Plain\n',
}
const DIRS: Record<string, string[]> = {
  '/t/road/.pm': ['roadmap.md', 'roadmap-external.md'],
  '/t/road/.pm/work-packages': ['WP-01.md', 'WP-02.md', 'WP-03.md', 'WP-04.md'],
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('the desk shows the roadmap in a Roadmap tab and the generated roadmaps under Documents, in the page and the pane', async ($, on) => {
  // wf:contract: A tab with id "roadmap", label "Roadmap", right after "Lessons" (board.ts TABS and register.tsx tabs), its count the
  // wf:contract: work packages placed in a horizon (now + next + later).
  // wf:contract: Page body: three blocks titled "Now", "Next", "Later", in that order, each a table with columns '', Title, Stage, Status, Due
  // wf:contract: (the id links to the work package file), in project.roadmap order; an empty horizon reads "Nothing planned.";
  // wf:contract: then, when project.roadmap.unplaced is not empty, "Not on the roadmap: <id>, <id>"; with no work package in any list,
  // wf:contract: "No roadmap yet: run /pm-roadmap in the project's repo."
  // wf:contract: Pane: one line per placed work package "<Now|Next|Later> · <id> <title> · <status>" followed by " · due <due>" when it has one,
  // wf:contract: the same "Not on the roadmap: …" and "No roadmap yet: run /pm-roadmap in the project's repo." lines.
  // wf:contract: .pm/roadmap.md and .pm/roadmap-external.md, when present, are listed under Documents like every other .pm product.
  // wf:contract: The page script still contains no "${" and passes node --check; the pane state shape becomes projects-13.
  const files = (path: string) => ({
    path, project: FILES[`${path}/.pm/project.yaml`],
    products: (DIRS[`${path}/.pm`] ?? []).map(name => ({ path: `${path}/.pm/${name}`, text: FILES[`${path}/.pm/${name}`]! })),
    workPackages: (DIRS[`${path}/.pm/work-packages`] ?? []).map(name => ({ path: `${path}/.pm/work-packages/${name}`, text: FILES[`${path}/.pm/work-packages/${name}`]! })),
  })
  const road = buildProject(files('/t/road'), '2026-11-25')
  expect(road.roadmap).toEqual({ now: ['WP-02', 'WP-01'], next: [], later: ['WP-03'], unplaced: ['WP-04'] })
  expect(road.documents.map(d => d.title)).toEqual(['Roadmap', 'Roadmap (external)'])
  const page = renderBoard({ projects: [road, buildProject(files('/t/plain'), '2026-11-25')], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].roadmap).toEqual(road.roadmap)
  expect(data.projects[1].roadmap).toEqual({ now: [], next: [], later: [], unplaced: [] })
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toMatch(/\['lessons', 'Lessons', [^\n]*\n {2}\['roadmap', 'Roadmap', placedCount, roadmap\],/)
  expect(script).toContain("const HORIZONS = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']]")
  expect(script).toContain('p.roadmap.now.length + p.roadmap.next.length + p.roadmap.later.length')
  expect(script).toContain("tableOf(['', 'Title', 'Stage', 'Status', 'Due'], wps(p.roadmap[key]).map(w => [fileLink(w.path, w.id),")
  expect(script).toContain("'Nothing planned.'")
  expect(script).toContain("'Not on the roadmap: ' + p.roadmap.unplaced.join(', ')")
  expect(script).toContain(`"No roadmap yet: run /pm-roadmap in the project's repo."`)
  expect(script).not.toContain('${')

  // The pane, from a real read.
  mock.store(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(RUN)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/road' })
  expect(await ui.find({ type: 'Button', key: 'tab:roadmap', text: 'Roadmap 3' })).toBeTruthy()
  await ui.press({ key: 'tab:roadmap' })
  expect(await ui.find({ type: 'Text', text: 'Now · WP-02 WP-02 title · authorized' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Now · WP-01 WP-01 title · in-progress · due 2026-12-01' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Later · WP-03 WP-03 title · draft' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Not on the roadmap: WP-04' })).toBeTruthy()
  await ui.press({ key: 'tab:documents' })
  expect(await ui.find({ type: 'Button', text: 'Roadmap · draft' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: 'Roadmap (external) · draft' })).toBeTruthy()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/plain' })
  expect(await ui.find({ type: 'Button', key: 'tab:roadmap', text: 'Roadmap 0' })).toBeTruthy()
  await ui.press({ key: 'tab:roadmap' })
  expect(await ui.find({ type: 'Text', text: "No roadmap yet: run /pm-roadmap in the project's repo." })).toBeTruthy()
  await ui.unmount()
})
