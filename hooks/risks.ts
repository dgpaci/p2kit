import type { Risk } from '../types'

// The pane's copy of the risk rules of the board's page script (hooks/board.ts: isCovered, riskState): keep the two equal.

/** True when the risk's response actions are written and Claude judged them adequate. A project held by older code has neither. */
export const isRiskCovered = (risk: Risk): boolean => !!risk.responseActions && risk.verdict === 'adequate'

/** What the risk is waiting for: a response, its assessment, a better response, or the user's confirmation of the closure. */
export function getRiskState(risk: Risk): string {
  if (!risk.responseActions) return 'no response'
  if (risk.verdict === 'adequate') return 'response adequate: confirm the closure'
  if (risk.verdict === 'not-adequate') return `response not adequate${risk.verdictReason ? `: ${risk.verdictReason}` : ''}`
  return 'response not assessed'
}

/** The high open risks (score 6 or more) for Needs attention: the uncovered ones first, then the covered ones waiting for the closure. */
export const getAttentionRisks = (risks: Risk[]): Risk[] =>
  risks.filter(risk => risk.status === 'open' && risk.score >= 6).sort((a, b) => Number(isRiskCovered(a)) - Number(isRiskCovered(b)) || b.score - a.score)

/** The second pane line of a risk in the Risks register: response type and actions, then Claude's verdict and its reasoning. */
export function getRiskResponseLine(risk: Risk): string {
  const response = [risk.response, risk.responseActions || 'no response'].filter(Boolean).join(' · ')
  if (!risk.responseActions) return response
  const verdict = risk.verdict === 'adequate' ? '✔ adequate' : risk.verdict === 'not-adequate' ? '✘ not adequate' : 'not assessed'
  return [response, verdict, risk.verdictReason].filter(Boolean).join(' · ')
}
