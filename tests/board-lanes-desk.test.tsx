import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { getBoardLanes } from '../hooks/lanes'
import { buildProject } from '../hooks/project'
import type { ForgeIssue, ForgePull, Project } from '../types'

const wp = (front: string) => `---\nproduct: work-package\n${front}---\n`
// An anaci-like project: Certificazioni delivered, then six change requests opened in its milestone, nobody on them.
const files = (path: string) => ({
  path,
  project: 'name: Anaci\nstage: { current: 1 }\n',
  products: [],
  workPackages: [
    { path: `${path}/.pm/work-packages/WP-01.md`, text: wp('id: WP-01\ntitle: Certificazioni\nstage: 1\nstatus: completed\nmilestone: Certificazioni\n') },
    { path: `${path}/.pm/work-packages/WP-02.md`, text: wp('id: WP-02\ntitle: Portale\nstage: 1\nstatus: in-progress\nmilestone: Portale\n') },
    { path: `${path}/.pm/work-packages/WP-03.md`, text: wp('id: WP-03\ntitle: Old\nstage: 1\nstatus: archived\nmilestone: Old\n') },
    { path: `${path}/.pm/work-packages/WP-04.md`, text: wp('id: WP-04\ntitle: Dropped\nstage: 1\nstatus: cancelled\nmilestone: Dropped\n') },
  ],
})
const issue = (number: number, milestone: string, extra: Partial<ForgeIssue> = {}): ForgeIssue => ({
  number, title: `Issue ${number}`, url: `https://h/issues/${number}`, createdAt: '', updatedAt: '2026-11-12', milestone, missing: [], assignees: [], state: 'todo', ...extra,
})
const pull = (number: number, milestone: string, draft: boolean): ForgePull => ({
  number, title: `Pull ${number}`, url: `https://h/pulls/${number}`, createdAt: '', updatedAt: '2026-11-12', milestone, draft, inReview: !draft, assignees: ['anna'], closes: [],
})
const forge = (base: Project): Project => ({
  ...base,
  milestones: [
    { title: 'Certificazioni', open: 6, closed: 14, due: '', stalled: 0, inReview: 0 },
    { title: 'Portale', open: 3, closed: 2, due: '', stalled: 0, inReview: 1 },
  ],
  forgeIssues: [
    ...[11, 12, 13, 14, 15, 16].map(n => issue(n, 'Certificazioni')),
    issue(21, 'Portale', { assignees: ['marco'], state: 'inprogress' }),
    issue(22, 'Portale', { state: 'review' }),
    issue(31, ''),
    issue(32, 'Dropped'),
  ],
  forgePulls: [pull(40, 'Portale', false), pull(41, '', true)],
})
const PROJECT = forge(buildProject(files('/p'), '2026-11-18'))

test('the board lanes: a lane per work package with a milestone, the delivered one reopened, the rest Unplanned', () => {
  // wf:contract: getBoardLanes gives one lane per work package owning a milestone (cancelled left out, archived only with open items),
  // wf:contract: by id, each with its open items in columns todo/inprogress/review, then the Unplanned lane (wp '') with the open items of no
  // wf:contract: work package; a completed or archived work package with open items carries `reopened` = their count.
  const lanes = getBoardLanes(PROJECT)
  expect(lanes.map(l => l.wp)).toEqual(['WP-01', 'WP-02', ''])
  const [cert, portal, unplanned] = lanes
  expect(cert.reopened).toBe(6)
  expect(cert.progress).toEqual({ closed: 14, total: 20 })
  expect(cert.cards.map(c => [c.number, c.column, c.assignees])).toEqual([11, 12, 13, 14, 15, 16].map(n => [n, 'todo', []]))
  expect(portal.reopened).toBe(0)
  expect(portal.cards.map(c => [c.kind, c.number, c.column])).toEqual([['issue', 21, 'inprogress'], ['issue', 22, 'review'], ['pr', 40, 'review']])
  // No milestone, or the milestone of a cancelled work package: Unplanned; a draft pull is in progress.
  expect(unplanned.cards.map(c => [c.kind, c.number, c.column])).toEqual([['issue', 31, 'todo'], ['issue', 32, 'todo'], ['pr', 41, 'inprogress']])
  // An archived work package with open items comes back, reopened.
  const archived = getBoardLanes({ ...PROJECT, forgeIssues: [...PROJECT.forgeIssues, issue(50, 'Old')] })
  expect(archived.map(l => [l.wp, l.reopened])).toEqual([['WP-01', 6], ['WP-02', 0], ['WP-03', 1], ['', 0]])
  // A project held by older code, without the forge fields or the issue state: no card is lost, nothing throws.
  const bare = { ...PROJECT, forgeIssues: [{ ...issue(60, ''), state: undefined, assignees: undefined }], forgePulls: undefined, milestones: undefined } as unknown as Project
  expect(getBoardLanes(bare).at(-1)?.cards.map(c => [c.number, c.column, c.assignees])).toEqual([[60, 'todo', []]])
})

