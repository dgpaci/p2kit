import { expect, test } from 'claude-code/testing'

import { detectForge, isReadyToClose, toMilestone, toPulls } from '../hooks/forge'

test('the forge comes from the origin URL: github.com is GitHub, any other host Forgejo', async () => {
  const github = { forge: 'github', host: 'github.com', repo: 'dgpaci/p2kit' }
  const forgejo = { forge: 'forgejo', host: 'hub.genro.com', repo: 'anaci/anaci' }

  expect(detectForge('git@github.com:dgpaci/p2kit.git')).toEqual(github)
  expect(detectForge('https://github.com/dgpaci/p2kit')).toEqual(github)
  expect(detectForge('git@hub.genro.com:anaci/anaci.git')).toEqual(forgejo)
  expect(detectForge('ssh://git@hub.genro.com:2222/anaci/anaci.git')).toEqual(forgejo)
  expect(detectForge('https://hub.genro.com/anaci/anaci.git')).toEqual(forgejo)
  expect(detectForge('not a url')).toBeUndefined()
})

// The REST list of pull requests: GitHub and Forgejo answer with the same fields used here.
const PULLS = [
  { number: 512, title: 'Certificate header', state: 'closed', merged_at: '2026-11-01T10:00:00Z', html_url: 'https://h/pulls/512', head: { ref: 'feature/498-x' } },
  { number: 530, title: 'Certificate rows', state: 'open', merged_at: null, html_url: 'https://h/pulls/530', head: { ref: 'feature/498-x' } },
  { number: 531, title: 'Abandoned try', state: 'closed', merged_at: null, html_url: 'https://h/pulls/531', head: { ref: 'feature/498-x' } },
  { number: 600, title: 'Other work', state: 'open', merged_at: null, html_url: 'https://h/pulls/600', head: { ref: 'feature/600-y' } },
]

test('the pull requests of a branch, merged told apart from closed', async () => {
  expect(toPulls(PULLS, 'feature/498-x')).toEqual([
    { number: 512, title: 'Certificate header', state: 'merged', url: 'https://h/pulls/512' },
    { number: 530, title: 'Certificate rows', state: 'open', url: 'https://h/pulls/530' },
    { number: 531, title: 'Abandoned try', state: 'closed', url: 'https://h/pulls/531' },
  ])
  expect(toPulls([], 'feature/498-x')).toEqual([])
})

test('a milestone by title: open and closed counts, due date as an ISO day', async () => {
  const list = [
    { title: 'v2.4', open_issues: 0, closed_issues: 12, due_on: null },
    { title: 'v2.5', open_issues: 3, closed_issues: 7, due_on: '2026-12-15T00:00:00Z' },
  ]

  expect(toMilestone(list, 'v2.5')).toEqual({ title: 'v2.5', open: 3, closed: 7, due: '2026-12-15' })
  expect(toMilestone(list, 'v2.4')).toEqual({ title: 'v2.4', open: 0, closed: 12, due: '' })
  expect(toMilestone(list, 'v9')).toBeUndefined()
})

test('a stage is ready to close when its pull requests are merged and none is open', async () => {
  const pr = (state: 'open' | 'merged' | 'closed') => ({ number: 1, title: 't', state, url: 'u' })

  expect(isReadyToClose([])).toBe(false)
  expect(isReadyToClose([pr('merged')])).toBe(true)
  expect(isReadyToClose([pr('merged'), pr('closed')])).toBe(true)
  expect(isReadyToClose([pr('merged'), pr('open')])).toBe(false)
  expect(isReadyToClose([pr('closed')])).toBe(false)
})
