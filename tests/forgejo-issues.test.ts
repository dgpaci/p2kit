import { expect, test } from 'claude-code/testing'

import { toForgeIssues, toMilestoneProgress } from '../hooks/milestones'
import { isPlainIssue, toTeamItems } from '../hooks/team'

// Forgejo's issue list carries `pull_request: null` on every plain issue; GitHub omits the key; a pull request has an object.
const NOW = Date.parse('2026-11-13T12:00:00Z')
const ISSUES = [
  { number: 567, title: 'Forgejo issue', html_url: 'https://h/issues/567', updated_at: '2026-11-12T09:00:00Z', assignees: [{ login: 'dgpaci' }], milestone: { title: 'v1' }, body: '', pull_request: null },
  { number: 568, title: 'GitHub issue', html_url: 'https://h/issues/568', updated_at: '2026-11-11T09:00:00Z', assignees: [{ login: 'dgpaci' }], milestone: null, body: '' },
  { number: 569, title: 'A pull', html_url: 'https://h/pull/569', updated_at: '2026-11-10T09:00:00Z', assignees: [{ login: 'dgpaci' }], milestone: { title: 'v1' }, pull_request: { merged: false } },
]

test('an issue is told from a pull request on both forges', () => {
  expect(ISSUES.map(isPlainIssue)).toEqual([true, true, false])
  expect(toForgeIssues(ISSUES).map(one => one.number)).toEqual([567, 568])
  expect(toTeamItems('dgpaci', ISSUES, [], NOW).map(item => [item.number, item.status])).toEqual([[567, 'todo'], [568, 'todo']])
  const milestones = [{ title: 'v1', open_issues: 1, closed_issues: 0, due_on: null }]
  expect(toMilestoneProgress(milestones, ISSUES, [], Date.parse('2026-12-13T12:00:00Z'))[0]!.stalled).toBe(1)
})
