import type { ClosedItem, Flow, FlowStat, FlowWindow } from '../types'
import { isPlainIssue } from './team'
import type { RestIssue, RestPull } from './team'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
// The windows the desk shows, in days; the last one is the span the forge is read for.
export const FLOW_WINDOWS = [30, 90]

type RestReview = { user?: { login: string } | null; state: string; submitted_at?: string | null }

// Not a submitted review: GitHub and Forgejo keep an unsubmitted review as PENDING; Forgejo also lists each requested reviewer as REQUEST_REVIEW.
const NOT_A_REVIEW = ['PENDING', 'REQUEST_REVIEW']

/** The submitted_at of the earliest submitted review not by `author`; null when none. */
export function getFirstReviewAt(reviews: RestReview[], author: string): string | null {
  const times = reviews
    .filter(review => !NOT_A_REVIEW.includes(review.state) && review.user?.login !== author && review.submitted_at)
    .map(review => review.submitted_at!)
  return times.length ? times.reduce((first, one) => (Date.parse(one) < Date.parse(first) ? one : first)) : null
}

/** A stat as the Metrics tab shows it: `median · p90 (n)`, or `—` when nothing was counted. */
export const getFlowCell = (stat: FlowStat): string => (stat.count ? `${stat.median} · ${stat.p90} (${stat.count})` : '—')

const round = (value: number): number => Math.round(value * 10) / 10

/** Median and nearest-rank p90 of durations in days, one decimal; null on an empty list. */
function toFlowStat(days: number[]): FlowStat {
  const sorted = [...days].sort((a, b) => a - b)
  const n = sorted.length
  if (!n) return { count: 0, median: null, p90: null }
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  return { count: n, median: round(median), p90: round(sorted[Math.ceil(0.9 * n) - 1]) }
}

/** The Monday of the UTC ISO week holding `time`, as a time. */
function getWeekStart(time: number): number {
  const day = new Date(time)
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
}

const span = (from: string | undefined, to: string): number[] => (from ? [(Date.parse(to) - Date.parse(from)) / DAY_MS] : [])

/** The issues closed and the pulls merged in the last `days` days; an entry carrying pull_request is dropped from the issues. */
function getClosedIn(issues: RestIssue[], pulls: RestPull[], now: number, days: number) {
  const isInside = (at: string | null | undefined): at is string => Boolean(at) && Date.parse(at!) > now - days * DAY_MS && Date.parse(at!) <= now
  return {
    closed: issues.filter(issue => isPlainIssue(issue) && isInside(issue.closed_at)),
    merged: pulls.filter(pull => isInside(pull.merged_at)),
  }
}

/** Lead, first-review and merge time and the weekly throughput of the items closed or merged in the last `days` days. */
export function toFlowWindow(issues: RestIssue[], pulls: RestPull[], firstReviews: Record<number, string>, now: number, days: number): FlowWindow {
  const { closed, merged } = getClosedIn(issues, pulls, now, days)
  const throughput: FlowWindow['throughput'] = []
  for (let week = getWeekStart(now - days * DAY_MS); week <= now; week += WEEK_MS) {
    const isOfWeek = (at: string) => getWeekStart(Date.parse(at)) === week
    throughput.push({
      week: new Date(week).toISOString().slice(0, 10),
      issues: closed.filter(issue => isOfWeek(issue.closed_at!)).length,
      pulls: merged.filter(pull => isOfWeek(pull.merged_at!)).length,
    })
  }
  return {
    days,
    leadTime: toFlowStat(closed.flatMap(issue => span(issue.created_at, issue.closed_at!))),
    firstReview: toFlowStat(merged.flatMap(pull => (firstReviews[pull.number] ? span(pull.created_at, firstReviews[pull.number]) : []))),
    merge: toFlowStat(merged.flatMap(pull => span(pull.created_at, pull.merged_at!))),
    throughput,
  }
}

const toClosedItem = (item: RestIssue | RestPull, at: string): ClosedItem =>
  ({ number: item.number, title: item.title, url: item.html_url, closedAt: at.slice(0, 10), milestone: item.milestone?.title ?? '' })

/** The 30- and 90-day windows and the issues closed and pulls merged in the 90 days, most recently closed first. */
export function toFlow(issues: RestIssue[], pulls: RestPull[], firstReviews: Record<number, string>, now: number): Flow {
  const { closed, merged } = getClosedIn(issues, pulls, now, FLOW_WINDOWS[FLOW_WINDOWS.length - 1])
  const newest = <T>(list: T[], at: (item: T) => string) => [...list].sort((a, b) => at(b).localeCompare(at(a)))
  return {
    windows: FLOW_WINDOWS.map(days => toFlowWindow(issues, pulls, firstReviews, now, days)),
    closedIssues: newest(closed, issue => issue.closed_at!).map(issue => toClosedItem(issue, issue.closed_at!)),
    mergedPulls: newest(merged, pull => pull.merged_at!).map(pull => toClosedItem(pull, pull.merged_at!)),
  }
}
