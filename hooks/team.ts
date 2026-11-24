import type { DailyEntry, IssueState, RoleLine, TeamItem, TeamMember, TeamStatus } from '../types'
import { isDoc } from './yaml'
import type { Value } from './yaml'

export const DEFAULT_WIP_LIMIT = 3
// A pull request waiting for review longer than this, untouched, is stalled.
export const STALLED_MS = 7 * 24 * 60 * 60 * 1000
const STATUS_ORDER: TeamStatus[] = ['review', 'inprogress', 'todo', 'waiting', 'stalled']

type RestUser = { login: string }
type RestMilestoneRef = { title: string } | null
export type RestIssue = {
  number: number; title: string; html_url: string; updated_at: string; assignees?: RestUser[] | null; pull_request?: unknown; state?: string
  milestone?: RestMilestoneRef; body?: string | null; created_at?: string; closed_at?: string | null
  // Not from the list: set by the desk from the issue's timeline, true once a commit references the issue.
  has_commits?: boolean
}
export type RestPull = {
  number: number; title: string; html_url: string; updated_at: string; draft?: boolean
  user?: RestUser | null; assignees?: RestUser[] | null; requested_reviewers?: RestUser[] | null
  milestone?: RestMilestoneRef; body?: string | null; created_at?: string; closed_at?: string | null; merged_at?: string | null
}

export const logins = (users: RestUser[] | null | undefined): string[] => (users ?? []).map(user => user.login)
/** An issue, not a pull request: GitHub omits `pull_request` on issues, Forgejo sends it as null. */
export const isPlainIssue = (issue: RestIssue): boolean => issue.pull_request == null

// An event of an issue's timeline: GitHub marks a commit referencing the issue `referenced` with its `commit_id`,
// Forgejo `commit_ref`.
export type TimelineEvent = { event?: string; commit_id?: string | null; type?: string }
const CLOSING_REF = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi

/** The issue numbers a pull request body closes — `closes|fixes|resolves #n` and their tenses, any case — once each, in order. */
export function getClosedRefs(body: string | null | undefined): number[] {
  const refs = [...(body ?? '').matchAll(CLOSING_REF)].map(match => Number(match[1]))
  return [...new Set(refs)]
}

/** Whether a commit references the issue: the work on it has started. Forgejo answers `null` for an empty timeline. */
export const hasCommitRef = (events: TimelineEvent[] | null): boolean =>
  (events ?? []).some(event => (event.event === 'referenced' && Boolean(event.commit_id)) || event.type === 'commit_ref')

/**
 * Where an issue stands: `done` closed; `review` an open non-draft pull closes it; `inprogress` a commit references it
 * (its first commit: the developer has started), or an open draft pull closes it; else `todo`, assigned or not.
 * Assigning alone is the PM's plan, not work in progress. The same rule as forge-desk's.
 */
export function getIssueState(issue: RestIssue, pulls: RestPull[]): IssueState {
  if (issue.state === 'closed') return 'done'
  const closing = pulls.filter(pull => getClosedRefs(pull.body).includes(issue.number))
  if (closing.some(pull => !pull.draft)) return 'review'
  if (issue.has_commits || closing.length > 0) return 'inprogress'
  return 'todo'
}

// An assigned issue as its assignee's work: its pull request in review is waiting on others.
const ISSUE_STATUS: Record<IssueState, TeamStatus> = { todo: 'todo', inprogress: 'inprogress', review: 'waiting', done: 'todo' }
const limitOf = (value: Value | undefined): number | null => (typeof value === 'number' ? value : null)
// A trailing note in brackets is no part of a person's name: `Finizio (Secretary)` is owner `Finizio`.
const NAME_NOTE = /\s*\([^()]*\)\s*$/

/** A person of the roles as the owner of a Daily Log action names them: a trailing note in brackets dropped. The desk helper's `person_name`. */
export const getPersonName = (person: string): string => person.replace(NAME_NOTE, '').trim()

