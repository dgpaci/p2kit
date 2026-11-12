import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { LOG_FORMAT, parseCommits } from '../hooks/notes'

const US = '\x1f'
const SHA_A = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'
const SHA_B = 'bbbb2222cccc2222bbbb2222bbbb2222bbbb2222'
const LOG = `${SHA_A}${US}aaaa111${US}2026-11-10${US}feat: header\n${SHA_B}${US}bbbb222${US}2026-11-11${US}fix: rows | with a pipe\n`

const NOTES = `notes:
  - { sha: aaaa111, wp: WP-03, kind: follow-up, status: open, text: rename the column later, date: 2026-11-10 }
  - { sha: bbbb2222cccc, wp: WP-03, kind: blocker, status: open, text: waiting for the print template, date: 2026-11-11 }
  - { sha: dddd333, wp: WP-03, kind: blocker, status: closed, text: solved, date: 2026-11-09 }
  - { sha: eeee444, wp: WP-01, kind: blocker, status: open, text: from another work package, date: 2026-10-01 }
`

const PROJECT = 'name: Anaci\nstage: { current: 3 }\n'
const WORK_PACKAGES = [{
  path: '/p/.pm/work-packages/WP-03.md',
  text: '---\nid: WP-03\ntitle: Certificate\nstage: 3\nstatus: in-progress\nissue: 498\nbranch: feature/498-x\n---\n',
}]

test('git log lines split on the unit separator into commits', async () => {
  expect(LOG_FORMAT).toBe('%H%x1f%h%x1f%ad%x1f%s')
  expect(parseCommits(LOG)).toEqual([
    { sha: SHA_A, short: 'aaaa111', date: '2026-11-10', subject: 'feat: header' },
    { sha: SHA_B, short: 'bbbb222', date: '2026-11-11', subject: 'fix: rows | with a pipe' },
  ])
  expect(parseCommits('')).toEqual([])
})

test('notes attach to the commits of their work package by sha prefix; the rest stay listed apart', async () => {
  const project = buildProject(
    { path: '/p', project: PROJECT, products: [], workPackages: WORK_PACKAGES, wpLogs: [{ wp: 'WP-03', text: LOG }], commitNotes: NOTES },
    '2026-11-12',
  )
  const delivery = project.workPackages[0].delivery!

  expect(delivery.commits.map(commit => [commit.short, commit.notes.map(note => note.kind)])).toEqual([
    ['aaaa111', ['follow-up']],
    ['bbbb222', ['blocker']],
  ])
  expect(delivery.unlinkedNotes.map(note => note.sha)).toEqual(['dddd333'])
  expect(delivery.commits[1].notes[0]).toEqual({
    sha: 'bbbb2222cccc', wp: 'WP-03', kind: 'blocker', status: 'open', text: 'waiting for the print template', date: '2026-11-11',
  })
})

test('open blockers are counted over the whole register', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WORK_PACKAGES, commitNotes: NOTES }, '2026-11-12')

  expect(project.openBlockers).toBe(2)
  expect(buildProject({ path: '/p', project: PROJECT, products: [], workPackages: WORK_PACKAGES }, '2026-11-12').openBlockers).toBe(0)
})

test('a broken register is an error, not a crash', async () => {
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], commitNotes: 'notes: 1\n    sha: 2\n' }, '2026-11-12')

  expect(project.errors.some(error => error.startsWith('commit-notes.yaml:'))).toBe(true)
})
