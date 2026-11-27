// One-line edits of .pm/ files, as the pane applies them: the same rules and messages as the desk helper
// (server/desk_server.py `set_key`, `set_note_status`, `place_wp`, `add_log_entry`, `add_problem`, `add_risk`), checked by
// both suites on server/edit-cases.mjs.

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

// A new entry of a register, from the desk's contextual dialogs (Log, + problem, + risk): the helper's `add_log_entry`,
// `add_problem`, `add_risk`, on the shared cases.
export const LOG_KINDS = ['decision', 'action', 'problem', 'event', 'note'] as const
export const PROBLEM_TYPES = ['request-for-change', 'off-specification', 'problem'] as const
export const LEVELS = ['low', 'medium', 'high'] as const
export const RISK_CATEGORIES = ['threat', 'opportunity'] as const
export const RISK_RESPONSES = ['avoid', 'reduce', 'fallback', 'transfer', 'accept', 'share', 'exploit', 'enhance'] as const
const MAX_TITLE = 200
const MAX_LINE = 500
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 _.,()/&+-]*$/
const SPECIAL = /^([-+.\d]+|true|false|null|yes|no)$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

export type EntryChange = { line: number; before: string; after: string }
export type NewEntry = { text: string; id: string; changes: EntryChange[] }

/** A text as a scalar of the .pm/ YAML subset: plain when safe, else quoted; the subset has no escapes. */
export function toScalar(value: string): string {
  if (/[\r\n]/.test(value)) throw new EditError('a value cannot span lines')
  if (PLAIN.test(value) && value.trim() === value && !SPECIAL.test(value)) return value
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  throw new EditError('a value cannot hold both kinds of quote')
}

/** As toScalar, quoted when it holds a comma: a scalar inside a flow map. */
export function toFlowScalar(value: string): string {
  const rendered = toScalar(value)
  return rendered.includes(',') && !`'"`.includes(rendered[0]) ? `'${rendered}'` : rendered
}

/** A text in quotes, `prefer` unless it holds that quote. */
function quoted(value: string, prefer: "'" | '"'): string {
  const other = prefer === "'" ? '"' : "'"
  if (!value.includes(prefer)) return prefer + value + prefer
  if (!value.includes(other)) return other + value + other
  throw new EditError('a value cannot hold both kinds of quote')
}

/** A text field of a new entry: trimmed, one line, up to `limit` characters; '' when absent. */
function oneLine(value: unknown, limit: number, message: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/[\r\n]/.test(text) || text.length > limit) throw new EditError(message)
  return text
}

/** The id after the highest `<prefix>-<n>` of the file, three digits at least. */
function getNextEntryId(text: string | null, prefix: string): string {
  const found = [...(text ?? '').matchAll(new RegExp(`\\bid:\\s*['"]?${escape(prefix)}-(\\d+)`, 'g'))].map(m => Number(m[1]))
  return `${prefix}-${String(Math.max(0, ...found) + 1).padStart(3, '0')}`
}

/**
 * Appends the lines of one entry to the list `key:` of a register, the last top-level key of the file; a missing file or an
 * empty `key: []` becomes `key:`. The changes: the `[]` line when replaced, then the entry.
 */
