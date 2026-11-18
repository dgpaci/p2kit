import { expect, test } from 'claude-code/testing'

import { getClosedRefs, getIssueState, toForgeIssues, toForgePulls } from '../hooks/milestones'

const T = '2026-11-17T10:00:00Z'
const issue = (number: number, extra: object = {}) => ({ number, title: `I${number}`, html_url: `https://h/issues/${number}`, state: 'open', updated_at: T, ...extra })
const pull = (number: number, body: string, extra: object = {}) => ({ number, title: `P${number}`, html_url: `https://h/pull/${number}`, state: 'open', updated_at: T, body, ...extra })

test('closing references: closes, fixes, resolves in every tense, any case, once each', () => {
  expect(getClosedRefs('Closes #1, fixed #2 and RESOLVES #3.\nclose #4 fix #5 resolved #6 resolve: #7 closed #1')).toEqual([1, 2, 3, 4, 5, 6, 7])
  expect(getClosedRefs('Refs #9, see #10, prefix#11')).toEqual([])
  expect(getClosedRefs(null)).toEqual([])
  expect(getClosedRefs(undefined)).toEqual([])
})

test('issue state: review over inprogress over todo, closed is done; assigned alone is still todo', () => {
  // The rule forge-desk shares: in progress is the in-progress label (any case) or an open draft pull closing the issue.
  const pulls = [pull(20, 'Fixes #2'), pull(21, 'Closes #3', { draft: true }), pull(22, 'closes #4', { draft: true }), pull(23, 'Resolves #4')]
  expect(getIssueState(issue(1), pulls)).toBe('todo')
  expect(getIssueState(issue(2), pulls)).toBe('review')
  expect(getIssueState(issue(3), pulls)).toBe('inprogress')
  expect(getIssueState(issue(4), pulls)).toBe('review')
  expect(getIssueState(issue(5, { assignees: [{ login: 'a' }] }), pulls)).toBe('todo')
  expect(getIssueState(issue(7, { labels: [{ name: 'In-Progress' }] }), pulls)).toBe('inprogress')
  expect(getIssueState(issue(8, { labels: [{ name: 'bug' }], assignees: [{ login: 'a' }] }), pulls)).toBe('todo')
  expect(getIssueState(issue(2, { labels: [{ name: 'in-progress' }] }), pulls)).toBe('review')
  expect(getIssueState(issue(9, { labels: null }), pulls)).toBe('todo')
  expect(getIssueState(issue(6, { state: 'closed' }), pulls)).toBe('done')
  expect(getIssueState(issue(1), [])).toBe('todo')
})

test('GitHub payload: assignees kept, pull entries dropped, state against the open pulls', () => {
  const issues = [
    issue(1, { assignees: [{ login: 'dgpaci' }, { login: 'bob' }], labels: [{ name: 'in-progress' }] }),
    issue(2, { assignees: [] }),
    issue(3),
    issue(9, { pull_request: { url: 'x' } }),
  ]
  const rest = [pull(9, 'Closes #2', { draft: false, assignees: [{ login: 'dgpaci' }] }), pull(10, 'Fixes #3', { draft: true, assignees: [] })]
  const forge = toForgeIssues(issues as never, [], rest as never)
  expect(forge.map(one => [one.number, one.assignees, one.state])).toEqual([[1, ['dgpaci', 'bob'], 'inprogress'], [2, [], 'review'], [3, [], 'inprogress']])
  expect(toForgePulls(rest as never).map(one => [one.number, one.assignees, one.closes])).toEqual([[9, ['dgpaci'], [2]], [10, [], [3]]])
})

test('Forgejo payload: pull_request null, assignees null or a list, pull body null', () => {
  const issues = [issue(567, { pull_request: null, assignees: null, labels: null }), issue(568, { pull_request: null, assignees: [{ login: 'dgpaci' }], labels: [{ id: 4, name: 'in-progress', color: 'e11d21' }] })]
  const rest = [pull(570, '', { body: null, assignees: null, draft: false })]
  const forge = toForgeIssues(issues as never, [], rest as never)
  expect(forge.map(one => [one.number, one.assignees, one.state])).toEqual([[567, [], 'todo'], [568, ['dgpaci'], 'inprogress']])
  expect(toForgePulls(rest as never).map(one => [one.number, one.assignees, one.closes])).toEqual([[570, [], []]])
})

test('without pulls an open issue is inprogress from its label alone, never from its assignees', () => {
  expect(toForgeIssues([issue(1), issue(2, { assignees: [{ login: 'a' }] }), issue(3, { labels: [{ name: 'in-progress' }] })] as never).map(one => one.state))
    .toEqual(['todo', 'todo', 'inprogress'])
})
