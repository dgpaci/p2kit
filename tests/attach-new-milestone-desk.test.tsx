import { expect, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'

test('a work package without milestone accepts a drop; rows carry no Attach to… select', async () => {
  // wf:contract: a drop on a work package with a title and no milestone, not completed, asks the issue-milestone preview;
  // wf:contract: the rows of the Activity tab have no per-row Attach to… select (issue #57).
  // wf:contract: The preview of a new milestone names Create or Reuse and shows the milestone: line added to the work package file.
  const page = renderBoard({ projects: [], refreshedAt: 0, errors: [] })
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).not.toContain('attachControl')
  expect(script).not.toContain("title: 'attach to a work package'")
  expect(script).toContain("if (!milestone) return w.title && w.status !== 'completed' ? { kind: 'issue-milestone', number: item.number, wp: w.id } : null")
  expect(script).toContain("(preview.milestone.action === 'create' ? 'Create' : 'Reuse') + ' milestone '")
  expect(script).not.toContain('${')
})
