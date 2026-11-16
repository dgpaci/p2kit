import { expect, mock, test } from 'claude-code/testing'

import { toFlow } from '../hooks/flow'
import type { Project } from '../types'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const SINCE = '2026-08-15T12:00:00.000Z'
const KEYS = '/h/Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/fj\n  - path: /t/local\n  - path: /t/broken\n',
  '/t/gh/.pm/project.yaml': 'name: Gh\n',
  '/t/fj/.pm/project.yaml': 'name: Fj\n',
  '/t/local/.pm/project.yaml': 'name: Local\n',
  '/t/broken/.pm/project.yaml': 'name: Broken\n',
  [KEYS]: JSON.stringify({ hosts: { 'hub.genro.com': { token: 'tok' } } }),
}
const ORIGINS: Record<string, string> = {
  '/t/gh': 'git@github.com:acme/gh.git\n',
  '/t/fj': 'git@hub.genro.com:acme/fj.git\n',
  '/t/broken': 'git@github.com:acme/broken.git\n',
}
const user = (login: string) => ({ login })
const GH_ISSUES = [{ number: 1, title: 'Ten days', html_url: 'https://h/issues/1', updated_at: '2026-11-11T12:00:00Z', created_at: '2026-11-01T12:00:00Z', closed_at: '2026-11-11T12:00:00Z' }]
const GH_PULLS = [
  { number: 10, title: 'One day', html_url: 'https://h/pull/10', updated_at: '2026-11-10T12:00:00Z', user: user('a'), created_at: '2026-11-09T12:00:00Z', closed_at: '2026-11-10T12:00:00Z', merged_at: '2026-11-10T12:00:00Z' },
  { number: 12, title: 'Closed, not merged', html_url: 'https://h/pull/12', updated_at: '2026-11-03T12:00:00Z', user: user('a'), created_at: '2026-11-02T12:00:00Z', closed_at: '2026-11-03T12:00:00Z', merged_at: null },
]
const GH_REVIEWS = [{ user: user('a'), state: 'COMMENTED', submitted_at: '2026-11-09T13:00:00Z' }, { user: user('b'), state: 'APPROVED', submitted_at: '2026-11-10T00:00:00Z' }]
// A full Forgejo page whose last pull was updated before the 90 days: the pull pages stop there.
const FJ_PULLS = [
  { number: 20, title: 'Merged', html_url: 'https://h/pulls/20', updated_at: '2026-11-05T12:00:00Z', user: user('a'), created_at: '2026-11-01T12:00:00Z', closed_at: '2026-11-05T12:00:00Z', merged_at: '2026-11-05T12:00:00Z' },
  ...Array.from({ length: 49 }, (_, n) => ({ number: 100 + n, title: 'Old', html_url: 'https://h/pulls/old', updated_at: '2026-01-01T12:00:00Z', user: user('a'), created_at: '2025-12-01T12:00:00Z', closed_at: '2026-01-01T12:00:00Z', merged_at: '2026-01-01T12:00:00Z' })),
]
const BROKEN_PULLS = [{ ...GH_PULLS[0], number: 30 }]
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const isFlowRead = (path: string): boolean => path.includes('state=closed') || path.includes('/reviews')

