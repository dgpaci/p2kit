// The YAML subset of docs/pm-schema.md: block maps and lists, flow lists and maps of scalars,
// quoted and plain scalars, comments. The mod has no npm, so it reads YAML itself.

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value }
export type Doc = { [key: string]: Value }

type Line = { indent: number; text: string; number: number }

/** A quote at `i` opens a quoted scalar only where a scalar starts: `D'Alessandro` stays plain. */
const opensQuote = (text: string, i: number): boolean =>
  (text[i] === '"' || text[i] === "'") && (i === 0 || ' [{,'.includes(text[i - 1] ?? ''))

/** Drops a `#` comment that is not inside quotes. */
function stripComment(text: string): string {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (opensQuote(text, i)) {
      quote = char
    } else if (char === '#' && (i === 0 || text[i - 1] === ' ')) {
      return text.slice(0, i).trimEnd()
    }
  }
  return text.trimEnd()
}

/** Splits `a, b, {c: d}` at its top-level commas. */
function splitFlow(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (opensQuote(text, i)) quote = char
    else if (char === '[' || char === '{') depth++
    else if (char === ']' || char === '}') depth--
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = text.slice(start).trim()
  if (last) parts.push(last)
  return parts
}

/** Where `key: value` splits: the first `:` outside quotes followed by a space or the end; -1 if none. */
function findColon(text: string): number {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if ((char === '"' || char === "'") && i === 0) quote = char
    else if (char === ':' && (i === text.length - 1 || text[i + 1] === ' ')) return i
    else if (char === '[' || char === '{') return -1
  }
  return -1
}

const unquote = (text: string): string =>
  (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) ? text.slice(1, -1) : text

/** A scalar or a flow collection, as written after `key:` or `- `. */
export function parseScalar(raw: string): Value {
  const text = raw.trim()
  if (text.startsWith('[') && text.endsWith(']')) return splitFlow(text.slice(1, -1)).map(parseScalar)
  if (text.startsWith('{') && text.endsWith('}')) {
    const map: Doc = {}
    for (const part of splitFlow(text.slice(1, -1))) {
      const colon = findColon(part)
      if (colon < 0) throw new Error(`flow map entry without a key: ${part}`)
      map[unquote(part.slice(0, colon).trim())] = parseScalar(part.slice(colon + 1))
    }
    return map
  }
  if (text.length > 1 && (text[0] === '"' || text[0] === "'")) return unquote(text)
  if (text === '' || text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  // A number that would not print back the same (`1.0`, `007`) stays text: versions, codes.
  if (/^-?\d+(\.\d+)?$/.test(text) && String(Number(text)) === text) return Number(text)
  return text
}

const isItem = (line: Line | undefined): boolean => line !== undefined && (line.text === '-' || line.text.startsWith('- '))

// The line at `i` when it continues a block indented by `indent`.
const lineAt = (lines: Line[], i: number, indent: number): Line | undefined => (lines[i]?.indent === indent ? lines[i] : undefined)

/** Parses the block starting at `lines[at]`, all of it indented by `indent`; returns the value and the next line. */
function parseBlock(lines: Line[], at: number, indent: number): [Value, number] {
  return isItem(lines[at]) ? parseList(lines, at, indent) : parseMap(lines, at, indent)
}

function parseList(lines: Line[], at: number, indent: number): [Value[], number] {
  const list: Value[] = []
  let i = at
  for (let line = lineAt(lines, i, indent); line && isItem(line); line = lineAt(lines, i, indent)) {
    const rest = line.text.slice(1).trimStart()
    if (!rest) {
      const next = lines[i + 1]
      if (next && next.indent > indent) {
        const [value, after] = parseBlock(lines, i + 1, next.indent)
        list.push(value)
        i = after
      } else {
        list.push(null)
        i++
      }
    } else if (findColon(rest) > 0) {
      // `- key: value` opens a map whose entries sit where `key` starts.
      const inner = indent + line.text.length - rest.length
      lines[i] = { ...line, indent: inner, text: rest }
      const [value, after] = parseMap(lines, i, inner)
      list.push(value)
      i = after
    } else {
      list.push(parseScalar(rest))
      i++
    }
  }
  return [list, i]
}

function parseMap(lines: Line[], at: number, indent: number): [Doc, number] {
  const map: Doc = {}
  let i = at
  for (let line = lineAt(lines, i, indent); line && !isItem(line); line = lineAt(lines, i, indent)) {
    const colon = findColon(line.text)
    if (colon <= 0) throw new Error(`line ${line.number}: expected "key: value", got "${line.text}"`)
    const key = unquote(line.text.slice(0, colon).trim())
    const rest = line.text.slice(colon + 1).trim()
    const next = lines[i + 1]
    if (rest) {
      map[key] = parseScalar(rest)
      i++
    } else if (next && (next.indent > indent || (next.indent === indent && isItem(next)))) {
      const [value, after] = parseBlock(lines, i + 1, next.indent)
      map[key] = value
      i = after
    } else {
      map[key] = null
      i++
    }
  }
  const extra = lines[i]
  if (extra && extra.indent > indent) throw new Error(`line ${extra.number}: unexpected indentation`)
  return [map, i]
}

/** Parses a YAML document of the subset; an empty document is `{}`. */
export function parseYaml(text: string): Value {
  const lines: Line[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.includes('\t') && /^\s*\t/.test(raw)) throw new Error(`line ${index + 1}: tabs are not allowed for indentation`)
    const stripped = stripComment(raw)
    if (!stripped.trim() || stripped.trim() === '---') return
    lines.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim(), number: index + 1 })
  })
  const first = lines[0]
  if (!first) return {}
  const [value, after] = parseBlock(lines, 0, first.indent)
  const extra = lines[after]
  if (extra) throw new Error(`line ${extra.number}: unexpected content`)
  return value
}

/** Splits a Markdown product into its frontmatter and body; no frontmatter gives `{}`. */
export function parseFrontmatter(text: string): { data: Doc; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { data: {}, body: text }
  const data = parseYaml(match[1] ?? '')
  return { data: isDoc(data) ? data : {}, body: text.slice(match[0].length) }
}

export const isDoc = (value: Value | undefined): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