test('the browser page has a Board tab after Metrics, its count the Unplanned items, lanes and cards marked for drag and drop', () => {
  // wf:contract: renderBoard embeds each project's `lanes`; TABS has ['board', 'Board', unplannedCount, board] first, right after Recap.
  // wf:contract: Lanes carry data-wp, cards data-number; an unassigned card says "unassigned"; a reopened lane "reopened: N open".
  const page = renderBoard({ projects: [PROJECT], refreshedAt: 0, errors: [] })
  const json = page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>'))
  const data = JSON.parse(json)
  expect(data.projects[0].lanes).toEqual(getBoardLanes(PROJECT))
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toMatch(/const TABS = \[\n {2}\['board', 'Board', unplannedCount, board\],/)
  for (const text of ["'unassigned'", "'reopened: '", "'Unplanned'", 'dataset.wp', 'dataset.number', "'To do'", "'In progress'", "'In review'", "'Done'"]) expect(script).toContain(text)
  expect(script).not.toContain('${')
  // A hand-built project without lanes still renders: the count reads them as empty.
  expect(script).toContain('const lanesOf = p => p.lanes || []')
  // Issue #94: no big New issue button in the header; a small + issue on every lane that takes one, the Unplanned lane's for no
  // work package, and with no lane at all on the header's line, the text shrinking.
  expect(script).toContain("el('div', { className: 'board-head' }")
  expect(script).not.toContain('new-issue')
  expect(page).not.toContain('.new-issue')
  expect(script).toContain("!l.wp || issueTargets(p).some(w => w.id === l.wp) ? newIssueButton(p, l.wp) : null")
  expect(script).toContain("boardHead(\"No work package with a milestone and no open item: run /pm-link or /pm-package in the project's repo.\", newIssueButton(p, ''))")
  expect(script).toContain("contextButton('+ issue', ")
  expect(page).toContain('.board-head { display: flex;')
  expect(page).toContain('.board-head p { flex: 1; min-width: 0;')
})

const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/anaci\n',
  '/t/anaci/.pm/project.yaml': 'name: Anaci\nstage: { current: 1 }\nroles:\n  project_manager: Davide Paci\n',
  '/t/anaci/.pm/work-packages/WP-01.md': wp('id: WP-01\ntitle: Certificazioni\nstage: 1\nstatus: completed\nmilestone: Certificazioni\n'),
}
const DIRS: Record<string, string[]> = { '/t/anaci/.pm/work-packages': ['WP-01.md'] }
const ISSUES = [
  { number: 11, title: 'CR one', html_url: 'https://h/issues/11', updated_at: '2026-11-12T09:00:00Z', assignees: [], milestone: { title: 'Certificazioni' }, body: null },
  { number: 12, title: 'CR two', html_url: 'https://h/issues/12', updated_at: '2026-11-12T09:00:00Z', assignees: [{ login: 'anna' }], milestone: { title: 'Certificazioni' }, body: null },
  { number: 31, title: 'Loose', html_url: 'https://h/issues/31', updated_at: '2026-11-11T09:00:00Z', assignees: [], milestone: null, body: null },
]
const MILESTONES = [{ title: 'Certificazioni', open_issues: 2, closed_issues: 14, due_on: null }]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('the pane Board tab shows each lane as text, the reopened one flagged, the unassigned marked', async ($, on) => {
  // wf:contract: Pressing `tab:board` shows per lane "<WP> <title> · <status> · <closed>/<total>[ · reopened: N open]" and one line per
  // wf:contract: non-empty column "  To do: #n unassigned, #m @login"; the last lane is "Unplanned · N open".
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
      if (e.argv[2] === 'repos/acme/anaci/issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (e.argv[2] === 'repos/acme/anaci/pulls?state=open&per_page=100&page=1') return answer(0, '[]')
      if (e.argv[2] === 'repos/acme/anaci/milestones?state=open&per_page=100') return answer(0, JSON.stringify(MILESTONES))
      // Only the assigned issue's timeline is read: its first commit puts it in progress.
      if (e.argv[2] === 'repos/acme/anaci/issues/12/timeline?per_page=100') return answer(0, JSON.stringify([{ event: 'referenced', commit_id: 'abc1234' }]))
      return answer(1)
    }
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return answer(0, 'git@github.com:acme/anaci.git\n')
    return answer(1)
  })

  await $.command.run(RUN)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/anaci' })
  await ui.press({ key: 'tab:board' })
  expect(await ui.find({ type: 'Text', text: 'WP-01 Certificazioni · completed · 14/16 · reopened: 2 open' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  To do: #11 unassigned' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  In progress: #12 @anna' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Unplanned · 1 open' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  To do: #31 unassigned' })).toBeTruthy()
})
