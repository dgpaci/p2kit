import { expect, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'

test('a work package without milestone is offered under New milestone and accepts a drop', async () => {
  // wf:contract: Attach to… lists, after the work packages with a milestone, an optgroup "New milestone" of those with a title and
  // wf:contract: no milestone, neither completed, archived nor cancelled; a drop on such a work package asks the same issue-milestone preview.
  // wf:contract: The preview of a new milestone names Create or Reuse and shows the milestone: line added to the work package file.
  const page = renderBoard({ projects: [], refreshedAt: 0, errors: [] })
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toContain("const newMilestoneTargets = p => p.workPackages.filter(w => w.title && !(w.delivery && w.delivery.milestone) && !['completed', 'archived', 'cancelled'].includes(w.status))")
  expect(script).toContain("el('optgroup', { label: 'New milestone' }")
  expect(script).toContain("if (!milestone) return w.title && w.status !== 'completed' ? { kind: 'issue-milestone', number: item.number, wp: w.id } : null")
  expect(script).toContain("(preview.milestone.action === 'create' ? 'Create' : 'Reuse') + ' milestone '")
  expect(script).not.toContain('${')
})
