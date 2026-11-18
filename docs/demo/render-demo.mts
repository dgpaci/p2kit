// Renders the desk of the fictional demo project of docs/guide.md: `npx tsx docs/demo/render-demo.mts <out.html>`.
// Serve the file on 127.0.0.1 and capture its routes (#/demo/webshop, …/tab/board, …/theme/WP-02) to refresh docs/images/.
import { writeFileSync } from 'node:fs'

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const pick = (mod: any, name: string) => mod[name] ?? mod.default?.[name]
const projectMod = await import(`${REPO}/hooks/project.ts`)
const teamMod = await import(`${REPO}/hooks/team.ts`)
const msMod = await import(`${REPO}/hooks/milestones.ts`)
const flowMod = await import(`${REPO}/hooks/flow.ts`)
const boardMod = await import(`${REPO}/hooks/board.ts`)
const buildProject = pick(projectMod, 'buildProject')
const { toTeamItems, withItems } = { toTeamItems: pick(teamMod, 'toTeamItems'), withItems: pick(teamMod, 'withItems') }
const toMilestoneProgress = pick(msMod, 'toMilestoneProgress'), toForgeIssues = pick(msMod, 'toForgeIssues'), toForgePulls = pick(msMod, 'toForgePulls')
const toFlow = pick(flowMod, 'toFlow')
const renderBoard = pick(boardMod, 'renderBoard')

const TODAY = '2026-11-18'
const NOW = Date.parse(`${TODAY}T10:00:00Z`)
const P = '/demo/webshop'
const GH = 'https://github.com/acme/webshop'
const day = (n: number) => new Date(NOW - n * 86400000).toISOString()

const project = `schema: 1
name: Webshop renewal
code: SHOP
profile: agile
status: delivery
stage:
  current: 2
  name: Build
  start: 2026-10-05
  planned_end: 2026-12-18
tolerances:
  time: { limit: 10, used: 4, unit: days }
  cost: { limit: 6000, used: 2500, unit: EUR }
  effort: { limit: 24, used: 0, unit: hours }
roles:
  executive: Anna Rossi
  senior_user: [Paolo Conti]
  senior_supplier: [Giulia Neri]
  project_manager: Giulia Neri
  team_manager: [Marco Bianchi, Luca Verdi]
team:
  wip_limit: 3
  people:
    Giulia Neri: { login: gneri }
    Marco Bianchi: { login: mbianchi }
    Luca Verdi: { login: lverdi, wip_limit: 2 }
reporting:
  highlight_every_days: 14
  last_highlight: 2026-11-10
approvals:
  - decision: authorize-initiation
    by: Anna Rossi
    date: 2026-09-22
    note: mandate accepted, brief approved
  - decision: approve-stage-2
    by: Anna Rossi
    date: 2026-10-03
    note: Build stage plan approved
`

const fm = (body: string) => `---\n${body}\n---\n`
const products = [
  { path: `${P}/.pm/brief.md`, text: fm('title: Project Brief\nproduct: brief\nversion: 1.0\nstatus: approved\nupdated: 2026-09-22') + `
# Project Brief — Webshop renewal

## Objectives

- [x] **O-1** Customers log in with their account — *Done when:* login works on staging. 2026-10-30, Anna Rossi.
- [ ] **O-2** Checkout in three steps — *Done when:* a test order is paid end to end.
- [ ] **O-3** Customers are told about their order — *Done when:* confirmation and shipping emails are sent.
` },
  { path: `${P}/.pm/pid.md`, text: fm('title: Project Initiation Documentation\nproduct: pid\nversion: 1.0\nstatus: approved\nupdated: 2026-10-03') + '\n# PID\n' },
  { path: `${P}/.pm/stages/2/plan.md`, text: fm('title: Stage 2 plan — Build\nproduct: stage-plan\nversion: 1.0\nstatus: approved\nupdated: 2026-10-03') + '\n# Stage 2\n' },
  { path: `${P}/.pm/reports/2026-11-10-highlight.md`, text: fm('title: Highlight Report 2026-11-10\nproduct: report\nversion: 1.0\nstatus: submitted\nupdated: 2026-11-10') + '\n# Highlight\n' },
  { path: `${P}/.pm/digests/2026-11-14.md`, text: fm('title: Weekly digest 2026-11-14\nproduct: digest\nversion: 1.0\nstatus: draft\nupdated: 2026-11-14') + '\n# Digest\n' },
]