function appendEntry(text: string | null, key: string, block: string[]): { text: string; changes: EntryChange[] } {
  const changes: EntryChange[] = []
  const all = text ? lines(text) : []
  if (all.length && !all.at(-1)!.endsWith('\n')) all[all.length - 1] += '\n'
  if (!all.some(line => line.trim() && !line.trimStart().startsWith('#'))) {
    all.push(`${key}:\n`)
    changes.push({ line: all.length, before: '', after: `${key}:` })
  } else {
    const pattern = new RegExp(`^${escape(key)}:(\\s|$)`)
    const head = all.flatMap((line, index) => (pattern.test(line) ? [index] : []))
    if (head.length !== 1) throw new EditError(`the file has no single ${key}: list`)
    const index = head[0]
    const rest = all[index].slice(key.length + 1).split(' #')[0].trim()
    if (rest === '[]') {
      changes.push({ line: index + 1, before: strip(all[index]), after: `${key}:` })
      all[index] = `${key}:\n`
    } else if (rest) {
      throw new EditError(`${key}: is not a block list`)
    }
    if (all.slice(index + 1).some(line => /^[^\s#-]/.test(line))) throw new EditError(`${key}: is not the last list of the file`)
  }
  changes.push({ line: all.length + 1, before: '', after: block.join('\n') })
  return { text: all.join('') + block.map(line => `${line}\n`).join(''), changes }
}

/** A new one-line entry of the Daily Log, `source: manual`: an action carries status open, and optionally its owner and due day. */
export function addLogEntry(text: string | null, day: string, kind: string, entryText: unknown, owner: unknown = '', due: unknown = ''): NewEntry {
  if (!(LOG_KINDS as readonly string[]).includes(kind)) throw new EditError('a log entry is a decision, an action, a problem, an event or a note')
  const message = `a log entry needs a text of one line, up to ${MAX_LINE} characters`
  const body = oneLine(entryText, MAX_LINE, message)
  if (!body) throw new EditError(message)
  const who = oneLine(owner, 100, 'an owner is a name')
  const when = typeof due === 'string' ? due.trim() : ''
  if (kind !== 'action' && (who || when)) throw new EditError('only an action has an owner and a due date')
  if (when && !DAY.test(when)) throw new EditError('a due date is yyyy-mm-dd')
  const id = getNextEntryId(text, 'D')
  const fields = [`id: ${id}`, `date: ${day}`, `kind: ${kind}`, 'source: manual', `text: ${quoted(body, "'")}`,
    ...(who ? [`owner: ${toFlowScalar(who)}`] : []), ...(when ? [`due: ${when}`] : []), ...(kind === 'action' ? ['status: open'] : [])]
  return { id, ...appendEntry(text, 'entries', [`  - { ${fields.join(', ')} }`]) }
}

/** A new entry of the Problems register (issues.yaml), open and raised on `day`. */
export function addProblem(text: string | null, day: string, title: unknown, kind: string, priority: string): NewEntry {
  const message = `a problem needs a title of one line, up to ${MAX_TITLE} characters`
  const name = oneLine(title, MAX_TITLE, message)
  if (!name) throw new EditError(message)
  if (!(PROBLEM_TYPES as readonly string[]).includes(kind)) throw new EditError('a problem is a request-for-change, an off-specification or a problem')
  if (!(LEVELS as readonly string[]).includes(priority)) throw new EditError('a priority is low, medium or high')
  const id = getNextEntryId(text, 'I')
  return { id, ...appendEntry(text, 'issues', [`  - id: ${id}`, `    title: ${toScalar(name)}`, `    type: ${kind}`, `    priority: ${priority}`, '    status: open', `    raised: ${day}`]) }
}

export type NewRisk = { title?: unknown; cause?: unknown; category?: string; probability?: string; impact?: string; owner?: unknown; response?: string; actions?: unknown }

/** A new open risk of the Risk Register, with no verdict: /pm-risk writes it once it has assessed the response. */
export function addRisk(text: string | null, risk: NewRisk): NewEntry {
  const message = `a risk needs a title of one line, up to ${MAX_TITLE} characters`
  const title = oneLine(risk.title, MAX_TITLE, message)
  if (!title) throw new EditError(message)
  const cause = oneLine(risk.cause, MAX_LINE, `the cause is one line, up to ${MAX_LINE} characters`)
  if (!(RISK_CATEGORIES as readonly string[]).includes(risk.category ?? '')) throw new EditError('a risk is a threat or an opportunity')
  if (!(LEVELS as readonly string[]).includes(risk.probability ?? '') || !(LEVELS as readonly string[]).includes(risk.impact ?? '')) {
    throw new EditError('probability and impact are low, medium or high')
  }
  const owner = oneLine(risk.owner, 100, 'an owner is a name')
  const response = risk.response || ''
  if (response && !(RISK_RESPONSES as readonly string[]).includes(response)) {
    throw new EditError('a response is avoid, reduce, fallback, transfer, accept, share, exploit or enhance')
  }
  const actions = oneLine(risk.actions, MAX_LINE, `the response actions are one line, up to ${MAX_LINE} characters`)
  const id = getNextEntryId(text, 'R')
  const block = [`  - id: ${id}`, `    title: ${toScalar(title)}`, ...(cause ? [`    cause: ${quoted(cause, '"')}`] : []),
    `    category: ${risk.category}`, `    probability: ${risk.probability}`, `    impact: ${risk.impact}`,
    ...(owner ? [`    owner: ${toScalar(owner)}`] : []), '    status: open',
    ...(response ? [`    response: ${response}`] : []), ...(actions ? [`    response_actions: ${quoted(actions, '"')}`] : [])]
  return { id, ...appendEntry(text, 'risks', block) }
}
