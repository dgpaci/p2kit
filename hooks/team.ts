import type { RoleLine, TeamItem, TeamMember, TeamStatus } from '../types'
import { isDoc } from './yaml'
import type { Value } from './yaml'

export const DEFAULT_WIP_LIMIT = 3
// A pull request waiting for review longer than this, untouched, is stalled.
const STALLED_MS = 7 * 24 * 60 * 60 * 1000
const STATUS_ORDER: TeamStatus[] = ['review', 'inprogress', 'todo', 'waiting', 'stalled']

type RestUser = { login: string }
export type RestIssue = { number: number; title: string; html_url: string; updated_at: string; assignees?: RestUser[] | null; pull_request?: unknown }
export type RestPull = {
  number: number; title: string; html_url: string; updated_at: string; draft?: boolean
  user?: RestUser | null; assignees?: RestUser[] | null; requested_reviewers?: RestUser[] | null
}

const logins = (users: RestUser[] | null | undefined): string[] => (users ?? []).map(user => user.login)
const limitOf = (value: Value | undefined): number | null => (typeof value === 'number' ? value : null)

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
      members.push({ person, login, roles: [label], items: [], wip: 0, wipLimit: limitOf(entry.wip_limit) ?? wipLimit, isOverLimit: false })
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
    // GitHub lists pull requests among issues with `pull_request` set; Forgejo sends `pull_request: null` on plain issues.
    if (issue.pull_request == null && logins(issue.assignees).includes(login)) add('issue', issue, 'todo')
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
