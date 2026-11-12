import { expect, mock, test } from 'claude-code/testing'

const KEYS = '/h/Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const wp = (front: string) => `---\nproduct: work-package\n${front}---\n`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /src/anaci\n  - path: /src/kit\n  - path: /src/plain\n  - path: /src/other\n',
  '/src/anaci/.pm/project.yaml': 'name: Anaci\nstage: { current: 3 }\n',
  '/src/anaci/.pm/work-packages/WP-02.md': wp('id: WP-02\ntitle: Previous release\nstage: 2\nstatus: in-progress\nmilestone: v2.4\n'),
  '/src/anaci/.pm/work-packages/WP-03.md': wp('id: WP-03\ntitle: Certificate\nstage: 3\nstatus: in-progress\nissue: 498\nbranch: feature/498-x\nbase: develop\n'),
  '/src/anaci/.pm/work-packages/WP-04.md': wp('id: WP-04\ntitle: Done already\nstage: 3\nstatus: completed\nissue: 497\n'),
  '/src/kit/.pm/project.yaml': 'name: Kit\nstage: { current: 1 }\n',
  '/src/kit/.pm/work-packages/WP-01.md': wp('id: WP-01\ntitle: Release\nstage: 1\nstatus: authorized\nmilestone: v2.5\n'),
  '/src/plain/.pm/project.yaml': 'name: Plain\nstage: { current: 1 }\n',
  '/src/other/.pm/project.yaml': 'name: Other\nstage: { current: 1 }\n',
  '/src/other/.pm/work-packages/WP-01.md': wp('id: WP-01\ntitle: Pilot\nstage: 1\nstatus: in-progress\nissue: 7\n'),
  [KEYS]: JSON.stringify({ hosts: { 'hub.genro.com': { token: 'tok' } } }),
}
const DIRS: Record<string, string[]> = {
  '/src/anaci/.pm/work-packages': ['WP-02.md', 'WP-03.md', 'WP-04.md'],
  '/src/kit/.pm/work-packages': ['WP-01.md'],
  '/src/other/.pm/work-packages': ['WP-01.md'],
}
const ORIGINS: Record<string, string> = {
  '/src/anaci': 'git@hub.genro.com:anaci/anaci.git\n',
  '/src/kit': 'git@github.com:dgpaci/p2kit.git\n',
  '/src/plain': 'git@github.com:dgpaci/plain.git\n',
  '/src/other': 'git@other.host:team/other.git\n',
}
const PULLS = [
  { number: 512, title: 'Certificate header', state: 'closed', merged_at: '2026-11-01T10:00:00Z', html_url: 'https://h/pulls/512', head: { ref: 'feature/498-x' } },
  { number: 600, title: 'Other work', state: 'open', merged_at: null, html_url: 'https://h/pulls/600', head: { ref: 'feature/600-y' } },
]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the drill-in shows the forge state of each open work package of the current stage and whether it is ready to close', async ($, on) => {
  // wf:contract: a registered project whose origin is git@hub.genro.com:anaci/anaci.git, current stage 3, work package WP-03
  // wf:contract: (stage 3, in-progress) linked to issue 498 and branch feature/498-x; WP-02 of stage 2 and WP-04 completed are not read;
  // wf:contract: the Forgejo token is read from ~/Library/Application Support/forgejo-cli.forgejo-cli/keys.json, hosts["hub.genro.com"].token;
  // wf:contract: Forgejo is read with http.fetch GET only (issue, pulls?state=all); GitHub with `gh api <path>` only, never -X, -f or --method.
  // wf:contract: The drill-in shows the issue as "#498" with its state, each pull request of the branch with its state,
  // wf:contract: and a Text "ready to close" when isReadyToClose holds for them; a milestone-linked work package shows "<title> <closed>/<open+closed>".
  // wf:contract: A forge failure (HTTP error, gh exit code ≠ 0, missing token) becomes a project error naming the work package; the local data still shows.
  // wf:contract: Only work packages of the current stage, neither completed nor cancelled, are read from the forge;
  // wf:contract: a project with no linked work package makes no forge request and does not even ask git for its origin.
  const fetched: { url: string; init: { method?: string; headers?: Record<string, string> } }[] = []
  const gh: string[][] = []
  const origins: string[] = []
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', (_, e) => {
    fetched.push({ url: e.url, init: e.init ?? {} })
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (e.url === 'https://hub.genro.com/api/v1/repos/anaci/anaci/issues/498') return reply({ number: 498, title: 'Certificate', state: 'open' })
    if (e.url === 'https://hub.genro.com/api/v1/repos/anaci/anaci/pulls?state=all&sort=recentupdate&limit=50&page=1') return reply(PULLS)
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '', stderr = '') =>
      ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      gh.push(e.argv)
      if (e.argv[2] === 'repos/dgpaci/p2kit/milestones?state=all&per_page=100') {
        return answer(0, JSON.stringify([{ title: 'v2.5', open_issues: 3, closed_issues: 7, due_on: '2026-12-15T00:00:00Z' }]))
      }
      return answer(1, '', 'HTTP 404: Not Found\n')
    }
    const path = e.argv[2]
    const args = e.argv.slice(3).join(' ')
    if (args === 'remote get-url origin') {
      origins.push(path)
      return answer(0, ORIGINS[path])
    }
    if (args === 'rev-parse --verify --quiet feature/498-x' || args === 'rev-parse --verify --quiet develop') return answer(0, 'abc\n')
    if (args.startsWith('log ')) return answer(0, '')
    return answer(1)
  })

  await $.command.run(RUN)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'ready to close', color: 'green' })).toBeTruthy()

  await ui.press({ key: 'open:/src/anaci' })
  await ui.press({ key: 'theme:WP-03' })
  expect(await ui.find({ type: 'Text', text: /^#498 · open/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /PR #512 · merged/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /PR #600/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: 'ready to close' })).toBeTruthy()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/src/kit' })
  await ui.press({ key: 'theme:WP-01' })
  expect(await ui.find({ type: 'Text', text: /^v2\.5 7\/10/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'ready to close' })).toBeFalsy()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/src/other' })
  expect(await ui.find({ type: 'Text', text: 'WP-01: forgejo issue: no fj token for other.host' })).toBeTruthy()
  await ui.press({ key: 'theme:WP-01' })
  expect(await ui.find({ type: 'Text', text: /^WP-01 Pilot · #7/ })).toBeTruthy()

  for (const one of fetched) {
    expect(one.init.method ?? 'GET').toBe('GET')
    expect(one.init.headers?.Authorization).toBe('token tok')
  }
  expect(fetched.map(one => one.url).some(url => url.includes('milestones') || url.includes('issues/497'))).toBe(false)
  expect(gh).toEqual([['gh', 'api', 'repos/dgpaci/p2kit/milestones?state=all&per_page=100']])
  expect(origins).not.toContain('/src/plain')
  await ui.unmount()
})