/** The people of the roles, once each in role order, with the login and WIP limit `team.people` gives them; items empty. */
export function readTeam(roles: RoleLine[], team: Value | undefined, errors: string[]): TeamMember[] {
  const section = isDoc(team) ? team : {}
  const wipLimit = limitOf(section.wip_limit) ?? DEFAULT_WIP_LIMIT
  const people = isDoc(section.people) ? section.people : {}
  const members: TeamMember[] = []
  for (const { label, people: names } of roles) {
    for (const person of names) {
      const known = members.find(member => member.person === person)
      if (known) {
        if (!known.roles.includes(label)) known.roles.push(label)
        continue
      }
      if (person in people && !isDoc(people[person])) errors.push(`team.people: ${person}: expected { login, wip_limit }`)
      const entry = isDoc(people[person]) ? people[person] : {}
      const login = typeof entry.login === 'string' || typeof entry.login === 'number' ? String(entry.login) : ''
      members.push({ person, name: getPersonName(person), login, roles: [label], items: [], actions: [], wip: 0, wipLimit: limitOf(entry.wip_limit) ?? wipLimit, isOverLimit: false })
    }
  }
  for (const person of Object.keys(people)) {
    if (!members.some(member => member.person === person)) errors.push(`team.people: ${person} is in no role`)
  }
  return members
}

/** The open issues and pull requests of `login`, each with its status from their point of view, most urgent first. */
export function toTeamItems(login: string, issues: RestIssue[], pulls: RestPull[], now: number): TeamItem[] {
  const found: { item: TeamItem; at: string }[] = []
  const add = (kind: TeamItem['kind'], one: RestIssue | RestPull, status: TeamStatus) =>
    found.push({ item: { kind, number: one.number, title: one.title, status, url: one.html_url, updatedAt: one.updated_at.slice(0, 10) }, at: one.updated_at })
  for (const issue of issues) {
    if (isPlainIssue(issue) && logins(issue.assignees).includes(login)) add('issue', issue, ISSUE_STATUS[getIssueState(issue, pulls)])
  }
  for (const pull of pulls) {
    const author = pull.user?.login ?? ''
    const reviewers = logins(pull.requested_reviewers)
    if (reviewers.includes(login) && author !== login) add('pr', pull, 'review')
    else if (author === login || logins(pull.assignees).includes(login)) {
      if (pull.draft) add('pr', pull, 'inprogress')
      else if (reviewers.some(reviewer => reviewer !== login)) add('pr', pull, now - Date.parse(pull.updated_at) > STALLED_MS ? 'stalled' : 'waiting')
      else add('pr', pull, 'inprogress')
    }
  }
  found.sort((a, b) => STATUS_ORDER.indexOf(a.item.status) - STATUS_ORDER.indexOf(b.item.status) || b.at.localeCompare(a.at))
  return found.map(one => one.item)
}

/** The member carrying `items`, with the WIP they make (every item but the reviews asked of them) and whether it is over the limit. */
export function withItems(member: TeamMember, items: TeamItem[]): TeamMember {
  const wip = items.filter(item => item.status !== 'review').length
  return { ...member, items, wip, isOverLimit: wip > member.wipLimit }
}

/**
 * The members each with the open actions of the Daily Log they own, matched on the name with its note dropped, case aside;
 * and the open actions no member owns, or nobody (`strayActions`), in file order.
 */
export function withActions(members: TeamMember[], log: DailyEntry[]): { team: TeamMember[]; strayActions: DailyEntry[] } {
  const open = log.filter(entry => entry.kind === 'action' && entry.status === 'open')
  const ownerOf = (entry: DailyEntry) => members.find(member => member.name.toLowerCase() === getPersonName(entry.owner).toLowerCase())
  return {
    team: members.map(member => ({ ...member, actions: open.filter(entry => entry.owner && ownerOf(entry) === member) })),
    strayActions: open.filter(entry => !entry.owner || !ownerOf(entry)),
  }
}
