import { expect, mock, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { renderBoard } from '../hooks/board'
import type { Project } from '../types'

const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/calm\n',
  '/t/gh/.pm/project.yaml': 'name: Gh\nroles:\n  project_manager: Davide Paci\n',
  '/t/calm/.pm/project.yaml': 'name: Calm\nroles:\n  project_manager: Davide Paci\n',
}
const MILESTONES = [
  { title: 'v1', open_issues: 1, closed_issues: 3, due_on: '2026-12-01T00:00:00Z' },
  { title: 'v2', open_issues: 2, closed_issues: 0, due_on: null },
]
// Bodies carry the default readiness headings, so Phase 2's `notready` mark never lands on these lines.
const READY = '## Why\nx\n## What changes\ny\n## Done when\n- [ ] z\n'
const ISSUES = [
  { number: 1, title: 'In v1', html_url: 'https://h/issues/1', updated_at: '2026-11-12T09:00:00Z', assignees: [], milestone: { title: 'v1' }, body: READY },
  { number: 2, title: 'Loose', html_url: 'https://h/issues/2', updated_at: '2026-11-11T09:00:00Z', assignees: [], milestone: null, body: READY },
]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the browser page has an Activity tab right after Team', () => {
  // wf:contract: renderBoard embeds each project's milestones and forgeIssues; the TABS list has an "Activity" tab right after "Team",
  // wf:contract: its count the open issues and pull requests. Its body shows, per milestone, a closed/total bar, the due day, "stalled", "in review"
  // wf:contract: and the milestone's open issues; then a "No milestone" group; with nothing at all, "No open milestone.". The script still compiles.
  const project: Project = {
    ...buildProject({ path: '/p', project: 'name: P\n', products: [], workPackages: [] }, '2026-11-13'),
    milestones: [{ title: 'v1', open: 1, closed: 3, due: '2026-12-01', stalled: 0, inReview: 1 }],
    forgeIssues: [{ number: 1, title: 'In v1', url: 'https://h/issues/1', updatedAt: '2026-11-12', milestone: 'v1' }] as Project['forgeIssues'],
  }
  const page = renderBoard({ projects: [project], refreshedAt: 0, errors: [] })
  const json = page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>'))
  const data = JSON.parse(json)
  expect(data.projects[0].milestones).toEqual(project.milestones)
  expect(data.projects[0].forgeIssues).toEqual(project.forgeIssues)
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  // The test sandbox forbids new Function: the tab list and the labels are read from the script text.
  expect(script).toMatch(/\['team', 'Team', p => p\.team\.length, team\],\n  \['activity', 'Activity', p => p\.forgeIssues\.length \+ p\.forgePulls\.length, /)
  for (const label of ["'No milestone'", "'No open milestone.'", "'stalled '", "'in review '", "'due '", "'overdue'"]) expect(script).toContain(label)
  expect(script).toContain('function draw()')
  expect(script).not.toContain('${')
})

test('the pane shows each milestone with its progress and open issues, and the issues without one apart', async ($, on) => {
  // wf:contract: In the drill-in, pressing `tab:activity` shows per milestone the line
  // wf:contract: "<title> · <closed>/<total> · due <day> · stalled <n> · in review <n>" (the due part omitted when none),
  // wf:contract: then its open issues as "#<n> <title>"; then "No milestone" and the open issues without one.
  // wf:contract: A project with no milestone and no open issue shows "No open milestone.".
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      if (e.argv[2] === 'repos/acme/gh/issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (e.argv[2] === 'repos/acme/gh/pulls?state=open&per_page=100&page=1') return answer(0, '[]')
      if (e.argv[2] === 'repos/acme/gh/milestones?state=open&per_page=100') return answer(0, JSON.stringify(MILESTONES))
      return answer(1)
    }
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return answer(e.argv[2] === '/t/gh' ? 0 : 1, 'git@github.com:acme/gh.git\n')
    return answer(1)
  })

  await $.command.run(RUN)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/gh' })
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ type: 'Text', text: /^v1 · 3\/4 · due 2026-12-01 · stalled 0 · in review 0$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^v2 · 0\/2 · stalled 0 · in review 0$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#1 In v1$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^No milestone$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#2 Loose$/ })).toBeTruthy()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/calm' })
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ type: 'Text', text: 'No open milestone.' })).toBeTruthy()
  await ui.unmount()
})
