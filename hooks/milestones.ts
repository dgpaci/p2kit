import type { ForgeIssue, ForgePull, MilestoneProgress, WorkPackage } from '../types'
import { toMilestone } from './forge'
import { DEFAULT_HEADINGS, getMissingHeadings } from './readiness'
import type { RestMilestone } from './forge'
import { isPlainIssue, STALLED_MS } from './team'
import type { RestIssue, RestPull } from './team'

/** A pull request waiting on review: not a draft, with at least one requested reviewer. */
const isInReview = (pull: RestPull): boolean => !pull.draft && (pull.requested_reviewers ?? []).length > 0

/** Each milestone with its stalled open items and its open pulls in review, by due day (none last), then title. */
export function toMilestoneProgress(milestones: RestMilestone[], issues: RestIssue[], pulls: RestPull[], now: number): MilestoneProgress[] {
  const progress = milestones.map(one => {
    const ofIt = <T extends RestIssue | RestPull>(list: T[]) => list.filter(item => item.milestone?.title === one.title)
    const items = [...ofIt(issues.filter(isPlainIssue)), ...ofIt(pulls)]
    return {
      ...toMilestone([one], one.title)!,
      stalled: items.filter(item => now - Date.parse(item.updated_at) > STALLED_MS).length,
      inReview: ofIt(pulls).filter(isInReview).length,
    }
  })
  return progress.sort((a, b) => (a.due === b.due ? 0 : !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due)) || a.title.localeCompare(b.title))
}

/** The open issues (pull requests dropped), most recently updated first, each with the readiness headings its body lacks. */
export function toForgeIssues(issues: RestIssue[], headings: string[] = DEFAULT_HEADINGS): ForgeIssue[] {
  return issues
    .filter(isPlainIssue)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(issue => ({ number: issue.number, title: issue.title, url: issue.html_url, updatedAt: issue.updated_at.slice(0, 10), milestone: issue.milestone?.title ?? '', missing: getMissingHeadings(issue.body, headings) }))
}

/** The open pull requests, most recently updated first, each marked draft or in review. */
export function toForgePulls(pulls: RestPull[]): ForgePull[] {
  return [...pulls]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(pull => ({
      number: pull.number, title: pull.title, url: pull.html_url, updatedAt: pull.updated_at.slice(0, 10),
      milestone: pull.milestone?.title ?? '', draft: Boolean(pull.draft), inReview: isInReview(pull),
    }))
}

/** The work package of a milestone: the one whose `milestone:` is its title, cancelled ones left out, the lowest id when several. */
export function getMilestonePackage(workPackages: WorkPackage[], title: string): WorkPackage | undefined {
  return workPackages
    .filter(wp => wp.delivery?.milestone === title && wp.status !== 'cancelled')
    .sort((a, b) => a.id.localeCompare(b.id))[0]
}
