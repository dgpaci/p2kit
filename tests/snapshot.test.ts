import { expect, mock, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { toSnapshot } from '../hooks/snapshot'

const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/a\n',
  '/t/a/.pm/project.yaml': 'name: Alpha\n',
}
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the desk writes a JSON snapshot of its projects beside the browser board', async ($, on) => {
  // wf:contract: Every time the board is written, the mod also writes ~/.claude/p2kit/desk.json, the text of toSnapshot(input) from hooks/snapshot.ts:
  // wf:contract: { "version": 1, "refreshedAt": <ISO of meta.refreshedAt>, "errors": <meta errors>, "projects": <the projects as the desk holds them> },
  // wf:contract: each project carrying at least path, name, team, milestones, forgePulls, issues, flow and nextReport as in the Project type.
  // wf:contract: The milestones keep the shape { title, open, closed, due, stalled, inReview } (Macro 7).
  // wf:contract: The snapshot is read by /pm-digest and /pm-report; a failure to write it is logged, never fatal, and the board is still written.
  const milestone = { title: 'M1', open: 2, closed: 1, due: '2026-12-01', stalled: 1, inReview: 0 }
  const project = { ...buildProject({ path: '/p', project: 'name: P\n', products: [], workPackages: [] }, '2026-11-13'), milestones: [milestone] }
  const input = { projects: [project], refreshedAt: Date.parse('2026-11-13T12:00:00Z'), errors: ['x: broken'] }
  const text = toSnapshot(input)
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2))
  const snapshot = JSON.parse(text)
  expect(snapshot.version).toBe(1)
  expect(snapshot.refreshedAt).toBe('2026-11-13T12:00:00.000Z')
  expect(snapshot.errors).toEqual(['x: broken'])
  expect(snapshot.projects).toEqual(JSON.parse(JSON.stringify([project])))
  for (const key of ['path', 'name', 'team', 'milestones', 'forgePulls', 'issues', 'flow', 'nextReport']) expect(key in snapshot.projects[0]).toBe(true)
  expect(snapshot.projects[0].milestones).toEqual([milestone])

  // The mod writes it beside the board; a failed snapshot write leaves the board written.
  const written: Record<string, string> = {}
  let isSnapshotBroken = false
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    if (isSnapshotBroken && e.path.endsWith('.json')) throw new Error('disk full')
    written[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 2, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(RUN)
  const desk = JSON.parse(written['/h/.claude/p2kit/desk.json'] ?? '{}')
  expect(desk.version).toBe(1)
  expect(desk.projects.map((p: { path: string; name: string }) => [p.path, p.name])).toEqual([['/t/a', 'Alpha']])
  expect(written['/h/.claude/p2kit/desk.html']).toContain('Alpha')

  isSnapshotBroken = true
  delete written['/h/.claude/p2kit/desk.html']
  await $.command.run(RUN)
  expect(written['/h/.claude/p2kit/desk.html']).toContain('Alpha')
})
