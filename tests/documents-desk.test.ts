import { expect, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import type { Project } from '../types'

const PROJECT: Project = {
  path: '/p', name: 'Portal', code: 'PORTAL', profile: 'standard', status: 'delivery',
  stage: { current: 2, name: 'Build', start: '2026-10-01', plannedEnd: '' },
  roles: [], team: [], milestones: [], forgeIssues: [], forgePulls: [], flow: null, tolerances: [], light: 'green', progress: { done: 0, total: 0 }, highRisks: 0, openIssues: 0,
  nextReport: { due: '', isOverdue: false },
  documents: [{ path: '/p/.pm/brief.md', title: 'Project Brief', product: 'brief', status: 'approved', version: '0.2', folder: '' }],
  workPackages: [], risks: [], issues: [], approvals: [], openBlockers: 0, unthemedNotes: [], errors: [],
}

// The test sandbox forbids new Function: the page script is read as text.
const script = () => {
  const page = renderBoard({ projects: [PROJECT], refreshedAt: 0, errors: [] })
  return page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
}

test('a Markdown document opens rendered by the desk helper, a file link without it or for another file', () => {
  const docLink = /const docLink = \(path, label\) => window\.P2KIT_SERVER && \/\\\.md\$\/i\.test\(path\)\n\s*\? el\('a', \{ href: '\/doc\?path=' \+ encodeURIComponent\(path\), target: '_blank'[^\n]*\n\s*: fileLink\(path, label\)/
  expect(script()).toMatch(docLink)
})

test('the Documents tab builds its links with docLink', () => {
  const body = script().split('function documents(p) {')[1].split('\nfunction ')[0]
  expect(body).toContain('docLink(d.path, d.title), d.status, d.version')
  expect(body).toContain("docLink(d.path, d.title), el('span'")
  expect(body).not.toContain('fileLink(')
})
