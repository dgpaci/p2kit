import { expect, mock, test } from 'claude-code/testing'

import type { Project } from '../types'

const wp = (front: string) => `---\nproduct: work-package\n${front}---\n`
const READY = '## Why\nx\n## What changes\ny\n## Done when\n- [ ] z\n'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n',
  '/t/gh/.pm/project.yaml': 'name: Gh\nstage: { current: 1 }\nroles:\n  project_manager: Davide Paci\n',
  '/t/gh/.pm/work-packages/WP-02.md': wp('id: WP-02\ntitle: Dashboard\nstage: 1\nstatus: in-progress\nmilestone: v1\n'),
}
const DIRS: Record<string, string[]> = { '/t/gh/.pm/work-packages': ['WP-02.md'] }
const MILESTONES = [
  { title: 'v1', open_issues: 1, closed_issues: 3, due_on: '2026-12-01T00:00:00Z' },
  { title: 'v2', open_issues: 1, closed_issues: 0, due_on: null },
]
const ISSUES = [
  { number: 1, title: 'In v1', html_url: 'https://h/issues/1', updated_at: '2026-11-12T09:00:00Z', assignees: [], milestone: { title: 'v1' }, body: READY },
  { number: 2, title: 'Bare', html_url: 'https://h/issues/2', updated_at: '2026-11-11T09:00:00Z', assignees: [], milestone: null, body: null },
]
const PULLS = [
  { number: 8, title: 'Spike', html_url: 'https://h/pulls/8', updated_at: '2026-11-10T09:00:00Z', draft: true, milestone: { title: 'v1' } },
  { number: 7, title: 'Fix', html_url: 'https://h/pulls/7', updated_at: '2026-11-12T09:00:00Z', requested_reviewers: [{ login: 'x' }], milestone: null },
]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the pane Activity tab shows the milestones with their work package, the pull requests and the issues', async ($, on) => {
  const gh: string[][] = []
  let stored: Project[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'projects') stored = (e.value as { value: Project[] }).value
    return next(e)
  })
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      gh.push([...e.argv])
      if (e.argv[2] === 'repos/acme/gh/issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (e.argv[2] === 'repos/acme/gh/pulls?state=open&per_page=100&page=1') return answer(0, JSON.stringify(PULLS))
      if (e.argv[2] === 'repos/acme/gh/milestones?state=open&per_page=100') return answer(0, JSON.stringify(MILESTONES))
      return answer(1)
    }
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return answer(0, 'git@github.com:acme/gh.git\n')
    return answer(1)
  })

  await $.command.run(RUN)
  // The pull requests come from the repo read already made: no new request, GET only.
  expect(stored[0].forgePulls.map(pull => [pull.number, pull.draft, pull.inReview])).toEqual([[7, false, true], [8, true, false]])
  expect(gh.filter(argv => argv[2].includes('/pulls?state=open')).length).toBe(1)
  expect(gh.every(argv => argv.length === 3 && argv[1] === 'api')).toBe(true)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/gh' })
  await ui.press({ key: 'tab:activity' })
  for (const block of ['Milestones', 'Pull requests', 'Issues']) expect(await ui.find({ type: 'Text', text: block })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^v1 · 3\/4 · due 2026-12-01 · stalled 0 · in review 0$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^v2 · 0\/1 · stalled 0 · in review 0$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  no work package' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ {2}PR #7 Fix · in review$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ {2}PR #8 Spike · draft$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#2 Bare · notready$/ })).toBeTruthy()

  // "Not ready only" filters the issues; milestones and pull requests stay.
  await ui.press({ key: 'filter:notready' })
  expect(await ui.find({ type: 'Text', text: /#1 In v1$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^ {2}PR #7 Fix · in review$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  no work package' })).toBeTruthy()

  // The work package of v1 opens its work theme.
  await ui.press({ key: 'milestone-wp:v1' })
  expect(await ui.find({ type: 'Text', text: /^WP-02 Dashboard · milestone v1/ })).toBeTruthy()
  await ui.unmount()
})
