import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const NOW = Date.parse('2026-11-23T12:00:00Z')
const RISKS = `risks:
  - { id: R-001, title: Branch staff keep the old procedure, probability: medium, impact: high, status: open, response: reduce, response_actions: "advance circular, inline manuals", verdict: adequate, verdict_reason: "cuts the cause" }
  - { id: R-002, title: Provider late, probability: high, impact: high, status: open, response: accept, response_actions: "we wait", verdict: not-adequate, verdict_reason: "nobody watches the date" }
  - { id: R-003, title: Email pricing, probability: low, impact: medium, status: open }
  - { id: R-004, title: Old server, probability: high, impact: high, status: closed, response: avoid, response_actions: "moved", verdict: adequate }
`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/portal\n',
  '/t/portal/.pm/project.yaml': 'name: Portal\nstage: { current: 2, name: Build, start: 2026-10-01 }\n',
  '/t/portal/.pm/registers/risks.yaml': RISKS,
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 160, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const

test('the desk shows each risk with its response and verdict, and keeps the uncovered ones red in Needs attention', async ($, on) => {
  // Needs attention, page and pane: every open risk, "<id> [<score>] <title> · <state>", the uncovered ones first and red, by score;
  // the state is "no response", "response not assessed", "response not adequate: <reason>" or, plain, "response adequate: confirm the closure".
  // The Risks section of the Registers tab: columns Risk, P × I, Response, Verdict, Status on the page; a second line per risk in the pane.
  // The register's skill is /pm-risk. A closed risk never shows in Needs attention.
  const project = buildProject({ path: '/t/portal', project: FILES['/t/portal/.pm/project.yaml'], products: [], workPackages: [], risks: RISKS }, '2026-11-23')
  const page = renderBoard({ projects: [project], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].risks[1]).toMatchObject({ responseActions: 'we wait', verdict: 'not-adequate', verdictReason: 'nobody watches the date' })
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toContain("const isCovered = r => !!r.responseActions && r.verdict === 'adequate'")
  expect(script).toContain("p.risks.filter(r => isOpen(r.status)).sort((a, b) => isCovered(a) - isCovered(b) || b.score - a.score)")
  expect(script).toContain("className: isCovered(r) ? '' : 'err', textContent: r.id + ' [' + r.score + '] ' + r.title + ' · ' + riskState(r)")
  for (const label of ["'no response'", "'response adequate: confirm the closure'", "'response not adequate'", "'response not assessed'", "'✔ adequate'", "'✘ not adequate'"]) {
    expect(script).toContain(label)
  }
  expect(script).toContain("tableOf(['', 'Risk', 'P × I', 'Response', 'Verdict', 'Status'], openFirst(p.risks).map(riskRow))")
  expect(script).toContain("' open', '/pm-risk',")
  expect(script).not.toContain('${')

  // The pane, from a real read.
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
  await ui.press({ key: 'open:/t/portal' })
  expect((await ui.find({ type: 'Text', text: 'R-002 [9] Provider late · response not adequate: nobody watches the date' }))?.props.color).toBe('red')
  expect((await ui.find({ type: 'Text', text: 'R-003 [2] Email pricing · no response' }))?.props.color).toBe('red')
  const covered = await ui.find({ type: 'Text', text: 'R-001 [6] Branch staff keep the old procedure · response adequate: confirm the closure' })
  expect(covered).toBeTruthy()
  expect(covered?.props.color).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^R-004 \[9\] Old server · / })).toBeFalsy()

  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: '  reduce · advance circular, inline manuals · ✔ adequate · cuts the cause' })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: '  accept · we wait · ✘ not adequate · nobody watches the date' }))?.props.color).toBe('red')
  expect((await ui.find({ type: 'Text', text: '  no response' }))?.props.color).toBe('red')
  expect(await ui.find({ type: 'Text', text: 'R-004 [9] Old server · closed' })).toBeTruthy()
  await ui.unmount()
})