const wp = (front: string) => fm(`product: work-package\n${front}`) + '\n'
const workPackages = [
  { path: `${P}/.pm/work-packages/WP-01.md`, text: wp('id: WP-01\ntitle: Customer login\nstage: 2\nstatus: completed\nteam_manager: Marco Bianchi\ndue: 2026-10-30\nmilestone: Login\nestimate: 16\nactual: 18\nhorizon: now\nrank: 1\nobjectives: [O-1]') },
  { path: `${P}/.pm/work-packages/WP-02.md`, text: wp('id: WP-02\ntitle: Three-step checkout\nstage: 2\nstatus: in-progress\nteam_manager: Marco Bianchi\ndue: 2026-11-27\nissue: 12\nmilestone: Checkout\nbranch: feature/12-checkout\nbase: main\nestimate: 32\nactual: 22\nhorizon: now\nrank: 2\nobjectives: [O-2]') },
  { path: `${P}/.pm/work-packages/WP-03.md`, text: wp('id: WP-03\ntitle: Order emails\nstage: 2\nstatus: authorized\nteam_manager: Luca Verdi\ndue: 2026-12-11\nmilestone: Order emails\nestimate: 12\nhorizon: next\nrank: 1\nobjectives: [O-3]') },
  { path: `${P}/.pm/work-packages/WP-04.md`, text: wp('id: WP-04\ntitle: Catalogue search\nstage: 3\nstatus: draft\nteam_manager: Luca Verdi\nhorizon: later\nrank: 1') },
]

const plan = `# Three-step checkout

## Objective

A customer goes from cart to paid order in three steps: address, shipping, payment.

## Phases

- [x] **Phase 1**: Cart summary and address step
  > Done: the cart opens the address step and keeps it on reload.
- [x] **Phase 2**: Shipping options
  > Done: shipping cost computed per zone and shown before payment.
- [>] **Phase 3**: Payment with the provider sandbox
  - Done: a test card pays the order and the order turns paid.
- [ ] **Phase 4**: Order confirmation page
  - Done: the paid order shows its summary and number.
`
const log = [
  ['a1b2c3d4e5f6a7b8c9d0', 'a1b2c3d', '2026-11-17', 'feat: call the payment provider sandbox'],
  ['b2c3d4e5f6a7b8c9d0e1', 'b2c3d4e', '2026-11-13', 'feat: shipping cost per zone'],
  ['c3d4e5f6a7b8c9d0e1f2', 'c3d4e5f', '2026-11-07', 'feat: address step keeps its data'],
].map(f => f.join('\x1f')).join('\n')

const files = {
  path: P, project, products, workPackages,
  risks: `risks:
  - { id: R-001, title: Payment provider sandbox keys arrive late, category: threat, probability: high, impact: medium, owner: Giulia Neri, status: open, response: reduce }
  - { id: R-002, title: Email provider changes pricing, category: threat, probability: low, impact: medium, owner: Luca Verdi, status: open, response: accept }
`,
  issues: `issues:
  - { id: I-001, title: Senior User asks for guest checkout, type: request-for-change, priority: medium, status: open, raised: 2026-11-12 }
`,
  wpPlans: [{ wp: 'WP-02', ref: 'feature/12-checkout', path: '.phased/active/12-checkout/plan.md', text: plan }],
  wpLogs: [{ wp: 'WP-02', text: log }],
  commitNotes: `notes:
  - { sha: a1b2c3d, wp: WP-02, kind: blocker, status: open, text: 'production keys for the payment provider still missing', date: 2026-11-17 }
`,
  iterations: `iterations:
  - number: 3
    goal: Checkout end to end
    start: 2026-11-10
    end: 2026-11-21
    stage: 2
    status: open
    work_packages: [WP-02]
  - number: 2
    goal: Login
    start: 2026-10-20
    end: 2026-10-31
    stage: 2
    status: closed
    work_packages: [WP-01]
    delivered: [WP-01]
    result: login on staging
`,
  lessons: `retrospectives:
  - { date: 2026-10-31, iteration: 2, stage: 2 }
lessons:
  - { id: L-001, date: 2026-10-31, iteration: 2, kind: keep, text: 'one issue per pull request' }
  - { id: L-002, date: 2026-10-31, iteration: 2, kind: change, text: 'ask the review the same day the PR is ready' }
actions:
  - { id: A-001, date: 2026-10-31, text: 'review reminder in the weekly digest', issue: 11, status: open }
`,
  dailyLog: `entries:
  - { id: D-001, date: 2026-11-17, kind: event, source: forge, text: 'pull request opened: Three-step checkout', ref: '#20' }
  - { id: D-002, date: 2026-11-17, kind: decision, source: meeting, text: 'guest checkout goes to stage 3' }
  - { id: D-003, date: 2026-11-17, kind: action, source: meeting, text: 'ask the provider for the production keys', owner: Giulia Neri, due: 2026-11-20, status: open }
`,
}

let p = buildProject(files, TODAY)

