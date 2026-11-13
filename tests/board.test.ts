import { expect, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import type { Project, WorkPackage } from '../types'

const wp = (id: string, title: string, status: string): WorkPackage => ({
  path: `/p/.pm/work-packages/${id}.md`, id, title, stage: 2, status, teamManager: 'Anna', due: '',
  delivery: {
    issue: 1, milestone: '', branch: `feature/${id}`, base: 'main', ref: `feature/${id}`, planPath: '',
    phases: [{ number: 1, title: 'Only', state: 'done' }], summary: { done: 1, total: 1, current: '', failed: 0 },
    commits: [], unlinkedNotes: [], forge: null,
  },
})

const PROJECT: Project = {
  path: '/p', name: 'Portal', code: 'PORTAL', profile: 'standard', status: 'delivery',
  stage: { current: 2, name: 'Build', start: '2026-10-01', plannedEnd: '' },
  roles: [], team: [], milestones: [], forgeIssues: [], forgePulls: [], tolerances: [], light: 'green', progress: { done: 1, total: 3 }, highRisks: 0, openIssues: 0,
  nextReport: { due: '', isOverdue: false }, documents: [],
  workPackages: [wp('WP-01', 'Open one', 'in-progress'), wp('WP-02', 'Bad </script><b>', 'authorized'), wp('WP-03', 'Closed', 'completed')],
  risks: [], issues: [], approvals: [], openBlockers: 0, unthemedNotes: [], errors: [],
}

test('the board embeds the work themes and holds the form tabs and the page script', () => {
  const page = renderBoard({ projects: [PROJECT], refreshedAt: 0, errors: [] })
  const json = page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>'))
  const data = JSON.parse(json)
  expect(data.projects[0].themes.map((w: WorkPackage) => w.id)).toEqual(['WP-01', 'WP-02'])
  expect(data.projects[0].themes[1].title).toBe('Bad </script><b>')
  expect(json).not.toContain('</script>')
  for (const label of ['Recap', 'Roles', 'Documents', 'Work packages', 'Risks', 'Issues', 'Approvals', 'Work themes']) expect(page).toContain(label)
  // The test sandbox forbids new Function: check the script is the whole template, with nothing left uninterpolated.
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toContain('function draw()')
  expect(script).toContain('const TABS = [')
  expect(script).not.toContain('${')
})
