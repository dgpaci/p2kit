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

test('the Work packages tab groups the work packages by horizon and the generated roadmaps are under Documents, in the page and the pane', async ($, on) => {
  // wf:contract: No Roadmap tab: the Work packages tab groups them in blocks "Now", "Next", "Later" in project.roadmap order, then
  // wf:contract: "Not placed" with every other work package (open with no horizon, or closed); empty groups share one "Empty: …" line,
  // wf:contract: which points to /pm-roadmap while nothing is placed; with the helper every group shows, an empty one as a drop zone.
  // wf:contract: Pane: a bold "<group> · <n>" line per non-empty group, then its work packages, each with a move (placed) or place button.
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
  expect(script).not.toContain("['roadmap', ")
  expect(script).toContain("['wps', 'Work packages', p => p.workPackages.length, workPackages],")
  expect(script).toContain("const HORIZONS = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']]")
  expect(script).toContain("['Not placed', p.workPackages.filter(w => !placed.has(w.id))]")
  expect(script).toContain(`" — run /pm-roadmap in the project's repo to place them"`)
  expect(script).not.toContain('${')
  // Horizon and rank are set by drag and drop (issue #67): no select or rank input, one wp-place action.
  expect(script).not.toContain("'wp-horizon'")
  expect(script).not.toContain("'wp-rank'")
  expect(script).toContain("{ kind: 'wp-place', target: item.id, horizon, beside, side }")
  expect(script).toContain("draggable(p, tr, { kind: 'wp', ref: w.id, id: w.id, isPlaced:")
  // With the helper an empty horizon is still a group to drop on: nothing placed yet leaves Now, Next and Later empty.
  expect(script).toContain("groups.filter(g => canPlace || g[1].length)")
  expect(script).toContain("el('div', { className: 'drop-zone', textContent: 'Drop a work package here' })")

  // The pane, from a real read.
  mock.store(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  const written: Record<string, string> = {}
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  const asked: string[] = []
  // $.ui.ask is a call of the AskUserQuestion tool: answered here with "Now".
  on('tool.call', (_, e) => {
    const questions = (e as unknown as { questions: { question: string }[] }).questions
    asked.push(questions[0].question)
    return { result: { questions, answers: { [questions[0].question]: 'Now' } } }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(RUN)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/road' })
  expect(await ui.find({ type: 'Button', key: 'tab:roadmap' })).toBeFalsy()
  await ui.press({ key: 'tab:wps' })
  expect(await ui.find({ type: 'Text', text: 'Now · 2' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Later · 1' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Not placed · 1' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Next · 0' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'move:WP-01' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'move:WP-04', text: 'place WP-04' })).toBeTruthy()
  // The pane places by the desk helper's rule: last in Now, after WP-02 (rank 1) and WP-01 (rank 2).
  await ui.press({ key: 'move:WP-04' })
  expect(asked.at(-1)).toContain('Move WP-04 WP-04 title (off the roadmap) to? It goes last there')
  expect(written['/t/road/.pm/work-packages/WP-04.md']).toBe(wpText('WP-04', 'draft', 'horizon: now\nrank: 3\n'))
  await ui.press({ key: 'tab:documents' })
  expect(await ui.find({ type: 'Button', text: 'Roadmap · draft' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: 'Roadmap (external) · draft' })).toBeTruthy()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/plain' })
  await ui.press({ key: 'tab:wps' })
  expect(await ui.find({ type: 'Text', text: 'None yet.' })).toBeTruthy()
  await ui.unmount()
})