// The forge, as the desk would read it from acme/webshop.
const READY = '## Why\nx\n## What changes\nx\n## Done when\nx'
const u = (login: string) => ({ login })
const issue = (number: number, title: string, milestone: string | null, assignees: string[], updated: number, extra: object = {}) => ({
  number, title, html_url: `${GH}/issues/${number}`, updated_at: day(updated), created_at: day(updated + 6), state: 'open',
  assignees: assignees.map(u), milestone: milestone ? { title: milestone } : null, body: READY, ...extra,
})
const issues = [
  issue(12, 'Checkout: from cart to paid order', 'Checkout', ['mbianchi'], 1, { has_commits: true }),
  issue(14, 'Payment provider integration', 'Checkout', ['lverdi'], 2, { has_commits: true }),
  issue(15, 'Order confirmation page', 'Checkout', ['lverdi'], 3),
  issue(16, 'Confirmation email after payment', 'Order emails', ['mbianchi'], 4),
  issue(17, 'Shipping notification email', 'Order emails', [], 5),
  issue(18, 'Search bar on the catalogue', null, [], 9, { body: 'We need search.' }),
  issue(11, 'Review reminder in the weekly digest', null, ['gneri'], 10),
]
const pulls = [
  { number: 20, title: 'Three-step checkout', html_url: `${GH}/pull/20`, updated_at: day(1), created_at: day(1), draft: false,
    user: u('mbianchi'), assignees: [u('mbianchi')], requested_reviewers: [u('gneri')], milestone: { title: 'Checkout' }, body: 'Closes #12' },
  { number: 21, title: 'Payment provider client', html_url: `${GH}/pull/21`, updated_at: day(2), created_at: day(3), draft: true,
    user: u('lverdi'), assignees: [u('lverdi')], requested_reviewers: [], milestone: { title: 'Checkout' }, body: 'Refs #14' },
]
const milestones = [
  { title: 'Checkout', open_issues: 5, closed_issues: 3, due_on: '2026-11-27T00:00:00Z', number: 2 },
  { title: 'Order emails', open_issues: 2, closed_issues: 0, due_on: '2026-12-11T00:00:00Z', number: 3 },
]
const team = p.team.map((m: any) => (m.login ? withItems(m, toTeamItems(m.login, issues, pulls, NOW)) : m))
const forgeIssues = toForgeIssues(issues, p.readiness, pulls)

// 90 days of closed issues and merged pulls, for the Metrics tab.
const closedIssues: any[] = [], mergedPulls: any[] = [], firstReviews: Record<number, string> = {}
for (let n = 0; n < 16; n++) {
  const closed = 4 + n * 5, opened = closed + 3 + (n % 4) * 2
  closedIssues.push({ number: 100 + n, title: `Closed task ${n + 1}`, html_url: `${GH}/issues/${100 + n}`, state: 'closed',
    created_at: day(opened), closed_at: day(closed), updated_at: day(closed), milestone: n < 5 ? { title: 'Login' } : null })
  mergedPulls.push({ number: 200 + n, title: `Merged change ${n + 1}`, html_url: `${GH}/pull/${200 + n}`, user: u(n % 2 ? 'lverdi' : 'mbianchi'),
    created_at: day(closed + 2), merged_at: day(closed), closed_at: day(closed), updated_at: day(closed), milestone: null })
  firstReviews[200 + n] = day(closed + 1 - (n % 3) * 0.3)
}

p = {
  ...p, team, forgeIssues, forgePulls: toForgePulls(pulls), milestones: toMilestoneProgress(milestones, issues, pulls, NOW),
  notReady: forgeIssues.filter((i: any) => i.missing.length > 0).length,
  flow: toFlow(closedIssues, mergedPulls, firstReviews, NOW),
  workPackages: p.workPackages.map((w: any) => {
    if (w.id === 'WP-02') return { ...w, delivery: { ...w.delivery, forge: {
      issue: { number: 12, title: 'Checkout: from cart to paid order', state: 'open' },
      milestone: { title: 'Checkout', open: 5, closed: 3, due: '2026-11-27' },
      pulls: [{ number: 20, title: 'Three-step checkout', state: 'open', url: `${GH}/pull/20` }], isReadyToClose: false } } }
    if (w.id === 'WP-01') return { ...w, delivery: { ...w.delivery, forge: {
      milestone: { title: 'Login', open: 0, closed: 5, due: '2026-10-30' },
      pulls: [{ number: 9, title: 'Customer login', state: 'merged', url: `${GH}/pull/9` }], isReadyToClose: true } } }
    if (w.id === 'WP-03') return { ...w, delivery: { ...w.delivery, forge: {
      milestone: { title: 'Order emails', open: 2, closed: 0, due: '2026-12-11' }, pulls: [], isReadyToClose: false } } }
    return w
  }),
}

writeFileSync(process.argv[2] ?? 'desk-demo.html', renderBoard({ projects: [p], refreshedAt: NOW, errors: [] }))
console.log('errors:', p.errors)
