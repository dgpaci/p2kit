import { expect, test } from 'claude-code/testing'

import { toMilestoneItems } from '../hooks/milestones'

test('the items of a milestone: issues and pull requests, open first, a merged pull told apart from a closed one', () => {
  const items = toMilestoneItems([
    { number: 10, title: 'Done issue', html_url: 'https://h/issues/10', state: 'closed', pull_request: null },
    { number: 12, title: 'Merged pull', html_url: 'https://h/pulls/12', state: 'closed', pull_request: { merged_at: '2026-11-10T10:00:00Z' } },
    { number: 11, title: 'Open issue', html_url: 'https://h/issues/11', state: 'open' },
    { number: 13, title: 'Closed pull', html_url: 'https://h/pulls/13', state: 'closed', pull_request: { merged_at: null } },
    { number: 14, title: 'Open pull', html_url: 'https://h/pulls/14', state: 'open', pull_request: {} },
  ])
  expect(items.map(item => [item.kind, item.number, item.state])).toEqual([
    ['pr', 14, 'open'],
    ['issue', 11, 'open'],
    ['pr', 13, 'closed'],
    ['pr', 12, 'merged'],
    ['issue', 10, 'closed'],
  ])
  expect(items[1]).toEqual({ kind: 'issue', number: 11, title: 'Open issue', url: 'https://h/issues/11', state: 'open' })
})
