import { expect, test } from 'claude-code/testing'

import { getFirstReviewAt, toFlow, toFlowWindow } from '../hooks/flow'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const at = (iso: string) => `${iso}Z`
const user = (login: string) => ({ login })
const ms = (title: string) => ({ title })

const ISSUES = [
  { number: 1, title: 'Ten days', html_url: 'https://h/issues/1', updated_at: at('2026-11-11T12:00:00'), created_at: at('2026-11-01T12:00:00'), closed_at: at('2026-11-11T12:00:00'), milestone: ms('v1') },
  { number: 2, title: 'Day and a half', html_url: 'https://h/issues/2', updated_at: at('2026-10-22T00:00:00'), created_at: at('2026-10-20T12:00:00'), closed_at: at('2026-10-22T00:00:00'), milestone: null },
  { number: 3, title: 'Fifty-nine days', html_url: 'https://h/issues/3', updated_at: at('2026-10-30T12:00:00'), created_at: at('2026-09-01T12:00:00'), closed_at: at('2026-10-30T12:00:00') },
  { number: 4, title: 'Only in 90', html_url: 'https://h/issues/4', updated_at: at('2026-10-05T12:00:00'), created_at: at('2026-10-01T12:00:00'), closed_at: at('2026-10-05T12:00:00') },
  { number: 5, title: 'A pull on GitHub', html_url: 'https://h/pull/5', updated_at: at('2026-11-10T12:00:00'), created_at: at('2026-11-09T12:00:00'), closed_at: at('2026-11-10T12:00:00'), pull_request: {} },
  { number: 6, title: 'Too old', html_url: 'https://h/issues/6', updated_at: at('2026-07-01T12:00:00'), created_at: at('2026-06-01T12:00:00'), closed_at: at('2026-07-01T12:00:00') },
]
const PULLS = [
  { number: 10, title: 'One day', html_url: 'https://h/pull/10', updated_at: at('2026-11-10T12:00:00'), user: user('a'), created_at: at('2026-11-09T12:00:00'), closed_at: at('2026-11-10T12:00:00'), merged_at: at('2026-11-10T12:00:00'), milestone: ms('v1') },
  { number: 11, title: 'Three days', html_url: 'https://h/pull/11', updated_at: at('2026-10-29T12:00:00'), user: user('a'), created_at: at('2026-10-26T12:00:00'), closed_at: at('2026-10-29T12:00:00'), merged_at: at('2026-10-29T12:00:00') },
  { number: 12, title: 'Closed, not merged', html_url: 'https://h/pull/12', updated_at: at('2026-11-03T12:00:00'), user: user('a'), created_at: at('2026-11-02T12:00:00'), closed_at: at('2026-11-03T12:00:00'), merged_at: null },
  { number: 13, title: 'Seven days, no review', html_url: 'https://h/pull/13', updated_at: at('2026-10-08T12:00:00'), user: user('a'), created_at: at('2026-10-01T12:00:00'), closed_at: at('2026-10-08T12:00:00'), merged_at: at('2026-10-08T12:00:00') },
]
const FIRST_REVIEWS: Record<number, string> = { 10: at('2026-11-10T00:00:00'), 11: at('2026-10-28T00:00:00') }

test('first review: the earliest submitted review not by the author and not pending', () => {
  // wf:contract: getFirstReviewAt(reviews, author) returns the submitted_at of the earliest review whose user is not `author`
  // wf:contract: and whose state is not PENDING (GitHub and Forgejo both use PENDING for an unsubmitted review); null when none.
  const reviews = [
    { user: user('b'), state: 'APPROVED', submitted_at: at('2026-10-28T00:00:00') },
    { user: user('a'), state: 'COMMENTED', submitted_at: at('2026-10-26T18:00:00') },
    { user: user('c'), state: 'PENDING', submitted_at: at('2026-10-27T00:00:00') },
    { user: user('d'), state: 'REQUEST_CHANGES', submitted_at: at('2026-10-29T00:00:00') },
  ]
  expect(getFirstReviewAt(reviews, 'a')).toBe(at('2026-10-28T00:00:00'))
  expect(getFirstReviewAt(reviews.filter(review => review.user.login === 'a'), 'a')).toBe(null)
  expect(getFirstReviewAt([], 'a')).toBe(null)
})

