import { expect, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const BRIEF = '## Objectives\n- [x] **O-1** Skills\n- [ ] **O-2** Nothing lost\n- [ ] **O-3** Assign\n'
const WP = '---\nid: WP-05\ntitle: Enhancing\nstatus: authorized\nmilestone: Enhancing\nobjectives: [O-2, O-3]\n---\n'

test('the page carries the objectives: a bar in the overview row, a section after the recap cards, the served ones above the phases', async () => {
  // wf:contract: Overview row and pane: "objectives <bar> <met>/<total>" right after the stage, the dropped ones not counted; absent without a checklist.
  // wf:contract: Recap: an "Objectives" section right after the cards, before Tolerances / Needs attention: id, ticked or open, work packages, completed over them.
  // wf:contract: Work package page: the brief objectives it serves, above "Phases". The work package progress is unchanged.
  const project = buildProject({
    path: '/t/p', project: 'name: P\nstage: { current: 2 }\n',
    products: [{ path: '/t/p/.pm/brief.md', text: BRIEF }], workPackages: [{ path: '/t/p/.pm/work-packages/WP-05.md', text: WP }],
  }, '2026-11-18')
  const page = renderBoard({ projects: [project], refreshedAt: 0, errors: [] })
  const data = JSON.parse(page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>')))
  expect(data.projects[0].objectives.map((o: { id: string; wps: string[] }) => [o.id, o.wps])).toEqual([['O-1', []], ['O-2', ['WP-05']], ['O-3', ['WP-05']]])
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toMatch(/el\('span', \{ textContent: stageOf\(p\) \}\),\n\s+objectivesFact\(p\),/)
  expect(script).toMatch(/'highlight report', p\.nextReport\.isOverdue \? 'err' : ''\)\),\n\s+objectivesSection\(p\),\n\s+el\('div', \{ className: 'grid2' \}/)
  expect(script).toMatch(/objectivesTable\(p, served\)\] : \[\]\),\n\s+el\('h3', \{ textContent: 'Phases' \}\),/)
  expect(script).not.toContain('${')
})
