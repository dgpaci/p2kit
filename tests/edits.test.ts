import { expect, test } from 'claude-code/testing'

import { EditError, setFrontmatterKey, setNoteStatus, setWpStatus } from '../hooks/edits'
import cases from '../server/edit-cases.mjs'

type Case = {
  name: string; op: 'key' | 'status' | 'note'; text: string; key?: string; value: string | null; id?: string; sha?: string; noteText?: string
  expect?: { text: string; line: number; before: string; after: string }; error?: string
}

test('the pane edits .pm/ files line by line as the desk helper does, on the cases both suites share', () => {
  for (const one of cases as Case[]) {
    const run = () => one.op === 'key' ? setFrontmatterKey(one.text, one.key!, one.value)
      : one.op === 'status' ? setWpStatus(one.text, one.id!, one.value as 'completed' | 'archived')
      : setNoteStatus(one.text, one.sha!, one.noteText!, one.value as 'open' | 'closed')
    if (one.error) {
      let error: unknown
      try { run() } catch (thrown) { error = thrown }
      expect(error instanceof EditError ? `${one.name}: ${error.message}` : `${one.name}: no error`).toContain(one.error)
    } else {
      expect({ name: one.name, ...run() }).toEqual({ name: one.name, ...one.expect })
    }
  }
})
