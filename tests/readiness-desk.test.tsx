import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'
import type { Project } from '../types'

const READY = '## Why\nx\n## What changes\ny\n## Done when\n- [ ] z\n'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/custom\n',
  '/t/gh/.pm/project.yaml': 'name: Gh\nroles:\n  project_manager: Davide Paci\nteam:\n  people:\n    Davide Paci: { login: dgpaci }\n',
  '/t/custom/.pm/project.yaml': 'name: Custom\nroles:\n  project_manager: Davide Paci\nreadiness:\n  headings: [Context]\n',
}
const ISSUES = [
  { number: 1, title: 'Ready', html_url: 'https://h/issues/1', updated_at: '2026-11-12T09:00:00Z', assignees: [], milestone: { title: 'v1' }, body: READY },
  { number: 2, title: 'Bare', html_url: 'https://h/issues/2', updated_at: '2026-11-11T09:00:00Z', assignees: [{ login: 'dgpaci' }], milestone: { title: 'v1' }, body: '## Why\nonly this' },
  { number: 3, title: 'Empty', html_url: 'https://h/issues/3', updated_at: '2026-11-10T09:00:00Z', assignees: [], milestone: null, body: null },
]
const MILESTONES = [{ title: 'v1', open_issues: 2, closed_issues: 0, due_on: null }]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

function mockDesk(on: Parameters<Parameters<typeof test>[1]>[1], gh: string[][]) {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      gh.push([...e.argv])
      const rest = (e.argv[2] ?? '').split('/').slice(3).join('/')
      if (rest === 'issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (rest === 'pulls?state=open&per_page=100&page=1') return answer(0, '[]')
      if (rest === 'milestones?state=open&per_page=100') return answer(0, JSON.stringify(MILESTONES))
      return answer(1)
    }
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return answer(0, `git@github.com:acme/${e.argv[2] === '/t/gh' ? 'gh' : 'custom'}.git\n`)
    return answer(1)
  })
}

test('open issues missing a readiness heading are counted, marked notready and filtered, in the pane', async ($, on) => {
  // wf:contract: loadProjects sets each forge issue's `missing` (getMissingHeadings of its body against the project's headings in force)
  // wf:contract: and Project.notReady = the open issues with something missing. Only GETs reach the forge: the check writes nothing.
  // wf:contract: Pane: the overview and the recap show "notready <N>" when N > 0, nothing when 0. In the Activity tab and the Team tab
  // wf:contract: a not-ready issue's line ends with " · notready". The `filter:notready` button ("Not ready only") keeps only those issues
  // wf:contract: in the Activity tab; the filter is reset when another project is opened or the pane goes back to the overview.
  const gh: string[][] = []
  let stored: Project[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'projects') stored = (e.value as { value: Project[] }).value
    return next(e)
  })
  mock.store(on)
  mock.clock(on)
  mockDesk(on, gh)

  await $.command.run(RUN)
  const named = (name: string): Project => stored.find(project => project.name === name)!
  expect(named('Gh').forgeIssues.map(one => [one.number, one.missing])).toEqual([[1, []], [2, ['What changes', 'Done when']], [3, ['Why', 'What changes', 'Done when']]])
  expect(named('Gh').notReady).toBe(2)
  // Custom headings: only "Context" is asked, and no issue has it.
  expect(named('Custom').readiness).toEqual(['Context'])
  expect(named('Custom').notReady).toBe(3)
  expect(gh.every(argv => argv.length === 3 && argv[1] === 'api')).toBe(true)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'notready 2' })).toBeTruthy()
  await ui.press({ key: 'open:/t/gh' })
  expect(await ui.find({ type: 'Text', text: 'notready 2' })).toBeTruthy()
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ type: 'Text', text: /#1 Ready$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#2 Bare · notready$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#3 Empty · notready$/ })).toBeTruthy()
  await ui.press({ key: 'filter:notready' })
  expect(await ui.find({ type: 'Text', text: /#1 Ready$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /#2 Bare · notready$/ })).toBeTruthy()
  await ui.press({ key: 'tab:team' })
  expect(await ui.find({ type: 'Text', text: /#2 Bare · to do · notready$/ })).toBeTruthy()

  // The filter does not survive leaving the project.
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/gh' })
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ type: 'Text', text: /#1 Ready$/ })).toBeTruthy()
  await ui.unmount()
})

test('the browser page marks not-ready issues, filters them and counts them in the card and the recap', () => {
  // wf:contract: The browser page shows a `notready` pill (class notready, title "missing: <headings>") on each not-ready issue of the
  // wf:contract: Activity tab and on Team tab issues whose number is a not-ready forge issue; a "Not ready only" toggle in the
  // wf:contract: Activity tab; "notready <N>" in the card head and "<N> issues not ready" in the recap's "Needs attention" when N > 0.
  const bare = { number: 2, title: 'Bare', url: 'https://h/issues/2', updatedAt: '2026-11-11', milestone: 'v1', missing: ['Done when'] }
  const project: Project = {
    ...buildProject({ path: '/p', project: 'name: P\n', products: [], workPackages: [] }, '2026-11-13'),
    forgeIssues: [bare],
    notReady: 1,
  }
  const page = renderBoard({ projects: [project], refreshedAt: 0, errors: [] })
  const json = page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>'))
  expect(JSON.parse(json).projects[0].forgeIssues).toEqual([bare])
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  for (const label of ["'notready'", "'missing: '", "'Not ready only'", "' issues not ready'"]) expect(script).toContain(label)
  expect(script).toContain('function draw()')
  expect(script).not.toContain('${')
})
