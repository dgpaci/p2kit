import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { getFlowCell, toFlow } from '../hooks/flow'
import { buildProject } from '../hooks/project'
import type { Project } from '../types'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/local\n',
  '/t/gh/.pm/project.yaml': 'name: Gh\n',
  '/t/local/.pm/project.yaml': 'name: Local\n',
}
const ISSUES = [{ number: 1, title: 'Ten days', html_url: 'https://h/issues/1', updated_at: '2026-11-11T12:00:00Z', created_at: '2026-11-01T12:00:00Z', closed_at: '2026-11-11T12:00:00Z' }]
const PULLS = [
  { number: 10, title: 'One day', html_url: 'https://h/pull/10', updated_at: '2026-11-10T12:00:00Z', user: { login: 'a' }, created_at: '2026-11-09T12:00:00Z', closed_at: '2026-11-10T12:00:00Z', merged_at: '2026-11-10T12:00:00Z' },
]
const REVIEWS = [{ user: { login: 'b' }, state: 'APPROVED', submitted_at: '2026-11-10T00:00:00Z' }]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the Metrics tab shows lead, review and merge time for 30 and 90 days and the weekly throughput, in the page and the pane', async ($, on) => {
  // wf:contract: The project form has a Metrics tab, the last one, in the browser page (hooks/board.ts TABS) and in the pane (hooks/register.tsx tabs);
  // wf:contract: its count is the number of pulls merged in the last 30 days.
  // wf:contract: It shows three rows — Lead time, Review (opened -> first review), Merge (opened -> merged) — each with the 30- and the
  // wf:contract: 90-day figure as `median · p90 (n)`, or `—` when the count is 0.
  // wf:contract: Under them the weekly throughput of the 90-day window, one entry per week with its issues closed and pulls merged:
  // wf:contract: CSS bars on the page (no chart library), one text line per week in the pane.
  // wf:contract: A project with flow null shows `No forge data.` in the tab.
  // The page: the tab follows Activity, the flow is embedded, the labels and the bars are in the script, which uses no template.
  const project: Project = { ...buildProject({ path: '/p', project: 'name: P\n', products: [], workPackages: [] }, '2026-11-13'), flow: toFlow(ISSUES, PULLS, { 10: REVIEWS[0]!.submitted_at }, NOW) }
  const page = renderBoard({ projects: [project], refreshedAt: NOW, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].flow).toEqual(project.flow)
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toMatch(/\['metrics', 'Metrics', p => p\.flow \? p\.flow\.windows\[0\]\.merge\.count : 0, metrics\],\n\]/)
  for (const label of ["'Lead time'", "'Review'", "'Merge'", "'30 days'", "'90 days'", "'No forge data.'", "'—'", "className: 'stack'"]) expect(script).toContain(label)
  expect(script).not.toMatch(/chart\.js|<canvas|<svg/i)
  expect(script).not.toContain('${')

  // The pane, from a real read: Gh reads its closed items, Local has no forge.
  mock.store(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      const path = e.argv[2] ?? ''
      if (path.startsWith('repos/acme/gh/issues?state=closed&')) return answer(0, JSON.stringify(ISSUES))
      if (path.startsWith('repos/acme/gh/pulls?state=closed&')) return answer(0, JSON.stringify(PULLS))
      if (path === 'repos/acme/gh/pulls/10/reviews?per_page=100') return answer(0, JSON.stringify(REVIEWS))
      return answer(0, '[]')
    }
    if (e.argv[2] === '/t/gh' && e.argv.slice(3).join(' ') === 'remote get-url origin') return answer(0, 'git@github.com:acme/gh.git\n')
    return answer(1)
  })
  await $.command.run(RUN)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/gh' })
  expect(await ui.find({ type: 'Button', key: 'tab:metrics', text: 'Metrics 1' })).toBeTruthy()
  await ui.press({ key: 'tab:metrics' })
  expect(await ui.find({ type: 'Text', text: 'Lead time: 10 · 10 (1) | 10 · 10 (1)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Review (opened → first review): 0.5 · 0.5 (1) | 0.5 · 0.5 (1)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Merge (opened → merged): 1 · 1 (1) | 1 · 1 (1)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '2026-11-09 ▇▇ 1 issues · 1 PRs' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '2026-08-10    0 issues · 0 PRs' })).toBeTruthy()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/local' })
  expect(await ui.find({ type: 'Button', key: 'tab:metrics', text: 'Metrics 0' })).toBeTruthy()
  await ui.press({ key: 'tab:metrics' })
  expect(await ui.find({ type: 'Text', text: 'No forge data.' })).toBeTruthy()
  // With no closed item at all, every figure is a dash.
  expect(getFlowCell({ count: 0, median: null, p90: null })).toBe('—')
  await ui.unmount()
})
