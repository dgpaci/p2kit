import { getMilestonePackage } from './milestones'
import type { Project } from '../types'

// The open columns of a board lane; the Done column is the milestone's closed count, closed items are not read.
export type LaneColumn = 'todo' | 'inprogress' | 'review'
// An open issue or pull request on the board; `milestone` its title or '' (shown on the Unplanned lane).
// `repo` the repo of a cross-repo project the item belongs to, absent otherwise.
export type LaneCard = { kind: 'issue' | 'pr'; repo?: string; number: number; title: string; url: string; assignees: string[]; column: LaneColumn; milestone: string }
// One swimlane: a work package and the open items of its milestone, or the Unplanned lane (`wp` ''). `progress` the milestone's
// closed over all items, null when the milestone is not among the open ones read; `reopened` the open items of a completed or
// archived work package, 0 otherwise.
export type BoardLane = { wp: string; title: string; status: string; milestone: string; progress: { closed: number; total: number } | null; reopened: number; cards: LaneCard[] }

const DELIVERED = new Set(['completed', 'archived'])

/** The swimlanes of the Board tab: one per work package owning a milestone (cancelled left out, archived only with open items), by id, then Unplanned — the open items of no work package. */
export function getBoardLanes(project: Project): BoardLane[] {
  // A project held by older code or built by hand may lack the forge fields: read them as empty.
  const issues = project.forgeIssues ?? []
  const pulls = project.forgePulls ?? []
  const milestones = project.milestones ?? []
  const workPackages = project.workPackages ?? []
  const cards: LaneCard[] = [
    ...issues.map(issue => ({ kind: 'issue' as const, ...(issue.repo ? { repo: issue.repo } : {}), number: issue.number, title: issue.title, url: issue.url, assignees: issue.assignees ?? [],
      column: (issue.state === 'review' || issue.state === 'inprogress' ? issue.state : 'todo') as LaneColumn, milestone: issue.milestone ?? '' })),
    ...pulls.map(pull => ({ kind: 'pr' as const, ...(pull.repo ? { repo: pull.repo } : {}), number: pull.number, title: pull.title, url: pull.url, assignees: pull.assignees ?? [],
      column: (pull.draft ? 'inprogress' : 'review') as LaneColumn, milestone: pull.milestone ?? '' })),
  ]
  const ownerOf = (title: string) => (title ? getMilestonePackage(workPackages, title) : undefined)

  const lanes: BoardLane[] = []
  for (const wp of [...workPackages].sort((a, b) => a.id.localeCompare(b.id))) {
    const title = wp.delivery?.milestone ?? ''
    if (!title || ownerOf(title) !== wp) continue
    const own = cards.filter(card => card.milestone === title)
    if (wp.status === 'archived' && !own.length) continue
    const open = milestones.find(m => m.title === title) ?? wp.delivery?.forge?.milestone
    lanes.push({
      wp: wp.id, title: wp.title, status: wp.status, milestone: title,
      progress: open ? { closed: open.closed, total: open.open + open.closed } : null,
      reopened: DELIVERED.has(wp.status) ? own.length : 0,
      cards: own,
    })
  }
  lanes.push({ wp: '', title: 'Unplanned', status: '', milestone: '', progress: null, reopened: 0, cards: cards.filter(card => !ownerOf(card.milestone)) })
  return lanes
}
