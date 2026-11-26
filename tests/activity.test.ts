import { expect, test } from 'claude-code/testing'

import { getPackageLink } from '../hooks/actions'
import { getMilestonePackages, renderBoard } from '../hooks/board'
import { getMilestonePackage, toForgePulls } from '../hooks/milestones'
import { buildProject } from '../hooks/project'
import type { Project } from '../types'

const wp = (front: string) => `---\nproduct: work-package\n${front}---\n`
const files = (path: string) => ({
  path,
  project: 'name: P\nstage: { current: 1 }\n',
  products: [],
  workPackages: [
    { path: `${path}/.pm/work-packages/WP-02.md`, text: wp('id: WP-02\ntitle: Dashboard\nstage: 1\nstatus: in-progress\nmilestone: v1\n') },
    { path: `${path}/.pm/work-packages/WP-03.md`, text: wp('id: WP-03\ntitle: Dropped\nstage: 1\nstatus: cancelled\nmilestone: v2\n') },
    { path: `${path}/.pm/work-packages/WP-04.md`, text: wp('id: WP-04\ntitle: Second\nstage: 1\nstatus: draft\nmilestone: v1\n') },
  ],
})
const MILESTONES = [
  { title: 'v1', open: 1, closed: 3, due: '2026-12-01', stalled: 0, inReview: 0 },
  { title: 'v2', open: 2, closed: 0, due: '', stalled: 0, inReview: 0 },
]

test('the open pull requests, most recently updated first, each marked draft or in review', () => {
  const pulls = toForgePulls([
    { number: 8, title: 'Spike', html_url: 'https://h/pulls/8', updated_at: '2026-11-10T09:00:00Z', draft: true, requested_reviewers: [{ login: 'x' }], milestone: { title: 'v1' } },
    { number: 7, title: 'Fix', html_url: 'https://h/pulls/7', updated_at: '2026-11-12T09:00:00Z', requested_reviewers: [{ login: 'x' }] },
    { number: 6, title: 'Quiet', html_url: 'https://h/pulls/6', updated_at: '2026-11-11T09:00:00Z', requested_reviewers: null, milestone: null },
  ])
  expect(pulls).toEqual([
    { number: 7, title: 'Fix', url: 'https://h/pulls/7', createdAt: '', updatedAt: '2026-11-12', milestone: '', draft: false, inReview: true, assignees: [], closes: [] },
    { number: 6, title: 'Quiet', url: 'https://h/pulls/6', createdAt: '', updatedAt: '2026-11-11', milestone: '', draft: false, inReview: false, assignees: [], closes: [] },
    { number: 8, title: 'Spike', url: 'https://h/pulls/8', createdAt: '', updatedAt: '2026-11-10', milestone: 'v1', draft: true, inReview: false, assignees: [], closes: [] },
  ])
  expect(buildProject(files('/p'), '2026-11-13').forgePulls).toEqual([])
})

test('a milestone is linked to the work package whose milestone key is its title, cancelled ones left out, lowest id first', () => {
  const { workPackages } = buildProject(files('/p'), '2026-11-13')
  expect(getMilestonePackage(workPackages, 'v1')?.id).toBe('WP-02')
  // WP-03 carries v2 but is cancelled: v2 has no work package.
  expect(getMilestonePackage(workPackages, 'v2')).toBeUndefined()
  expect(getMilestonePackage(workPackages, 'v3')).toBeUndefined()
  const project: Project = { ...buildProject(files('/p'), '2026-11-13'), milestones: MILESTONES }
  expect(getMilestonePackages(project)).toEqual({ v1: { id: 'WP-02', title: 'Dashboard' }, v2: null })
})

test('the package link opens a session in the project folder asking for the pm-package skill on the picked references', () => {
  const project = buildProject(files('/Users/me/my repo'), '2026-11-13')
  const link = getPackageLink(project, ['#12', '#15', 'PR #18'])
  expect(link.startsWith('claude://code/new?')).toBe(true)
  const params = new URLSearchParams(link.slice('claude://code/new?'.length))
  expect(params.get('q')).toBe('[p2kit] Use the p2kit:pm-package skill with: #12 #15 PR #18')
  // Claude Desktop neutralises a leading slash in a linked prompt: the prompt must not be a command.
  expect(params.get('q')?.startsWith('/')).toBe(false)
  expect(params.get('folder')).toBe('/Users/me/my repo')
  expect(link).not.toContain('+')
  // The page appends the picked references to the link with none, the prompt being its last parameter.
  expect(getPackageLink(project, [])).toMatch(/&q=%5Bp2kit%5D%20Use%20the%20p2kit%3Apm-package%20skill%20with%3A$/)
  expect(link).toBe(getPackageLink(project, []) + encodeURIComponent(' #12 #15 PR #18'))
  const forMilestone = new URLSearchParams(getPackageLink(project, ['--milestone', "'Centro Studi'"]).split('?')[1])
  expect(forMilestone.get('q')).toBe("[p2kit] Use the p2kit:pm-package skill with: --milestone 'Centro Studi'")
})

