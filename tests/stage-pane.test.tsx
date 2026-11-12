import { expect, mock, test } from 'claude-code/testing'

const PLAN = '## Work Plan\n- [x] **Phase 1**: A\n- [x] **Phase 2**: B\n- [x] **Phase 3**: C\n- [>] **Phase 4**: Signature flow\n' +
  '- [ ] **Phase 5**: E\n- [!] **Phase 6**: Broken one\n- [~] **Phase 7**: Waiting\n'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /src/anaci\n',
  '/src/anaci/.pm/project.yaml':
    'name: Anaci\nstage: { current: 3, name: Certificate }\nstages:\n  - number: 3\n    issue: 498\n    branch: feature/498-x\n',
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/src/anaci/.pm': [{ name: 'project.yaml', kind: 'file' }],
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the desk reads the plan from the stage branch and shows its phases', async ($, on) => {
  // wf:contract: a registered project whose project.yaml links current stage 3 to branch feature/498-x (issue 498),
  // wf:contract: with process.run answering the git calls of the loader: rev-parse --verify --quiet, ls-tree -r --name-only, show <ref>:<path>;
  // wf:contract: `git remote get-url origin` answers exit code 2 (no origin), so no forge is read and the test stays valid after Phase 3;
  // wf:contract: the local ref feature/498-x missing and origin/feature/498-x present → the plan is read from origin/feature/498-x.
  // wf:contract: The overview row shows a Text matching /phases 3\/7/ and one containing "Signature flow".
  // wf:contract: After pressing the project's Details button the drill-in shows a Text "Delivery" and one line per phase carrying its title and state.
  // wf:contract: When neither feature/498-x nor origin/feature/498-x resolves, the project shows the error "stage 3: branch feature/498-x not found".
  // wf:contract: The browser board (renderBoard) includes the same phases for the selected project.
  let isOriginPresent = true
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
    if (args === 'rev-parse --verify --quiet origin/feature/498-x') return answer(isOriginPresent ? 0 : 1, 'abc\n')
    if (args.startsWith('rev-parse')) return answer(1)
    if (args === 'ls-tree -r --name-only origin/feature/498-x -- .phased')
      return answer(0, '.phased/active/498-x/notes.md\n.phased/active/498-x/plan.md\n')
    if (args === 'show origin/feature/498-x:.phased/active/498-x/plan.md') return answer(0, PLAN)
    return answer(1)
  })

  await $.command.run(RUN)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /phases 3\/7/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Signature flow/ })).toBeTruthy()

  await ui.press({ key: 'open:/src/anaci' })
  expect(await ui.find({ type: 'Text', text: 'Delivery' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Phase 1: A · done' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Phase 4: Signature flow · in-progress' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Phase 6: Broken one · failed' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Phase 7: Waiting · blocked' })).toBeTruthy()

  const board = written['/h/.claude/p2kit/desk.html']
  expect(board).toContain('Signature flow')
  expect(board).toContain('Broken one')
  expect(board).toContain("section('Delivery'")

  isOriginPresent = false
  await $.command.run(RUN)
  expect(await ui.find({ type: 'Text', text: 'stage 3: branch feature/498-x not found' })).toBeTruthy()
  await ui.unmount()
})
