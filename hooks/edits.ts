// One-line edits of .pm/ files, as the pane applies them: the same rules and messages as the desk helper
// (server/desk_server.py `set_key`, `set_note_status`, `place_wp`), checked by both suites on server/edit-cases.mjs.

export class EditError extends Error {}

export type LineChange = { text: string; line: number; before: string; after: string }

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const lines = (text: string): string[] => text.split(/(?<=\n)/)
const strip = (line: string): string => line.replace(/\r?\n$/, '')

/** The index of the closing `---` of the frontmatter; the file must open with one. */
function getFrontmatterEnd(all: string[]): number {
  if (!all.length || strip(all[0]) !== '---') throw new EditError('the file has no frontmatter')
  const end = all.findIndex((line, index) => index > 0 && strip(line) === '---')
  if (end < 0) throw new EditError('the frontmatter is not closed')
  return end
}

const getKeyLines = (all: string[], end: number, key: string): number[] => {
  const pattern = new RegExp(`^${escape(key)}:(\\s|$)`)
  return all.flatMap((line, index) => (index > 0 && index < end && pattern.test(line) ? [index] : []))
}

const unquote = (raw: string): string => {
  const value = raw.trim()
  return value.length >= 2 && value[0] === value.at(-1) && (value[0] === "'" || value[0] === '"') ? value.slice(1, -1) : value
}

/** A frontmatter key's value, quotes dropped; null when absent. Refuses a key written twice. */
export function readFrontmatterKey(text: string, key: string): string | null {
  const all = lines(text)
  const found = getKeyLines(all, getFrontmatterEnd(all), key)
  if (found.length > 1) throw new EditError(`${key}: appears more than once`)
  return found.length ? unquote(all[found[0]].slice(key.length + 1).split(' #')[0]) : null
}

/**
 * Sets one frontmatter key to an already rendered scalar, or removes it when `rendered` is null; a missing key is
 * added before the closing `---`. Refuses a key written twice, a value already set, removing a key that is not there.
 */
export function setFrontmatterKey(text: string, key: string, rendered: string | null): LineChange {
  const all = lines(text)
  const end = getFrontmatterEnd(all)
  const found = getKeyLines(all, end, key)
  if (found.length > 1) throw new EditError(`${key}: appears more than once`)
  const after = rendered === null ? null : `${key}: ${rendered}\n`
  if (found.length) {
    const index = found[0]
    const before = all[index]
    if (after === before) throw new EditError(`${key} is already ${rendered}`)
    all.splice(index, 1, ...(after === null ? [] : [after]))
    return { text: all.join(''), line: index + 1, before: strip(before), after: after === null ? '' : strip(after) }
  }
  if (after === null) throw new EditError(`${key} is not set`)
  all.splice(end, 0, after)
  return { text: all.join(''), line: end + 1, before: '', after: strip(after) }
}

/** The value of `key` in a flow-map line, quotes dropped; null when absent. */
function getNoteField(line: string, key: string): string | null {
  const match = new RegExp(`\\b${escape(key)}:\\s*('[^']*'|"[^"]*"|[^,}]*)`).exec(line)
  return match ? unquote(match[1]) : null
}

/** Sets `status:` of the one note (a flow-map line of commit-notes.yaml) whose sha and text are the given ones. */
export function setNoteStatus(text: string, sha: string, noteText: string, status: 'open' | 'closed'): LineChange {
  const all = lines(text)
  const shaField = new RegExp(`\\bsha:\\s*${escape(sha)}\\s*[,}]`)
  const found = all.flatMap((line, index) => (shaField.test(line) && getNoteField(line, 'text') === noteText ? [index] : []))
  if (!found.length) throw new EditError('note not found')
  if (found.length > 1) throw new EditError('more than one note matches')
  const index = found[0]
  const line = all[index]
  const fields = [...line.matchAll(/\bstatus:\s*(open|closed)\b/g)]
  if (fields.length !== 1) throw new EditError('the note has no single status')
  if (fields[0][1] === status) throw new EditError(`the note is already ${status}`)
  const after = line.replace(/\bstatus:\s*(open|closed)\b/, `status: ${status}`)
  all[index] = after
  return { text: all.join(''), line: index + 1, before: strip(line), after: strip(after) }
}

// A status moves only along these edges: completing is the PM stating the Board's decision.
export const STATUS_FROM: Record<'completed' | 'archived', readonly string[]> = { completed: ['authorized', 'in-progress'], archived: ['completed'] }

/** The edit setting a work package `completed` or `archived`, refused off its edges. */
export function setWpStatus(text: string, id: string, value: 'completed' | 'archived'): LineChange {
  const status = readFrontmatterKey(text, 'status')
  if (!STATUS_FROM[value].includes(status ?? '')) throw new EditError(`${id} is ${status}: only ${STATUS_FROM[value].join(' or ')} becomes ${value}`)
  return setFrontmatterKey(text, 'status', value)
}

