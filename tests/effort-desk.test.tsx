import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const PROJECT = `name: Portal
stage: { current: 2, name: Build, start: 2026-10-01 }
tolerances:
  effort: { limit: 4, used: 1, unit: hours }
`
const wpText = (id: string, status: string, extra: string) => `---\nid: ${id}\ntitle: ${id} title\nstage: 2\nstatus: ${status}\n${extra}---\n`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/effort\n  - path: /t/plain\n',
  '/t/effort/.pm/project.yaml': PROJECT,
  '/t/effort/.pm/work-packages/WP-01.md': wpText('WP-01', 'completed', 'estimate: 10\nactual: 14\n'),
  '/t/effort/.pm/work-packages/WP-02.md': wpText('WP-02', 'in-progress', 'estimate: 8\n'),
  '/t/plain/.pm/project.yaml': 'name: Plain\ntolerances:\n  time: { limit: 10, used: 2, unit: days }\n',
}
const DIRS: Record<string, string[]> = { '/t/effort/.pm/work-packages': ['WP-01.md', 'WP-02.md'] }
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('the desk shows the stage effort in the row, the computed tolerance in the recap and the figures in the Work packages tab, in the page and the pane', async ($, on) => {
  // wf:contract: Overview row, browser page (hooks/board.ts overview facts) and pane (hooks/register.tsx overview), only when project.effort is set:
  // wf:contract: "effort <actual>/<estimate>h <deviation>h", the deviation signed ("+4h", "0h", "-3h"), placed right after the iteration fact;
  // wf:contract: red (class err on the page, red text in the pane) when the "effort" tolerance is red. No fact without project.effort.
  // wf:contract: Recap Tolerances, page and pane: a tolerance with isComputed true reads "<used> / <limit> <unit> · from work packages".
  // wf:contract: Work packages tab, page: columns "Estimate", "Actual", "Deviation" after "Due" (hours, '' when null, the deviation signed),
  // wf:contract: only when some work package has an estimate or an actual;
  // wf:contract: above the table, when project.effort is set, "Stage <stage> effort: <actual>h of <estimate>h, deviation <signed>h over <counted> work packages".
  // wf:contract: Pane: the same stage line under the progress bar, and each work package line ends "est <e>h · act <a>h · <signed>h" for the figures it has.
  // wf:contract: The page script still contains no "${" and passes node --check; the pane state shape becomes projects-12.
  const files = (path: string) => ({
    path, project: FILES[`${path}/.pm/project.yaml`], products: [],
    workPackages: (DIRS[`${path}/.pm/work-packages`] ?? []).map(name => ({ path: `${path}/.pm/work-packages/${name}`, text: FILES[`${path}/.pm/work-packages/${name}`]! })),
  })
  // WP-01 overran by 4h of a 4h limit: the effort tolerance is red.
  const effort = buildProject(files('/t/effort'), '2026-11-25')
  expect(effort.effort).toEqual({ stage: 2, estimate: 10, actual: 14, deviation: 4, counted: 1 })
  expect(effort.tolerances).toEqual([{ area: 'effort', limit: 4, used: 4, unit: 'hours', light: 'red', isComputed: true }])
  const page = renderBoard({ projects: [effort, buildProject(files('/t/plain'), '2026-11-25')], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].effort).toEqual(effort.effort)
  expect(data.projects[1].effort).toBe(null)
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toMatch(/p\.iteration \? iterationFact\(p\.iteration\) : null,\n\s+p\.effort \? effortFact\(p\) : null,/)
  expect(script).toContain("'effort ' + p.effort.actual + '/' + p.effort.estimate + 'h ' + signed(p.effort.deviation)")
  expect(script).toContain("className: effortRed(p) ? 'err' : ''")
  expect(script).toContain("t.area === 'effort' && t.light === 'red'")
  expect(script).toContain("(n > 0 ? '+' : '') + n + 'h'")
  expect(script).toContain("(t.isComputed ? ' · from work packages' : '')")
  expect(script).toContain("'Due', ...(hasEffort ? ['Estimate', 'Actual', 'Deviation'] : []), 'Link'")
  expect(script).toContain("'Stage ' + e.stage + ' effort: ' + e.actual + 'h of ' + e.estimate + 'h, deviation ' + signed(e.deviation) + ' over ' + e.counted + ' work packages'")
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
  const fact = await ui.find({ type: 'Text', text: 'effort 14/10h +4h' })
  expect(fact).toBeTruthy()
  expect(fact?.props.color).toBe('red')
  await ui.press({ key: 'open:/t/effort' })
  expect(await ui.find({ type: 'Text', text: 'effort: 4 / 4 hours · from work packages' })).toBeTruthy()
  await ui.press({ key: 'tab:wps' })
  expect(await ui.find({ type: 'Text', text: 'Stage 2 effort: 14h of 10h, deviation +4h over 1 work packages' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'est 10h · act 14h · +4h' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'est 8h' })).toBeTruthy()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: 'effort 14/10h +4h' })).toBeTruthy()
  await ui.press({ key: 'open:/t/plain' })
  expect(await ui.find({ type: 'Text', text: 'time: 2 / 10 days' })).toBeTruthy()
  await ui.press({ key: 'tab:wps' })
  expect(await ui.find({ type: 'Text', text: 'Stage 2 effort: 14h of 10h, deviation +4h over 1 work packages' })).toBeFalsy()
  await ui.unmount()
})
