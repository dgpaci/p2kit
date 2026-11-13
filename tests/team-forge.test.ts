import { expect, mock, test } from 'claude-code/testing'

import type { Project } from '../types'

const KEYS = '/h/Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const ROLES = 'roles:\n  executive: Anna Rossi\n  project_manager: Davide Paci\n  senior_supplier: [Luca Verdi]\n'
const PEOPLE = 'team:\n  wip_limit: 1\n  people:\n    Davide Paci: { login: dgpaci }\n    Luca Verdi: { login: lverdi }\n'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/fj\n  - path: /t/nologin\n  - path: /t/broken\n',
  '/t/gh/.pm/project.yaml': `name: Gh\n${ROLES}${PEOPLE}`,
  '/t/fj/.pm/project.yaml': `name: Fj\n${ROLES}${PEOPLE}`,
  '/t/nologin/.pm/project.yaml': `name: NoLogin\n${ROLES}`,
  '/t/broken/.pm/project.yaml': `name: Broken\n${ROLES}${PEOPLE}`,
  [KEYS]: JSON.stringify({ hosts: { 'hub.genro.com': { token: 'tok' } } }),
}
const ORIGINS: Record<string, string> = {
  '/t/gh': 'git@github.com:acme/gh.git\n',
  '/t/fj': 'git@hub.genro.com:acme/fj.git\n',
  '/t/nologin': 'git@github.com:acme/nologin.git\n',
  '/t/broken': 'git@other.host:acme/broken.git\n',
}
const user = (login: string) => ({ login })
const ISSUES = [{ number: 1, title: 'Issue 1', html_url: 'https://h/issues/1', updated_at: '2026-11-11T09:00:00Z', assignees: [user('dgpaci')] }]
const PULLS = [
  { number: 2, title: 'Pull 2', html_url: 'https://h/pulls/2', updated_at: '2026-11-11T10:00:00Z', draft: false, user: user('dgpaci'), assignees: [], requested_reviewers: [user('lverdi')] },
]
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const FORGEJO_PAGE_1 = Array.from({ length: 50 }, (_, n) => ({ ...PULLS[0], number: 100 + n, user: user('someone'), requested_reviewers: [] }))

test('the team items are read once per project from the open issues and pull requests of its repo, GET only', async ($, on) => {
  // wf:contract: loadProjects reads the team of a registered project whose project.yaml gives at least one person of the roles a login
  // wf:contract: under team.people: on GitHub `gh api` GETs of repos/<repo>/issues?state=open and repos/<repo>/pulls?state=open, on Forgejo
  // wf:contract: http.fetch GETs of repos/<repo>/issues?state=open&type=issues and repos/<repo>/pulls?state=open, each paged up to 5 pages;
  // wf:contract: never -X, -f or --method, never a write. The same lists serve every person of the project: the requests do not grow with the team.
  // wf:contract: Each person with a login gets the items toTeamItems gives for their login, then withItems sets wip and isOverLimit.
  // wf:contract: A project where nobody has a login gets no team items; its repo is still read, for milestones and readiness (Macro 4).
  // wf:contract: The team lists are read again only after 5 minutes, unless the refresh is forced, as the work-package forge state.
  // wf:contract: A forge failure becomes the project error `team: <forge> <issues|pulls>: <reason>`; the team still shows, with no item.
  const fetched: { url: string; method: string }[] = []
  const gh: string[][] = []
  const origins: string[] = []
  // The projects the desk saves, read back as they are written.
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
    if (e.url === `${api}pulls?state=open&limit=50&page=1`) return reply(FORGEJO_PAGE_1)
    if (e.url === `${api}pulls?state=open&limit=50&page=2`) return reply(PULLS)
    if (e.url === `${api}milestones?state=open&limit=50`) return reply([])
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '', stderr = '') =>
      ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      gh.push([...e.argv])
      if (e.argv[2] === 'repos/acme/gh/issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (e.argv[2] === 'repos/acme/gh/pulls?state=open&per_page=100&page=1') return answer(0, JSON.stringify(PULLS))
      if (e.argv[2] === 'repos/acme/gh/milestones?state=open&per_page=100') return answer(0, '[]')
      return answer(1, '', 'HTTP 404: Not Found\n')
    }
    const path = e.argv[2] ?? ''
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') {
      origins.push(path)
      return answer(0, ORIGINS[path] ?? '')
    }
    return answer(1)
  })
  const byName = (): Record<string, Project> => Object.fromEntries(stored.map(project => [project.name, project]))
  const named = (name: string): Project => byName()[name]!
  const reads = () => gh.length + fetched.length

  // The session start reads every project, then the 60 s timer reads them again.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const name of ['Gh', 'Fj']) {
    expect(named(name).errors).toEqual([])
    expect(named(name).team.map(member => [member.person, member.items.map(item => [item.number, item.status]), member.wip, member.isOverLimit])).toEqual([
      ['Anna Rossi', [], 0, false],
      ['Davide Paci', [[1, 'todo'], [2, 'waiting']], 2, true],
      ['Luca Verdi', [[2, 'review']], 0, false],
    ])
  }
  expect(gh.filter(argv => argv[2]!.startsWith('repos/acme/gh/')).sort()).toEqual([
    ['gh', 'api', 'repos/acme/gh/issues?state=open&per_page=100&page=1'],
    ['gh', 'api', 'repos/acme/gh/milestones?state=open&per_page=100'],
    ['gh', 'api', 'repos/acme/gh/pulls?state=open&per_page=100&page=1'],
  ])
  expect(gh.every(argv => argv.length === 3 && argv[1] === 'api')).toBe(true)
  const fjFetches = fetched.filter(one => one.url.includes('/acme/fj/')).map(one => one.url.split('/acme/fj/')[1])
  expect(fjFetches.sort()).toEqual(['issues?state=open&type=issues&limit=50&page=1', 'milestones?state=open&limit=50', 'pulls?state=open&limit=50&page=1', 'pulls?state=open&limit=50&page=2'])
  expect(fetched.every(one => one.method === 'GET')).toBe(true)

  expect(named('NoLogin').team.map(member => member.person)).toEqual(['Anna Rossi', 'Davide Paci', 'Luca Verdi'])
  // Nobody has a login, yet its repo is read (Macro 4): same three GETs as Gh.
  expect(origins).toContain('/t/nologin')
  expect(gh.filter(argv => argv[2]!.startsWith('repos/acme/nologin/')).length).toBe(3)

  expect(named('Broken').errors).toEqual([
    'team: forgejo issues: no fj token for other.host',
    'team: forgejo pulls: no fj token for other.host',
    'milestones: forgejo milestones: no fj token for other.host',
  ])
  expect(named('Broken').team.map(member => member.items.length)).toEqual([0, 0, 0])

  const before = reads()
  await clock.advance(60 * 1000)
  expect(reads()).toBe(before)
  expect(named('Gh').team[1]!.items.length).toBe(2)
  expect(named('Broken').errors.length).toBe(3)

  // /pm-desk forces the read; past 5 minutes the timer reads again.
  await $.command.run(RUN)
  // Each read: Gh 3, NoLogin 3, Fj 4 (two pull pages); Broken has no token and sends nothing.
  expect(reads()).toBe(before + 10)
  await clock.advance(5 * 60 * 1000)
  expect(reads()).toBe(before + 20)
})
