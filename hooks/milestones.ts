import type { ForgeIssue, ForgePull, MilestoneItem, MilestoneProgress, WorkPackage, WpForge } from '../types'
import { toMilestone } from './forge'
import { DEFAULT_HEADINGS, getMissingHeadings } from './readiness'
import type { RestMilestone } from './forge'
import { getClosedRefs, getIssueState, isPlainIssue, logins, repoOf, STALLED_MS } from './team'
import type { RestIssue, RestPull } from './team'

export { getClosedRefs, getIssueState } from './team'

/** A pull request waiting on review: not a draft, with at least one requested reviewer. */
const isInReview = (pull: RestPull): boolean => !pull.draft && (pull.requested_reviewers ?? []).length > 0

/**
 * The milestones of a cross-repo project, one per title: the counts of the repos sharing it summed, the earliest due day kept.
 * A single repo's list comes back as it is.
 */
export function mergeMilestones(milestones: RestMilestone[]): RestMilestone[] {
  const merged = new Map<string, RestMilestone>()
  for (const one of milestones) {
    const known = merged.get(one.title)
    if (!known) merged.set(one.title, one)
    else {
      const dues = [known.due_on, one.due_on].filter((due): due is string => Boolean(due)).sort()
      merged.set(one.title, { ...known, open_issues: known.open_issues + one.open_issues, closed_issues: known.closed_issues + one.closed_issues, due_on: dues[0] ?? null })
    }
  }
  return [...merged.values()]
}

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

/** The open issues (pull requests dropped), most recently updated first, each with the readiness headings its body lacks, its assignees and its state against the open pulls. */
export function toForgeIssues(issues: RestIssue[], headings: string[] = DEFAULT_HEADINGS, pulls: RestPull[] = []): ForgeIssue[] {
  return issues
    .filter(isPlainIssue)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(issue => ({
      ...repoOf(issue), number: issue.number, title: issue.title, url: issue.html_url, createdAt: (issue.created_at ?? '').slice(0, 10), updatedAt: issue.updated_at.slice(0, 10),
      milestone: issue.milestone?.title ?? '', missing: getMissingHeadings(issue.body, headings), assignees: logins(issue.assignees), state: getIssueState(issue, pulls),
    }))
}

/** The open pull requests, most recently updated first, each marked draft or in review. */
export function toForgePulls(pulls: RestPull[]): ForgePull[] {
  return [...pulls]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(pull => ({
      ...repoOf(pull), number: pull.number, title: pull.title, url: pull.html_url, createdAt: (pull.created_at ?? '').slice(0, 10), updatedAt: pull.updated_at.slice(0, 10),
      milestone: pull.milestone?.title ?? '', draft: Boolean(pull.draft), inReview: isInReview(pull), assignees: logins(pull.assignees), closes: getClosedRefs(pull.body),
    }))
}

/** The work package of a milestone: the one whose `milestone:` is its title, cancelled ones left out, the lowest id when several. */
export function getMilestonePackage(workPackages: WorkPackage[], title: string): WorkPackage | undefined {
  return workPackages
    .filter(wp => wp.delivery?.milestone === title && wp.status !== 'cancelled')
    .sort((a, b) => a.id.localeCompare(b.id))[0]
}

// An issue of a milestone as both forges list it: a pull request carries `pull_request`, with `merged_at` once merged.
export type RestMilestoneItem = { number: number; title: string; html_url: string; state: string; pull_request?: { merged_at?: string | null } | null }

/** Items open first, then by number, newest first. */
export const sortItems = (items: MilestoneItem[]): MilestoneItem[] =>
  [...items].sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.number - a.number)

/** The issues and pull requests of a milestone, open ones first, then by number, newest first; a merged pull is `merged`. */
export function toMilestoneItems(list: RestMilestoneItem[]): MilestoneItem[] {
  return sortItems(list
    .map(item => ({
      kind: item.pull_request ? 'pr' as const : 'issue' as const,
      number: item.number, title: item.title, url: item.html_url,
      state: item.pull_request?.merged_at ? 'merged' as const : item.state === 'open' ? 'open' as const : 'closed' as const,
    })))
}

/** The milestone's items closed over all of them, from its item list when read, else from its counts; null without a milestone. */
export function getItemProgress(forge: WpForge | null): { done: number; total: number } | null {
  if (forge?.milestoneItems?.length) return { done: forge.milestoneItems.filter(item => item.state !== 'open').length, total: forge.milestoneItems.length }
  return forge?.milestone ? { done: forge.milestone.closed, total: forge.milestone.open + forge.milestone.closed } : null
}
