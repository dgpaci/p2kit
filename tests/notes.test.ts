import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { LOG_FORMAT, parseCommits } from '../hooks/notes'

const US = '\x1f'
const SHA_A = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'
const SHA_B = 'bbbb2222cccc2222bbbb2222bbbb2222bbbb2222'
const LOG = `${SHA_A}${US}aaaa111${US}2026-11-10${US}feat: header\n${SHA_B}${US}bbbb222${US}2026-11-11${US}fix: rows | with a pipe\n`

const NOTES = `notes:
  - { sha: aaaa111, stage: 3, kind: follow-up, status: open, text: rename the column later, date: 2026-11-10 }
  - { sha: bbbb2222cccc, stage: 3, kind: blocker, status: open, text: waiting for the print template, date: 2026-11-11 }
  - { sha: dddd333, stage: 3, kind: blocker, status: closed, text: solved, date: 2026-11-09 }
  - { sha: eeee444, stage: 2, kind: blocker, status: open, text: from another stage, date: 2026-10-01 }
`

const PROJECT = `
name: Anaci
stage: { current: 3 }
stages:
  - number: 3
    issue: 498
    branch: feature/498-x
`

test('git log lines split on the unit separator into commits', async () => {
  expect(LOG_FORMAT).toBe('%H%x1f%h%x1f%ad%x1f%s')
  expect(parseCommits(LOG)).toEqual([
    { sha: SHA_A, short: 'aaaa111', date: '2026-11-10', subject: 'feat: header' },
    { sha: SHA_B, short: 'bbbb222', date: '2026-11-11', subject: 'fix: rows | with a pipe' },
  ])
  expect(parseCommits('')).toEqual([])
})

test('notes attach to the commits of their stage by sha prefix; the rest stay listed apart', async () => {
  const project = buildProject(
    { path: '/p', project: PROJECT, products: [], workPackages: [], stageLogs: [{ stage: 3, text: LOG }], commitNotes: NOTES },
    '2026-11-12',
  )
  const [stage] = project.stages

  expect(stage.commits.map(commit => [commit.short, commit.notes.map(note => note.kind)])).toEqual([
    ['aaaa111', ['follow-up']],
    ['bbbb222', ['blocker']],
  ])
  expect(stage.unlinkedNotes.map(note => note.sha)).toEqual(['dddd333'])
  expect(stage.commits[1].notes[0]).toEqual({
    sha: 'bbbb2222cccc', stage: 3, kind: 'blocker', status: 'open', text: 'waiting for the print template', date: '2026-11-11',
  })
})

test('open blockers are counted over the whole register', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], commitNotes: NOTES }, '2026-11-12')

  expect(project.openBlockers).toBe(2)
  expect(buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-11-12').openBlockers).toBe(0)
})

test('a broken register is an error, not a crash', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], commitNotes: 'notes: 1\n    sha: 2\n' }, '2026-11-12')

  expect(project.errors.some(error => error.startsWith('commit-notes.yaml:'))).toBe(true)
})