test('the closed issues and pull requests of the last 90 days are read per project, GET only, and cached for an hour', async ($, on) => {
  // wf:contract: loadProjects reads, for every registered project whose origin is a forge, its closed items of the last 90 days:
  // wf:contract: GitHub `gh api` GETs repos/<repo>/issues?state=closed&since=<ISO now-90d>&per_page=100&page=<n> and
  // wf:contract: repos/<repo>/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=<n>; Forgejo http.fetch GETs
  // wf:contract: repos/<repo>/issues?state=closed&type=issues&since=<ISO now-90d>&limit=50&page=<n> and
  // wf:contract: repos/<repo>/pulls?state=closed&sort=recentupdate&limit=50&page=<n>; at most 10 pages each, the pull pages stopping
  // wf:contract: once a page's last item was updated before now - 90 days. Never -X, -f or --method, never a write.
  // wf:contract: The reviews of each pull merged in the 90 days are read with repos/<repo>/pulls/<n>/reviews (GitHub with ?per_page=100),
  // wf:contract: at most 100 pulls per read, and each pull's first review is kept for the module's life: a later read never asks again.
  // wf:contract: Project.flow = toFlow(...) of what was read; a project whose origin is not a forge has flow null and sends no request.
  // wf:contract: The closed lists are read again only after 60 minutes, unless the refresh is forced (/pm-desk).
  // wf:contract: A failure becomes the project error `flow: <forge> <issues|pulls|reviews>: <reason>`; flow is still built from what was read.
  const fetched: { url: string; method: string }[] = []
  const gh: string[][] = []
  let stored: Project[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'projects') stored = (e.value as { value: Project[] }).value
    return next(e)
  })
  mock.store(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pm-desk' } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', (_, e) => {
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (!isFlowRead(e.url)) return reply([])
    fetched.push({ url: e.url, method: e.init?.method ?? 'GET' })
    const rest = e.url.split('/api/v1/repos/acme/fj/')[1]
    if (rest === `issues?state=closed&type=issues&since=${SINCE}&limit=50&page=1`) return reply(GH_ISSUES)
    if (rest === 'pulls?state=closed&sort=recentupdate&limit=50&page=1') return reply(FJ_PULLS)
    if (rest === 'pulls/20/reviews') return reply(GH_REVIEWS)
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '', stderr = '') =>
      ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      const path = e.argv[2] ?? ''
      if (!isFlowRead(path)) return answer(0, '[]')
      gh.push([...e.argv])
      const replies: Record<string, unknown> = {
        [`repos/acme/gh/issues?state=closed&since=${SINCE}&per_page=100&page=1`]: GH_ISSUES,
        'repos/acme/gh/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1': GH_PULLS,
        'repos/acme/gh/pulls/10/reviews?per_page=100': GH_REVIEWS,
        'repos/acme/broken/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1': BROKEN_PULLS,
      }
      return path in replies ? answer(0, JSON.stringify(replies[path])) : answer(1, '', 'HTTP 404: Not Found\n')
    }
    const path = e.argv[2] ?? ''
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return ORIGINS[path] ? answer(0, ORIGINS[path]) : answer(2, '', 'no origin')
    return answer(1)
  })
  const named = (name: string): Project => stored.find(project => project.name === name)!
  const reads = () => gh.length + fetched.length
  const reviewReads = () => [...gh.map(argv => argv[2]!), ...fetched.map(one => one.url)].filter(path => path.includes('/reviews')).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect(named('Gh').errors).toEqual([])
  expect(named('Gh').flow).toEqual(toFlow(GH_ISSUES, GH_PULLS, { 10: '2026-11-10T00:00:00Z' }, NOW))
  expect(named('Gh').flow!.windows[0]!.firstReview).toEqual({ count: 1, median: 0.5, p90: 0.5 })
  expect(named('Gh').flow!.mergedPulls.map(pull => pull.number)).toEqual([10])
  expect(gh.filter(argv => argv[2]!.startsWith('repos/acme/gh/')).map(argv => argv[2]).sort()).toEqual([
    `repos/acme/gh/issues?state=closed&since=${SINCE}&per_page=100&page=1`,
    'repos/acme/gh/pulls/10/reviews?per_page=100',
    'repos/acme/gh/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1',
  ])
  expect(gh.every(argv => argv.length === 3 && argv[1] === 'api')).toBe(true)

  expect(named('Fj').errors).toEqual([])
  expect(named('Fj').flow!.windows[0]!.merge).toEqual({ count: 1, median: 4, p90: 4 })
  expect(named('Fj').flow!.closedIssues.map(issue => issue.number)).toEqual([1])
  expect(fetched.map(one => one.url.split('/acme/fj/')[1]).sort()).toEqual([
    `issues?state=closed&type=issues&since=${SINCE}&limit=50&page=1`,
    'pulls/20/reviews',
    'pulls?state=closed&sort=recentupdate&limit=50&page=1',
  ])
  expect(fetched.every(one => one.method === 'GET')).toBe(true)

  expect(named('Local').flow).toBe(null)
  expect(named('Local').errors).toEqual([])

  expect(named('Broken').errors).toEqual(['flow: github issues: HTTP 404: Not Found', 'flow: github reviews: HTTP 404: Not Found'])
  expect(named('Broken').flow!.closedIssues).toEqual([])
  expect(named('Broken').flow!.mergedPulls.map(pull => pull.number)).toEqual([30])
  expect(named('Broken').flow!.windows[0]!.merge.count).toBe(1)

  // Within the hour nothing is read again; /pm-desk forces the lists, never the first reviews already known.
  const before = reads()
  await clock.advance(60 * 1000)
  expect(reads()).toBe(before)
  await $.command.run(RUN)
  // Gh 2, Fj 2, Broken 2 plus its review, which failed and is asked again.
  expect(reads()).toBe(before + 7)
  expect(reviewReads()).toBe(4)
  await clock.advance(59 * 60 * 1000)
  expect(reads()).toBe(before + 7)
  await clock.advance(2 * 60 * 1000)
  expect(reads()).toBe(before + 14)
  expect(reviewReads()).toBe(5)
  expect(named('Gh').flow!.windows[0]!.firstReview.count).toBe(1)
})
