import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'

test('notes of no linked work package are listed apart, so every counted blocker is visible', async () => {
  const project = buildProject(
    {
      path: '/p',
      project: 'name: P\nstage: { current: 3 }\n',
      products: [],
      workPackages: [
        { path: '/p/.pm/work-packages/WP-03.md', text: '---\nid: WP-03\nstage: 3\nstatus: in-progress\nbranch: feature/1-x\n---\n' },
        { path: '/p/.pm/work-packages/WP-07.md', text: '---\nid: WP-07\nstage: 3\nstatus: draft\n---\n' },
      ],
      commitNotes: `notes:
  - { sha: aaaa111, wp: WP-03, kind: blocker, status: open, text: linked }
  - { sha: bbbb222, kind: blocker, status: open, text: no work package }
  - { sha: cccc333, wp: WP-09, kind: remark, status: open, text: unknown work package }
  - { sha: dddd444, stage: 3, kind: blocker, status: open, text: old stage note }
  - { sha: eeee555, wp: WP-07, kind: remark, status: open, text: work package not linked }
`,
    },
    '2026-11-12',
  )

  expect(project.openBlockers).toBe(3)
  expect(project.unthemedNotes.map(note => note.text)).toEqual(['no work package', 'unknown work package', 'old stage note', 'work package not linked'])
  expect(project.unthemedNotes[2].wp).toBe('')
})
