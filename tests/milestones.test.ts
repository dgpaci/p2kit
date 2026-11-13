import { expect, test } from 'claude-code/testing'

import { toMilestone } from '../hooks/forge'
import { toForgeIssues, toMilestoneProgress } from '../hooks/milestones'
import { buildProject } from '../hooks/project'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-13T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()
const user = (login: string) => ({ login })
const ms = (title: string) => ({ title })

const MILESTONES = [
  { title: 'v2', open_issues: 3, closed_issues: 1, due_on: null },
  { title: 'v1', open_issues: 4, closed_issues: 6, due_on: '2026-12-01T00:00:00Z' },
  { title: 'beta', open_issues: 0, closed_issues: 2, due_on: '2026-11-20T08:00:00Z' },
]
const ISSUES = [
  { number: 1, title: 'Fresh v1', html_url: 'https://h/issues/1', updated_at: ago(1), milestone: ms('v1') },
  { number: 2, title: 'Old v1', html_url: 'https://h/issues/2', updated_at: ago(10), milestone: ms('v1') },
  { number: 3, title: 'No milestone', html_url: 'https://h/issues/3', updated_at: ago(2), milestone: null },
  { number: 4, title: 'A pull on GitHub', html_url: 'https://h/pull/4', updated_at: ago(0), milestone: ms('v1'), pull_request: {} },
  { number: 5, title: 'Old v2', html_url: 'https://h/issues/5', updated_at: ago(30) },
]
const PULLS = [
  { number: 4, title: 'Review asked', html_url: 'https://h/pull/4', updated_at: ago(0), draft: false, user: user('a'), requested_reviewers: [user('b')], milestone: ms('v1') },
  { number: 6, title: 'Draft with reviewer', html_url: 'https://h/pull/6', updated_at: ago(0), draft: true, user: user('a'), requested_reviewers: [user('b')], milestone: ms('v1') },
  { number: 7, title: 'Old, no reviewer', html_url: 'https://h/pull/7', updated_at: ago(8), draft: false, user: user('a'), requested_reviewers: [], milestone: ms('v1') },
  { number: 8, title: 'Other milestone', html_url: 'https://h/pull/8', updated_at: ago(0), draft: false, user: user('a'), requested_reviewers: [user('b')], milestone: ms('v2') },
]

test('milestone progress: counts from the forge, stalled and in review from the open items, ordered by due day', () => {
  // wf:contract: toMilestoneProgress(milestones, issues, pulls, now) gives one entry per milestone, shape { title, open, closed, due, stalled, inReview } —
  // wf:contract: the list Macros 5 and 7 read as Project.milestones. open, closed and due are read as toMilestone reads them (due an ISO day or '').
  // wf:contract: stalled counts the open issues and open pull requests of that milestone untouched for more than 7 days;
  // wf:contract: inReview counts its open pull requests that are not drafts and have at least one requested reviewer.
  // wf:contract: Ordered by due day ascending, the milestones without a due day last, then by title.
  const progress = toMilestoneProgress(MILESTONES, ISSUES, PULLS, NOW)
  expect(progress).toEqual([
    { title: 'beta', open: 0, closed: 2, due: '2026-11-20', stalled: 0, inReview: 0 },
    { title: 'v1', open: 4, closed: 6, due: '2026-12-01', stalled: 2, inReview: 1 },
    { title: 'v2', open: 3, closed: 1, due: '', stalled: 0, inReview: 1 },
  ])
  // The same reading of a milestone as the work-package forge state.
  for (const one of progress) {
    const { title, open, closed, due } = one
    expect(toMilestone(MILESTONES, title)).toEqual({ title, open, closed, due })
  }
  expect(toMilestoneProgress([], ISSUES, PULLS, NOW)).toEqual([])
})

test('an item without a milestone key counts for no milestone', () => {
  // wf:contract: An issue or pull request whose milestone is absent or null belongs to no milestone (Forgejo and GitHub both omit or null it).
  const progress = toMilestoneProgress([{ title: 'v2', open_issues: 1, closed_issues: 0, due_on: null }], ISSUES, [], NOW)
  expect(progress).toEqual([{ title: 'v2', open: 1, closed: 0, due: '', stalled: 0, inReview: 0 }])
})

test('forge issues: open issues only, most recently updated first, with their milestone title', () => {
  // wf:contract: toForgeIssues(issues) keeps the issues (an entry carrying pull_request is a pull request on GitHub and is dropped),
  // wf:contract: each as { number, title, url, updatedAt (ISO day), milestone ('' when none) }, most recently updated first.
  const issues = toForgeIssues(ISSUES)
  expect(issues.map(one => [one.number, one.title, one.url, one.updatedAt, one.milestone])).toEqual([
    [1, 'Fresh v1', 'https://h/issues/1', ago(1).slice(0, 10), 'v1'],
    [3, 'No milestone', 'https://h/issues/3', ago(2).slice(0, 10), ''],
    [2, 'Old v1', 'https://h/issues/2', ago(10).slice(0, 10), 'v1'],
    [5, 'Old v2', 'https://h/issues/5', ago(30).slice(0, 10), ''],
  ])
})

test('a project starts with no milestone and no forge issue until the forge is read', () => {
  // wf:contract: buildProject gives milestones [] and forgeIssues []; loadProjects fills them from the forge.
  const project = buildProject({ path: '/p', project: 'name: P\n', products: [], workPackages: [] }, '2026-11-13')
  expect(project.milestones).toEqual([])
  expect(project.forgeIssues).toEqual([])
})
