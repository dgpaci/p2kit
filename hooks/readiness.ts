import { isDoc } from './yaml'
import type { Value } from './yaml'

export const DEFAULT_HEADINGS = ['Why', 'What changes', 'Done when']
const HEADINGS_ERROR = 'readiness.headings: expected a list of headings'
const ATX = /^#{1,6} (.*)$/

/** The headings in force from the `readiness` section of project.yaml; a malformed one is an error and the default applies. */
export function readReadiness(value: Value | undefined, errors: string[]): string[] {
  if (value === undefined) return [...DEFAULT_HEADINGS]
  const headings = isDoc(value) ? value.headings : undefined
  if (Array.isArray(headings) && headings.length > 0 && headings.every(one => ['string', 'number', 'boolean'].includes(typeof one))) {
    return headings.map(String)
  }
  errors.push(HEADINGS_ERROR)
  return [...DEFAULT_HEADINGS]
}

/** The headings, in their order, that no ATX heading line of the body carries (trimmed, closing `#`s and `:` dropped, any case). */
export function getMissingHeadings(body: string | null | undefined, headings: string[]): string[] {
  const present = new Set(
    (body ?? '').split('\n').flatMap(line => {
      const match = ATX.exec(line.trimEnd())
      return match ? [match[1].replace(/#+$/, '').trim().replace(/:$/, '').trim().toLowerCase()] : []
    }),
  )
  return headings.filter(heading => !present.has(heading.toLowerCase()))
}