test('a 30-day window: lead time, review time and weekly throughput of what closed inside it', () => {
  // wf:contract: toFlowWindow(issues, pulls, firstReviews, now, days) reads the items closed (issues) or merged (pulls) in the last `days` days.
  // wf:contract: leadTime = issue created_at -> closed_at; an entry carrying pull_request is a pull request and is dropped.
  // wf:contract: firstReview = pull created_at -> firstReviews[number], merge = pull created_at -> merged_at, over the merged pulls only;
  // wf:contract: a merged pull with no first review counts for merge only. Durations in days, one decimal.
  // wf:contract: median = middle value, the mean of the two middle ones on an even count; p90 = nearest rank, sorted[ceil(0.9 n) - 1];
  // wf:contract: both null when count is 0.
  // wf:contract: throughput = one entry per UTC ISO week (its Monday, YYYY-MM-DD) from the week holding now - days to the week holding now,
  // wf:contract: oldest first, counting issues closed and pulls merged in that week and inside the window.
  expect(toFlowWindow(ISSUES, PULLS, FIRST_REVIEWS, NOW, 30)).toEqual({
    days: 30,
    leadTime: { count: 3, median: 10, p90: 59 },
    firstReview: { count: 2, median: 1, p90: 1.5 },
    merge: { count: 2, median: 2, p90: 3 },
    throughput: [
      { week: '2026-10-12', issues: 0, pulls: 0 },
      { week: '2026-10-19', issues: 1, pulls: 0 },
      { week: '2026-10-26', issues: 1, pulls: 1 },
      { week: '2026-11-02', issues: 0, pulls: 0 },
      { week: '2026-11-09', issues: 1, pulls: 1 },
    ],
  })
})

test('a 90-day window takes the older items in; an even count takes the mean of the two middle values', () => {
  const window = toFlowWindow(ISSUES, PULLS, FIRST_REVIEWS, NOW, 90)
  expect(window.leadTime).toEqual({ count: 4, median: 7, p90: 59 })
  expect(window.firstReview).toEqual({ count: 2, median: 1, p90: 1.5 })
  expect(window.merge).toEqual({ count: 3, median: 3, p90: 7 })
  expect(window.throughput.length).toBe(14)
  expect(window.throughput[0]).toEqual({ week: '2026-08-10', issues: 0, pulls: 0 })
  expect(window.throughput.find(week => week.week === '2026-10-05')).toEqual({ week: '2026-10-05', issues: 1, pulls: 1 })
  expect(window.throughput.reduce((sum, week) => sum + week.issues, 0)).toBe(4)
  expect(window.throughput.reduce((sum, week) => sum + week.pulls, 0)).toBe(3)
})

test('nothing closed: counts 0, no median, every week empty', () => {
  const window = toFlowWindow([], [], {}, NOW, 30)
  expect(window.leadTime).toEqual({ count: 0, median: null, p90: null })
  expect(window.firstReview).toEqual({ count: 0, median: null, p90: null })
  expect(window.merge).toEqual({ count: 0, median: null, p90: null })
  expect(window.throughput.map(week => week.issues + week.pulls)).toEqual([0, 0, 0, 0, 0])
})

test('the flow of a project: the 30- and 90-day windows and the closed items of the 90 days', () => {
  // wf:contract: toFlow(issues, pulls, firstReviews, now) = { windows: [toFlowWindow(..., 30), toFlowWindow(..., 90)],
  // wf:contract: closedIssues, mergedPulls }: the issues closed and the pulls merged in the last 90 days, most recently closed first,
  // wf:contract: each { number, title, url, closedAt (ISO day of closed_at / merged_at), milestone ('' when none) }.
  // wf:contract: This is the list /pm-digest and /pm-report read from the desk snapshot (Phase 2).
  const flow = toFlow(ISSUES, PULLS, FIRST_REVIEWS, NOW)
  expect(flow.windows).toEqual([toFlowWindow(ISSUES, PULLS, FIRST_REVIEWS, NOW, 30), toFlowWindow(ISSUES, PULLS, FIRST_REVIEWS, NOW, 90)])
  expect(flow.closedIssues).toEqual([
    { number: 1, title: 'Ten days', url: 'https://h/issues/1', closedAt: '2026-11-11', milestone: 'v1' },
    { number: 3, title: 'Fifty-nine days', url: 'https://h/issues/3', closedAt: '2026-10-30', milestone: '' },
    { number: 2, title: 'Day and a half', url: 'https://h/issues/2', closedAt: '2026-10-22', milestone: '' },
    { number: 4, title: 'Only in 90', url: 'https://h/issues/4', closedAt: '2026-10-05', milestone: '' },
  ])
  expect(flow.mergedPulls).toEqual([
    { number: 10, title: 'One day', url: 'https://h/pull/10', closedAt: '2026-11-10', milestone: 'v1' },
    { number: 11, title: 'Three days', url: 'https://h/pull/11', closedAt: '2026-10-29', milestone: '' },
    { number: 13, title: 'Seven days, no review', url: 'https://h/pull/13', closedAt: '2026-10-08', milestone: '' },
  ])
})
