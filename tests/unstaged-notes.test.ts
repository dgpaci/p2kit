import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

test('notes of no linked stage are listed apart, so every counted blocker is visible', async () => {
  const project = buildProject(
    {
      path: '/p',
      project: 'name: P\nstage: { current: 3 }\nstages:\n  - number: 3\n    branch: feature/1-x\n',
      products: [],
      workPackages: [],
      commitNotes: `notes:
  - { sha: aaaa111, stage: 3, kind: blocker, status: open, text: linked }
  - { sha: bbbb222, kind: blocker, status: open, text: no stage }
  - { sha: cccc333, stage: 9, kind: remark, status: open, text: unknown stage }
`,
    },
    '2026-11-12',
  )

  expect(project.openBlockers).toBe(2)
  expect(project.unstagedNotes.map(note => note.text)).toEqual(['no stage', 'unknown stage'])
})
