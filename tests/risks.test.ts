import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { getAttentionRisks, getRiskResponseLine, getRiskState, isRiskCovered } from '../hooks/risks'
import type { Risk } from '../types'

const RISKS = `risks:
  - id: R-001
    title: Branch staff keep using the old procedure
    probability: medium
    impact: high
    status: open
    response: reduce
    response_actions: "advance circular to the branches, updated inline manuals, upcoming videos"
    verdict: adequate
    verdict_reason: "cuts the cause and keeps a fallback; the videos are not out yet"
  - { id: R-002, title: Provider late, probability: high, impact: high, status: open, response: accept, response_actions: "we wait", verdict: not adequate, verdict_reason: "nobody watches the date" }
  - { id: R-003, title: Old entry, probability: low, impact: low, status: open, response: reduce }
  - { id: R-004, title: Odd verdict, probability: low, impact: medium, status: open, response_actions: "a plan", verdict: maybe }
`

const files = (risks: string) => ({ path: '/p', project: 'name: Portal\n', products: [], workPackages: [], risks })

test('a risk reads its response actions and verdict; an old entry has none, an unknown verdict is an error', () => {
  const project = buildProject(files(RISKS), '2026-11-23')
  const [r1, r2, r3, r4] = project.risks
  expect(r1).toMatchObject({
    response: 'reduce', responseActions: 'advance circular to the branches, updated inline manuals, upcoming videos',
    verdict: 'adequate', verdictReason: 'cuts the cause and keeps a fallback; the videos are not out yet',
  })
  expect(r2).toMatchObject({ response: 'accept', responseActions: 'we wait', verdict: 'not-adequate', verdictReason: 'nobody watches the date' })
  expect(r3).toMatchObject({ response: 'reduce', responseActions: '', verdict: '', verdictReason: '' })
  expect(r4.verdict).toBe('')
  expect(project.errors).toEqual(["risks.yaml: R-004 verdict 'maybe' is neither adequate nor not-adequate"])
})

test('only an adequate verdict on written actions covers a risk; Needs attention lists the high ones, uncovered first', () => {
  const project = buildProject(files(RISKS), '2026-11-23')
  expect(project.risks.map(isRiskCovered)).toEqual([true, false, false, false])
  expect(project.risks.map(getRiskState)).toEqual([
    'response adequate: confirm the closure', 'response not adequate: nobody watches the date', 'no response', 'response not assessed',
  ])
  expect(getAttentionRisks(project.risks).map(r => r.id)).toEqual(['R-002', 'R-001'])
  expect(getRiskResponseLine(project.risks[0])).toBe(
    'reduce · advance circular to the branches, updated inline manuals, upcoming videos · ✔ adequate · cuts the cause and keeps a fallback; the videos are not out yet',
  )
  expect(getRiskResponseLine(project.risks[2])).toBe('reduce · no response')
})

test('a closed risk leaves Needs attention; a risk held by older code, with none of the new fields, reads as no response', () => {
  const old: Risk = { id: 'R-9', title: 'Old', probability: 'high', impact: 'high', status: 'open', owner: '', score: 9 }
  const closed: Risk = { ...old, id: 'R-8', status: 'closed', responseActions: 'done', verdict: 'adequate' }
  expect(isRiskCovered(old)).toBe(false)
  expect(getRiskState(old)).toBe('no response')
  expect(getRiskResponseLine(old)).toBe('no response')
  expect(getAttentionRisks([old, closed]).map(r => r.id)).toEqual(['R-9'])
})
