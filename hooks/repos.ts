import type { ProjectRepo } from '../types'
import { detectForge } from './forge'
import type { ForgeTarget } from './forge'
import { isDoc } from './yaml'
import type { Value } from './yaml'

const LIST_ERROR = 'repos: expected a list of { remote, label }'
const REMOTE = /^[\w.-]+\/[\w.-]+\/[\w.-]+$/

// A forge to read for a project: the origin (`label` and `name` '') or one repo of `repos:`.
export type RepoTarget = ForgeTarget & { label: string; name: string }

/**
 * The repos of project.yaml `repos:`, each `{ remote: host/owner/repo, label }`; [] when the key is absent. A malformed entry is
 * an error and is left out. `name` is the repo's own name, or owner/repo when two repos share it.
 */
export function readRepos(value: Value | undefined, errors: string[]): ProjectRepo[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    errors.push(LIST_ERROR)
    return []
  }
  const repos: { remote: string; label: string }[] = []
  for (const entry of value) {
    const remote = isDoc(entry) && typeof entry.remote === 'string' ? entry.remote.trim().replace(/\/+$/, '') : ''
    const label = isDoc(entry) && (typeof entry.label === 'string' || typeof entry.label === 'number') ? String(entry.label).trim() : ''
    if (!remote || !label) errors.push(`repos: ${JSON.stringify(entry)}: expected { remote, label }`)
    else if (!REMOTE.test(remote)) errors.push(`repos: ${remote}: expected host/owner/repo`)
    else if (repos.some(one => one.remote.toLowerCase() === remote.toLowerCase())) errors.push(`repos: ${remote} listed twice`)
    else repos.push({ remote, label })
  }
  const short = (remote: string): string => remote.split('/')[2] ?? remote
  return repos.map(({ remote, label }) => {
    const isShared = repos.filter(one => short(one.remote).toLowerCase() === short(remote).toLowerCase()).length > 1
    return { remote, label, name: isShared ? remote.split('/').slice(1).join('/') : short(remote) }
  })
}

/** The forge of a repo of `repos:`: github.com is GitHub, any other host Forgejo, as for an origin. */
export function toRepoTarget(repo: ProjectRepo): RepoTarget {
  return { ...detectForge(`https://${repo.remote}`)!, label: repo.label, name: repo.name }
}

/** How the desk names an issue or a pull request: `#n`, `PR #n`, with its repo in front on a cross-repo project (`genropy#498`). */
export const getItemRef = (item: { repo?: string; number: number }, kind: 'issue' | 'pr' = 'issue'): string =>
  `${kind === 'pr' ? 'PR ' : ''}${item.repo ?? ''}#${item.number}`

const ITEM_REF = /^(?:([\w./-]+))?#(\d+)$/

/**
 * The references of a work package's `items:`, each `repo#n` or `#n` (a bare number is `#n`), once each, in order; a malformed one
 * goes to `errors` and is left out.
 */
export function readItemRefs(id: string, value: Value | undefined, errors: string[]): string[] {
  const entries = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
  const refs: string[] = []
  for (const entry of entries) {
    const ref = typeof entry === 'number' ? `#${entry}` : typeof entry === 'string' ? entry.trim() : ''
    if (!ITEM_REF.test(ref)) errors.push(`${id}: items: ${JSON.stringify(entry)} is not a reference like repo#12`)
    else if (!refs.includes(ref)) refs.push(ref)
  }
  return refs
}

/** The repo name and number of a reference read by readItemRefs. */
export function parseItemRef(ref: string): { repo: string; number: number } {
  const match = ITEM_REF.exec(ref)!
  return { repo: match[1] ?? '', number: Number(match[2]) }
}