test('the browser page embeds the package link, the pull requests and the work package of each milestone', () => {
  const project: Project = {
    ...buildProject(files('/p'), '2026-11-13'),
    milestones: MILESTONES,
    forgePulls: [{ number: 7, title: 'Fix', url: 'https://h/pulls/7', createdAt: '', updatedAt: '2026-11-12', milestone: '', draft: false, inReview: true }],
  }
  const page = renderBoard({ projects: [project], refreshedAt: 0, errors: [] })
  const json = page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>'))
  const data = JSON.parse(json).projects[0]
  expect(data.packageLink).toBe(getPackageLink(project, []))
  expect(data.milestonePackages).toEqual({ v1: { id: 'WP-02', title: 'Dashboard' }, v2: null })
  expect(data.forgePulls).toEqual(project.forgePulls)
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  // The test sandbox forbids new Function: the link building and the labels are read from the script text.
  expect(script).toContain("p.packageLink + encodeURIComponent(' ' + refs.join(' '))")
  expect(script).toContain("'PR #' + pr.number")
  expect(script).toContain("['--milestone', \"'\" + m.title + \"'\"]")
  for (const label of ["'Milestones'", "'Pull requests'", "'Issues'", "'Create package'", "'Create work package'", "'no work package'", "' selected'", "'No open pull request.'", "'No open issue.'"]) {
    expect(script).toContain(label)
  }
  // Blocks in the order settled at the gate: Milestones, Pull requests, Issues.
  expect(script.indexOf("blockTitle('Milestones'")).toBeLessThan(script.indexOf("blockTitle('Pull requests'"))
  expect(script.indexOf("blockTitle('Pull requests'")).toBeLessThan(script.indexOf("blockTitle('Issues'"))
  // The page's own reload would drop a selection in progress: it waits until nothing is picked.
  expect(script).toContain('if (!pickedItems.size && !pickedActions.size) location.reload()')
  // A drag in progress holds it too, and a drop only opens the preview: it never writes without Confirm.
  expect(script).toContain('if (dialogOpen || dragging) return')
  const drag = script.slice(script.indexOf('let dragging = null'), script.indexOf('const dragItem'))
  expect(drag).toContain('act(p, wanted)')
  expect(drag).not.toContain('post(')
  expect(drag).not.toContain('apply(')
  for (const kind of ["kind: 'assign'", "kind: 'issue-milestone'", "kind: 'wp-link'"]) expect(drag).toContain(kind)
  expect(script).toContain('function draw()')
  expect(script).not.toContain('${')
})

test('Team and Activity assign through the checked items and one control on top, with no per-row select (issue #58)', () => {
  const page = renderBoard({ projects: [buildProject(files('/p'), '2026-11-13')], refreshedAt: 0, errors: [] })
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).not.toContain('function assignControl')
  expect(script).not.toContain("'Assign…'")
  // One selection shared by both tabs, each with its checkbox column and the control on its selection bar.
  for (const tab of [script.slice(script.indexOf('function team('), script.indexOf('function activity(')), script.slice(script.indexOf('function activity('), script.indexOf('const milestoneRow'))]) {
    expect(tab).toContain('itemPicks(p)')
    expect(tab).toContain('assignManyControl(p, sel.numbers())')
  }
  expect(script).toContain('sel.cell(i.kind[0] + refOf(i), refOf(i, i.kind))')
  // The control assigns or unassigns: the op travels with the request, previewed before Confirm.
  const control = script.slice(script.indexOf('function assignManyControl'), script.indexOf('function packageDialog'))
  expect(control).toContain("group('add', 'Assign'), group('remove', 'Unassign')")
  expect(control).toContain("act(p, { kind: 'assign-many', numbers, login, op })")
})
