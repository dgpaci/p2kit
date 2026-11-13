import { expect, mock, test } from 'claude-code/testing'

import type { Project } from '../types'

const KEYS = '/h/Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
// No team.people anywhere: the repo is read anyway, for milestones and readiness.
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/fj\n  - path: /t/local\n  - path: /t/broken\n',
  '/t/gh/.pm/project.yaml': 'name: Gh\nroles:\n  project_manager: Davide Paci\n',
  '/t/fj/.pm/project.yaml': 'name: Fj\nroles:\n  project_manager: Davide Paci\n',
  '/t/local/.pm/project.yaml': 'name: Local\nroles:\n  project_manager: Davide Paci\n',
  '/t/broken/.pm/project.yaml': 'name: Broken\nroles:\n  project_manager: Davide Paci\n',
  [KEYS]: JSON.stringify({ hosts: { 'hub.genro.com': { token: 'tok' } } }),
}
const ORIGINS: Record<string, string> = {
  '/t/gh': 'git@github.com:acme/gh.git\n',
  '/t/fj': 'git@hub.genro.com:acme/fj.git\n',
  '/t/broken': 'git@github.com:acme/broken.git\n',
}
const MILESTONES = [{ title: 'v1', open_issues: 1, closed_issues: 3, due_on: '2026-12-01T00:00:00Z' }]
const ISSUES = [
  { number: 1, title: 'In v1', html_url: 'https://h/issues/1', updated_at: '2026-11-12T09:00:00Z', assignees: [], milestone: { title: 'v1' }, body: '' },
  { number: 2, title: 'Loose', html_url: 'https://h/issues/2', updated_at: '2026-11-11T09:00:00Z', assignees: [], milestone: null, body: '' },
]
const PULLS = [
  { number: 3, title: 'Pull 3', html_url: 'https://h/pulls/3', updated_at: '2026-11-12T10:00:00Z', draft: false, user: { login: 'a' }, assignees: [], requested_reviewers: [{ login: 'b' }], milestone: { title: 'v1' } },
]
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the repo of every forge project is read once, GET only, into its milestones and open issues', async ($, on) => {
  // wf:contract: loadProjects reads, for every registered project whose origin is a forge, whether or not anyone has a team login,
  // wf:contract: the open issues and open pull requests (as the team read does) and the open milestones: on GitHub `gh api
  // wf:contract: repos/<repo>/milestones?state=open&per_page=100`, on Forgejo an http.fetch GET of repos/<repo>/milestones?state=open&limit=50.
  // wf:contract: GET only. Project.milestones is toMilestoneProgress over those lists; Project.forgeIssues is toForgeIssues of the issues.
  // wf:contract: A project whose origin is not a forge (or has no origin) reads nothing and keeps milestones [] and forgeIssues [].
  // wf:contract: A milestones failure is the project error `milestones: <forge> milestones: <reason>`; the issues still show.
  // wf:contract: The repo is read again only after 5 minutes, unless the refresh is forced.
  const fetched: { url: string; method: string }[] = []
  const gh: string[][] = []
  let stored: Project[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'projects') stored = (e.value as { value: Project[] }).value
    return next(e)
  })
  mock.store(on)
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pm-desk' } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', (_, e) => {
    fetched.push({ url: e.url, method: e.init?.method ?? 'GET' })
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    const api = 'https://hub.genro.com/api/v1/repos/acme/fj/'
    if (e.url === `${api}issues?state=open&type=issues&limit=50&page=1`) return reply(ISSUES)
    if (e.url === `${api}pulls?state=open&limit=50&page=1`) return reply(PULLS)
    if (e.url === `${api}milestones?state=open&limit=50`) return reply(MILESTONES)
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '', stderr = '') =>
      ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      gh.push([...e.argv])
      const path = e.argv[2] ?? ''
      const repo = path.split('/').slice(1, 3).join('/')
      const rest = path.split('/').slice(3).join('/')
      if (repo !== 'acme/gh' && !(repo === 'acme/broken' && !rest.startsWith('milestones'))) return answer(1, '', 'HTTP 404: Not Found\n')
      if (rest === 'issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (rest === 'pulls?state=open&per_page=100&page=1') return answer(0, JSON.stringify(PULLS))
      if (rest === 'milestones?state=open&per_page=100') return answer(0, JSON.stringify(MILESTONES))
      return answer(1, '', 'HTTP 404: Not Found\n')
    }
    const path = e.argv[2] ?? ''
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return ORIGINS[path] ? answer(0, ORIGINS[path]) : answer(2, '', 'no origin')
    return answer(1)
  })
  const named = (name: string): Project => stored.find(project => project.name === name)!
  const reads = () => gh.length + fetched.length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const name of ['Gh', 'Fj']) {
    expect(named(name).errors).toEqual([])
    expect(named(name).milestones.map(one => [one.title, one.open, one.closed, one.due, one.inReview])).toEqual([['v1', 1, 3, '2026-12-01', 1]])
    expect(named(name).forgeIssues.map(one => [one.number, one.milestone])).toEqual([[1, 'v1'], [2, '']])
  }
  expect(gh.filter(argv => argv[2]!.startsWith('repos/acme/gh/')).map(argv => argv[2]).sort()).toEqual([
    'repos/acme/gh/issues?state=open&per_page=100&page=1',
    'repos/acme/gh/milestones?state=open&per_page=100',
    'repos/acme/gh/pulls?state=open&per_page=100&page=1',
  ])
  expect(gh.every(argv => argv.length === 3 && argv[1] === 'api')).toBe(true)
  expect(fetched.map(one => one.url.split('/acme/fj/')[1]).sort()).toEqual([
    'issues?state=open&type=issues&limit=50&page=1',
    'milestones?state=open&limit=50',
    'pulls?state=open&limit=50&page=1',
  ])
  expect(fetched.every(one => one.method === 'GET')).toBe(true)

  expect(named('Local').milestones).toEqual([])
  expect(named('Local').forgeIssues).toEqual([])
  expect(named('Local').errors).toEqual([])

  expect(named('Broken').errors).toEqual(['milestones: github milestones: HTTP 404: Not Found'])
  expect(named('Broken').milestones).toEqual([])
  expect(named('Broken').forgeIssues.map(one => one.number)).toEqual([1, 2])

  const before = reads()
  await clock.advance(60 * 1000)
  expect(reads()).toBe(before)
  await $.command.run(RUN)
  expect(reads()).toBe(before + 9)
})
