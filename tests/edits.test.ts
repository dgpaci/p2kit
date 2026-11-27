import { expect, test } from 'claude-code/testing'

import { addLogEntry, addProblem, addRisk, EditError, placeWp, setFrontmatterKey, setNoteStatus, setWpStatus } from '../hooks/edits'
import type { NewRisk } from '../hooks/edits'
import cases from '../server/edit-cases.mjs'

type Case = {
  name: string; op: 'key' | 'status' | 'note' | 'place' | 'log' | 'problem' | 'risk'; text: string | null; key?: string; value: string | null; id?: string; sha?: string; noteText?: string
  files?: Record<string, string>; target?: string; horizon?: string; beside?: string | null; side?: string | null
  day?: string; kind?: string; entryText?: string; owner?: string; due?: string; title?: string; type?: string; priority?: string; risk?: NewRisk
  expect?: object; error?: string
}

test('the pane edits .pm/ files line by line as the desk helper does, on the cases both suites share', () => {
  for (const one of cases as Case[]) {
    const run = () => one.op === 'key' ? setFrontmatterKey(one.text!, one.key!, one.value)
      : one.op === 'status' ? setWpStatus(one.text!, one.id!, one.value as 'completed' | 'archived')
      : one.op === 'place' ? placeWp(one.files!, one.target!, one.horizon!, one.beside, one.side)
      : one.op === 'log' ? addLogEntry(one.text, one.day!, one.kind!, one.entryText, one.owner, one.due)
      : one.op === 'problem' ? addProblem(one.text, one.day!, one.title, one.type!, one.priority!)
      : one.op === 'risk' ? addRisk(one.text, one.risk!)
      : setNoteStatus(one.text!, one.sha!, one.noteText!, one.value as 'open' | 'closed')
    if (one.error) {
      let error: unknown
      try { run() } catch (thrown) { error = thrown }
      expect(error instanceof EditError ? `${one.name}: ${error.message}` : `${one.name}: no error`).toContain(one.error)
    } else {
      expect({ name: one.name, ...run() }).toEqual({ name: one.name, ...one.expect })
    }
  }
})
