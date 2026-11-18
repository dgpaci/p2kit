import type { Objective, WorkPackage } from '../types'

// `- [ ] **O-2** Nothing gets lost — …` or `- [x] ~~**O-8** Dropped~~`: box, optional strike, id, the rest of the first line.
const ENTRY = /^[-*] \[([ xX])\] (~~)?\*\*(O-\d+)\*\*\s*(.*)$/

type BriefObjective = Pick<Objective, 'id' | 'title' | 'isMet' | 'isDropped'>

/** The `## Objectives` checklist of a brief, in file order; null when the brief has no such section. The title is the first line
 * up to ` — `, `. *Done when` or the end, strike marks dropped. */
export function parseObjectives(text: string): BriefObjective[] | null {
  const lines = text.split('\n')
  const start = lines.findIndex(line => /^## Objectives\s*$/.test(line))
  if (start < 0) return null
  const found: BriefObjective[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(line)) break
    const match = ENTRY.exec(line.trim())
    if (!match) continue
    const title = match[4].replace(/~~/g, '').split(/ — |\.?\s*\*Done when/)[0].trim()
    found.push({ id: match[3], title, isMet: match[1] !== ' ', isDropped: Boolean(match[2]) })
  }
  return found
}

/** Each brief objective with the work packages naming it in `objectives:` (cancelled ones left out) and how many are completed or
 * archived; an id a work package names that the brief lacks goes to `errors`. No section in the brief: no objectives, no error. */
export function getObjectives(brief: string | undefined, workPackages: WorkPackage[], errors: string[]): Objective[] {
  const objectives = parseObjectives(brief ?? '')
  if (!objectives) return []
  const ids = new Set(objectives.map(one => one.id))
  for (const wp of workPackages) {
    for (const id of wp.objectives) if (!ids.has(id)) errors.push(`${wp.id}: objectives: ${id} is not in the brief`)
  }
  return objectives.map(one => {
    const serving = workPackages.filter(wp => wp.status !== 'cancelled' && wp.objectives.includes(one.id))
    return { ...one, wps: serving.map(wp => wp.id), done: serving.filter(wp => wp.status === 'completed' || wp.status === 'archived').length }
  })
}
