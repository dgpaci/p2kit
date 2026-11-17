// One-line edits of .pm/ files, as the pane applies them: the same rules and messages as the desk helper
// (server/desk_server.py `set_key`, `set_note_status`), checked by both suites on server/edit-cases.mjs.

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