const HORIZON_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later' }
const CLOSED = ['completed', 'archived', 'cancelled']
const MAX_RANK = 999

export type PlaceEdit = { id: string; text: string; changes: Omit<LineChange, 'text'>[] }

/** Status, horizon and rank of a work package as the desk reads them: a horizon or a rank it does not take reads as none. */
function getPlaceFields(text: string): { status: string; horizon: string; rank: number | null } {
  const horizon = readFrontmatterKey(text, 'horizon') ?? ''
  const rank = readFrontmatterKey(text, 'rank')
  return { status: readFrontmatterKey(text, 'status') || 'draft', horizon: horizon in HORIZON_LABEL ? horizon : '', rank: rank && /^\d+(\.\d+)?$/.test(rank) ? Number(rank) : null }
}

/**
 * Places an open work package in a horizon, above or below `beside` or last; horizon '' takes it off the roadmap (the desk
 * helper's `place_wp`). files: id → text of every work package. The target keeps its rank when it fits between its new
 * neighbours, else takes the first free one between them; a group with no room, a tie or a work package with no rank is
 * renumbered 1..n. The target's file comes first; a move that changes nothing is refused.
 */
export function placeWp(files: Record<string, string>, target: string, horizon: string, beside: string | null = null, side: string | null = null): { summary: string; files: PlaceEdit[] } {
  if (!(horizon in HORIZON_LABEL) && horizon !== '') throw new EditError('horizon is now, next or later')
  if (!(target in files)) throw new EditError(`${target} not found`)
  const fields: Record<string, ReturnType<typeof getPlaceFields>> = {}
  for (const [id, text] of Object.entries(files)) {
    try {
      fields[id] = getPlaceFields(text)
    } catch (error) {
      if (id === target || !(error instanceof EditError)) throw error
    }
  }
  const { status, horizon: current, rank } = fields[target]
  if (CLOSED.includes(status)) throw new EditError(`${target} is ${status}: only an open work package is placed`)
  const edits = new Map<string, [string, string | null][]>([[target, []]])
  let summary: string
  if (!horizon) {
    edits.set(target, ['horizon', 'rank'].filter(key => readFrontmatterKey(files[target], key) !== null).map(key => [key, null]))
    if (!edits.get(target)!.length) throw new EditError(`${target} is not placed`)
    summary = `Take ${target} off the roadmap`
  } else {
    const label = HORIZON_LABEL[horizon]
    const rankOf = (id: string) => fields[id].rank ?? Infinity
    const group = Object.keys(fields).filter(id => id !== target && !CLOSED.includes(fields[id].status) && fields[id].horizon === horizon)
      .sort((a, b) => rankOf(a) - rankOf(b) || (a < b ? -1 : a > b ? 1 : 0))
    let index = group.length
    if (beside !== null) {
      if (beside === target) throw new EditError('a work package is not placed beside itself')
      if (!group.includes(beside)) throw new EditError(`${beside} is not in ${label}`)
      if (side !== 'above' && side !== 'below') throw new EditError('a work package goes above or below another one')
      index = group.indexOf(beside) + (side === 'below' ? 1 : 0)
    }
    const ranks = group.map(id => fields[id].rank)
    const low = index ? ranks[index - 1]! : 0
    const high = index < group.length ? ranks[index]! : MAX_RANK + 1
    const isRanked = ranks.every((r, i) => r !== null && (i === 0 || ranks[i - 1]! < r))
    const ranking = new Map<string, number>()
    if (isRanked && rank !== null && low < rank && rank < high) ranking.set(target, rank)
    else if (isRanked && Math.floor(low) + 1 < high) ranking.set(target, Math.floor(low) + 1)
    else [...group.slice(0, index), target, ...group.slice(index)].forEach((id, n) => ranking.set(id, n + 1))
    if (current !== horizon) edits.get(target)!.push(['horizon', horizon])
    if (ranking.get(target) !== rank) edits.get(target)!.push(['rank', String(ranking.get(target))])
    for (const id of group) if (ranking.has(id) && ranking.get(id) !== fields[id].rank) edits.set(id, [['rank', String(ranking.get(id))]])
    const more = edits.size - 1
    summary = `Place ${target} in ${label} at rank ${ranking.get(target)}` + (more ? `, renumbering ${more} more` : '')
  }
  if (![...edits.values()].some(keys => keys.length)) throw new EditError(`${target} is already there`)
  return {
    summary,
    files: [...edits].map(([id, keys]) => {
      let text = files[id]
      const changes = keys.map(([key, rendered]) => {
        const { text: next, ...change } = setFrontmatterKey(text, key, rendered)
        text = next
        return change
      })
      return { id, text, changes }
    }),
  }
}
