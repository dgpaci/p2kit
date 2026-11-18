import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const PROJECT = 'name: Portal\nstage: { current: 2, name: Build, start: 2026-10-01 }\n'
const ITERATIONS = `iterations:
  - number: 1
    goal: Login
    start: 2026-10-27
    end: 2026-11-07
    status: closed
    work_packages: [WP-01]
    delivered: [WP-01]
    result: login shipped
  - number: 2
    goal: Checkout
    start: 2026-11-10
    end: 2026-11-21
    work_packages: [WP-01, WP-02]
`
const wpText = (id: string, status: string) => `---\nid: ${id}\ntitle: ${id} title\nstage: 2\nstatus: ${status}\n---\n`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/agile\n  - path: /t/plain\n',
  '/t/agile/.pm/project.yaml': PROJECT,
  '/t/agile/.pm/registers/iterations.yaml': ITERATIONS,
  '/t/agile/.pm/work-packages/WP-01.md': wpText('WP-01', 'completed'),
  '/t/agile/.pm/work-packages/WP-02.md': wpText('WP-02', 'in-progress'),
  '/t/plain/.pm/project.yaml': 'name: Plain\n',
}
const DIRS: Record<string, string[]> = { '/t/agile/.pm/work-packages': ['WP-01.md', 'WP-02.md'] }
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('the desk shows the current iteration in the row, the recap, Needs attention and an Iterations tab, in the page and the pane', async ($, on) => {
  // wf:contract: Overview row, browser page (hooks/board.ts overview facts) and pane (hooks/register.tsx overview), only when project.iteration is set:
  // wf:contract: "iteration <n> · <done>/<planned> WPs · ends <end>", placed right after the WPs fact; with isOverdue it is red and ends " overdue".
  // wf:contract: Recap: a card "Iteration" in the browser page, value "<n> · <done>/<planned>", sub "<goal> · ends <end>" (class err when overdue);
  // wf:contract: in the pane a recap line "Iteration <n> · <done>/<planned> WPs · ends <end> · <goal>", red when overdue. No card or line without an iteration.
  // wf:contract: Needs attention, page and pane: "Iteration <n> past its end (<end>)" when the current iteration is overdue.
  // wf:contract: An "Iterations" section of the Registers tab (board.ts REGISTERS and register.tsx tabs), its subtitle the
  // wf:contract: number of iterations; newest first, columns #, Goal, Dates ("<start> → <end>"), WPs (done/planned for the open one, delivered
  // wf:contract: count for a closed one), Status, Result; with none, the register is named on the "Empty: …" line with /pm-iterate. The pane shows one line per iteration with the same fields.
  // wf:contract: The page script still contains no "${" and passes node --check; the pane state shape becomes projects-10.
  // The page: the open iteration is embedded with its progress; the row fact, card, attention line and tab are in the script.
  const files = (path: string) => ({
    path, project: FILES[`${path}/.pm/project.yaml`], products: [], iterations: FILES[`${path}/.pm/registers/iterations.yaml`],
    workPackages: (DIRS[`${path}/.pm/work-packages`] ?? []).map(name => ({ path: `${path}/.pm/work-packages/${name}`, text: FILES[`${path}/.pm/work-packages/${name}`]! })),
  })
  const agile = buildProject(files('/t/agile'), '2026-11-25')
  expect(agile.iteration).toMatchObject({ number: 2, done: 1, planned: 2, isOverdue: true })
  const page = renderBoard({ projects: [agile, buildProject(files('/t/plain'), '2026-11-25')], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].iteration).toEqual(agile.iteration)
  expect(data.projects[1].iteration).toBe(null)
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toMatch(/'WPs ', progressOf\(p\)\),\n\s+p\.iteration \? iterationFact\(p\.iteration\) : null,/)
  expect(script).toContain("'iteration ' + it.number + ' · ' + it.done + '/' + it.planned + ' WPs · ends '")
  expect(script).toContain("' overdue'")
  expect(script).toContain("p.iteration ? card('Iteration', p.iteration.number + ' · ' + p.iteration.done + '/' + p.iteration.planned, p.iteration.goal + ' · ends '")
  expect(script).toContain("'Iteration ' + p.iteration.number + ' past its end (' + p.iteration.end + ')'")
  expect(script).toContain("['iterations', 'Iterations', p => p.iterations.length, p => String(p.iterations.length), '/pm-iterate', iterations],")
  for (const label of ["'#', 'Goal', 'Dates', 'WPs', 'Status', 'Result'", "' → '", "'No iteration.'", 'it.delivered.length']) expect(script).toContain(label)
  expect(script).not.toContain('${')

  // The pane, from a real read on 2026-11-25: Agile's iteration 2 ended on 2026-11-21, Plain has no register.
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
  expect(await ui.find({ type: 'Text', text: 'iteration 2 · 1/2 WPs · ends 2026-11-21 overdue' })).toBeTruthy()
  await ui.press({ key: 'open:/t/agile' })
  expect(await ui.find({ type: 'Text', text: 'Iteration 2 · 1/2 WPs · ends 2026-11-21 · Checkout' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Iteration 2 past its end (2026-11-21)' })).toBeTruthy()
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: 'Iterations · 2' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '#2 · Checkout · 2026-11-10 → 2026-11-21 · WPs 1/2 · open' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '#1 · Login · 2026-10-27 → 2026-11-07 · WPs 1 · closed · login shipped' })).toBeTruthy()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/plain' })
    expect(await ui.find({ type: 'Text', text: 'Iteration 2 · 1/2 WPs · ends 2026-11-21 · Checkout' })).toBeFalsy()
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: /^Empty: .*Iterations \(\/pm-iterate\)/ })).toBeTruthy()
  await ui.unmount()
})
