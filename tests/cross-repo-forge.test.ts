import { expect, mock, test } from 'claude-code/testing'

import type { Project } from '../types'

// A cross-repo project (issue #89): its .pm/ lives in one repo, its work in two others, one on GitHub and one on Forgejo.
const KEYS = '/h/Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/meta\n',
  '/t/meta/.pm/project.yaml': 'name: Meta\nroles:\n  project_manager: Davide Paci\n  senior_supplier: [Luca Verdi]\n'
    + 'team:\n  people:\n    Davide Paci: { login: dgpaci }\n    Luca Verdi: { login: lverdi }\n'
    + 'repos:\n  - { remote: github.com/acme/core, label: pm }\n  - { remote: hub.genro.com/acme/app, label: pm }\n',
  [KEYS]: JSON.stringify({ hosts: { 'hub.genro.com': { token: 'tok' } } }),
}
const user = (login: string) => ({ login })
const pm = [{ name: 'pm' }]
const M1 = { title: 'M1' }
const CORE_ISSUES = [
  { number: 1, title: 'Core issue', html_url: 'https://github.com/acme/core/issues/1', updated_at: '2026-11-20T09:00:00Z', assignees: [user('dgpaci')], milestone: M1, labels: pm },
  // GitHub lists a labelled pull request among the issues too.
  { number: 3, title: 'Core pull', html_url: 'https://github.com/acme/core/pull/3', updated_at: '2026-11-19T09:00:00Z', pull_request: {}, labels: pm },
]
const CORE_PULLS = [
  { number: 3, title: 'Core pull', html_url: 'https://github.com/acme/core/pull/3', updated_at: '2026-11-19T09:00:00Z', draft: false, user: user('dgpaci'), requested_reviewers: [user('lverdi')], milestone: M1, labels: pm },
  // Not labelled, but it closes a labelled issue: the project's too.
  { number: 4, title: 'Draft for #1', html_url: 'https://github.com/acme/core/pull/4', updated_at: '2026-11-18T09:00:00Z', draft: true, user: user('dgpaci'), body: 'Closes #1', labels: [] },
  // Neither: another project's work in the same repo.
  { number: 5, title: 'Unrelated', html_url: 'https://github.com/acme/core/pull/5', updated_at: '2026-11-21T09:00:00Z', draft: false, user: user('someone'), body: 'Fixes #9', labels: [] },
]
const CORE_MILESTONES = [
  { title: 'M1', number: 1, open_issues: 2, closed_issues: 1, due_on: '2026-12-10T00:00:00Z' },
  { title: 'Other', number: 2, open_issues: 5, closed_issues: 0, due_on: null },
]
const APP_ISSUES = [
  { number: 1, title: 'App issue', html_url: 'https://hub.genro.com/acme/app/issues/1', updated_at: '2026-11-22T09:00:00Z', assignees: [user('dgpaci')], pull_request: null, milestone: M1, labels: pm },
]
const APP_PULLS = [
  { number: 7, title: 'App pull', html_url: 'https://hub.genro.com/acme/app/pulls/7', updated_at: '2026-11-17T09:00:00Z', draft: false, user: user('lverdi'), body: 'closes #1', labels: [] },
]
const APP_MILESTONES = [{ title: 'M1', id: 11, open_issues: 1, closed_issues: 3, due_on: '2026-12-01T00:00:00Z' }]

test('a project listing repos: reads only their items carrying its label, each named by its repo, never its origin', async ($, on) => {
  // wf:contract: With project.yaml `repos:`, loadProjects reads, GET only, each listed repo on its own forge and never asks git for the
  // wf:contract: origin. The open issues are asked with `&labels=<label>` (both forges filter by name); the open pull requests are read
  // wf:contract: whole and kept when they carry the label or close a labelled issue of the same repo. Every item carries `repo`, the repo's
  // wf:contract: name; `#n` in a pull's body names an issue of its own repo. The open milestones are kept when they hold a kept item
  // wf:contract: or a work package names them, merged by title across the repos (counts summed, earliest due). The closed issues of
  // wf:contract: the flow are asked with the label as well.
  const fetched: string[] = []
  const gh: string[] = []
  const origins: string[] = []
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
  const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
  on('http.fetch', (_, e) => {
    fetched.push(e.url)
    const api = 'https://hub.genro.com/api/v1/repos/acme/app/'
    if (e.url === `${api}issues?state=open&type=issues&limit=50&labels=pm&page=1`) return reply(APP_ISSUES)
    if (e.url === `${api}pulls?state=open&limit=50&page=1`) return reply(APP_PULLS)
    if (e.url === `${api}milestones?state=open&limit=50`) return reply(APP_MILESTONES)
    if (e.url.includes('state=closed')) return reply([])
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '', stderr = '') =>
      ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      const path = e.argv[2] ?? ''
      gh.push(path)
      if (path === 'repos/acme/core/issues?state=open&per_page=100&labels=pm&page=1') return answer(0, JSON.stringify(CORE_ISSUES))
      if (path === 'repos/acme/core/pulls?state=open&per_page=100&page=1') return answer(0, JSON.stringify(CORE_PULLS))
      if (path === 'repos/acme/core/milestones?state=open&per_page=100') return answer(0, JSON.stringify(CORE_MILESTONES))
      if (path.includes('state=closed')) return answer(0, '[]')
      return answer(1, '', 'HTTP 404: Not Found\n')
    }
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') origins.push(e.argv[2] ?? '')
    return answer(1)
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const meta = stored.find(project => project.name === 'Meta')!

  expect(meta.errors).toEqual([])
  expect(origins).toEqual([])
  expect(meta.forgeIssues.map(issue => [issue.repo, issue.number, issue.state])).toEqual([['app', 1, 'review'], ['core', 1, 'inprogress']])
  expect(meta.forgePulls.map(pull => [pull.repo, pull.number])).toEqual([['core', 3], ['core', 4], ['app', 7]])
  expect(meta.milestones.map(m => [m.title, m.open, m.closed, m.due])).toEqual([['M1', 3, 4, '2026-12-01']])
  const davide = meta.team.find(member => member.login === 'dgpaci')!
  expect(davide.items.map(item => `${item.kind} ${item.repo}#${item.number} ${item.status}`)).toEqual([
    'issue core#1 inprogress', 'pr core#4 inprogress', 'issue app#1 waiting', 'pr core#3 waiting',
  ])
  const luca = meta.team.find(member => member.login === 'lverdi')!
  expect(luca.items.map(item => `${item.kind} ${item.repo}#${item.number} ${item.status}`)).toEqual(['pr core#3 review', 'pr app#7 inprogress'])
  // The flow asks for the labelled closed issues of each repo.
  expect(gh.some(path => path.startsWith('repos/acme/core/issues?state=closed') && path.includes('&labels=pm'))).toBe(true)
  expect(fetched.some(url => url.includes('/acme/app/issues?state=closed') && url.includes('&labels=pm'))).toBe(true)
  expect(meta.flow).not.toBeNull()
})
