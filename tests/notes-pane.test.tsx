import { expect, mock, test } from 'claude-code/testing'

const US = '\x1f'
const LOG = `aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111${US}aaaa111${US}2026-11-10${US}feat: header\n` +
  `bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222${US}bbbb222${US}2026-11-11${US}fix: rows\n`
const WPS = '/src/anaci/.pm/work-packages'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /src/anaci\n',
  '/src/anaci/.pm/project.yaml': 'name: Anaci\nstage: { current: 3 }\n',
  [`${WPS}/WP-03.md`]: '---\nid: WP-03\ntitle: Certificate\nstage: 3\nstatus: in-progress\nissue: 498\nbranch: feature/498-x\nbase: develop\n---\n',
  '/src/anaci/.pm/registers/commit-notes.yaml':
    'notes:\n  - { sha: bbbb222, wp: WP-03, kind: blocker, status: open, text: waiting for the print template, date: 2026-11-11 }\n',
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/src/anaci/.pm': [{ name: 'project.yaml', kind: 'file' }, { name: 'work-packages', kind: 'dir' }],
  [WPS]: [{ name: 'WP-03.md', kind: 'file' }],
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the drill-in lists the commits of a work package with their notes and the row counts open blockers', async ($, on) => {
  // wf:contract: a registered project with work package WP-03 (stage 3, in-progress) linked to branch feature/498-x and base develop,
  // wf:contract: and a .pm/registers/commit-notes.yaml holding one open blocker with `wp: WP-03` on one of the branch's commits;
  // wf:contract: process.run answers the git calls of the loader, the log one being:
  // wf:contract: git -C <path> log --date=short --format=%H%x1f%h%x1f%ad%x1f%s <base ref>..<branch ref>.
  // wf:contract: The overview row shows a red Text matching /blockers 1/.
  // wf:contract: The drill-in lists each commit as "<short sha> <subject>" with its notes beneath, kind and text visible.
  // wf:contract: `git remote get-url origin` answers exit code 2 (no origin): no forge request is made.
  const written: Record<string, string> = {}
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] }))
  on('fs.list', (_, e) => ({ value: (DIRS[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const args = e.argv.slice(3).join(' ')
    const answer = (exitCode: number, stdout = '') =>
      ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args === 'remote get-url origin') return answer(2)
    if (args === 'rev-parse --verify --quiet feature/498-x' || args === 'rev-parse --verify --quiet develop') return answer(0, 'abc\n')
    if (args === 'log --date=short --format=%H%x1f%h%x1f%ad%x1f%s develop..feature/498-x') return answer(0, LOG)
    return answer(1)
  })

  await $.command.run(RUN)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /blockers 1/, color: 'red' })).toBeTruthy()

  await ui.press({ key: 'open:/src/anaci' })
  expect(await ui.find({ type: 'Text', text: 'WP-03 bbbb222 waiting for the print template', color: 'red' })).toBeTruthy()
  await ui.press({ key: 'theme:WP-03' })
  expect(await ui.find({ type: 'Text', text: 'aaaa111 feat: header' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'bbbb222 fix: rows' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /blocker · open · waiting for the print template/ })).toBeTruthy()
  expect(written['/h/.claude/p2kit/desk.html']).toContain('waiting for the print template')
  await ui.unmount()
})
