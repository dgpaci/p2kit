import { expect, test } from 'claude-code/testing'

import { getFirstReviewAt } from '../hooks/flow'

test('a Forgejo review request is not a review', () => {
  // Forgejo lists each requested reviewer among the reviews, state REQUEST_REVIEW, with a date (anaci PR 469).
  const reviews = [
    { user: { login: 'b' }, state: 'REQUEST_REVIEW', submitted_at: '2026-10-26T13:00:00Z' },
    { user: { login: 'b' }, state: 'APPROVED', submitted_at: '2026-10-28T00:00:00Z' },
  ]
  expect(getFirstReviewAt(reviews, 'a')).toBe('2026-10-28T00:00:00Z')
  expect(getFirstReviewAt(reviews.slice(0, 1), 'a')).toBe(null)
})
