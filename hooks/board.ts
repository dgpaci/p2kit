import { getSessionLink } from './actions'
import { getWorkThemes } from './project'
import type { Project } from '../types'

// The page reloads itself to pick up the file the next refresh writes.
const RELOAD_MS = 60 * 1000

/** The open blocker notes of a project — linked commits, unlinked notes, notes of no work theme — as `{ wp, sha, text }`. */
export function getOpenBlockers(project: Project): { wp: string; sha: string; text: string }[] {
  const isOpenBlocker = (note: { kind: string; status: string }) => note.kind === 'blocker' && note.status === 'open'
  const found: { wp: string; sha: string; text: string }[] = []
  for (const wp of project.workPackages) {
    if (!wp.delivery) continue
    for (const commit of wp.delivery.commits) for (const note of commit.notes) if (isOpenBlocker(note)) found.push({ wp: wp.id, sha: commit.short, text: note.text })
    for (const note of wp.delivery.unlinkedNotes) if (isOpenBlocker(note)) found.push({ wp: wp.id, sha: note.sha.slice(0, 7), text: note.text })
  }
  for (const note of project.unthemedNotes) if (isOpenBlocker(note)) found.push({ wp: '—', sha: note.sha.slice(0, 7), text: note.text })
  return found
}

export type BoardInput = { projects: Project[]; refreshedAt: number; errors: string[] }

// JSON inside a <script> element: nothing in it may close the element.
const embed = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c')

/** The whole desk as one self-contained HTML page: the overview of projects and their work themes, and a project's form. */
export function renderBoard(input: BoardInput): string {
  const data = {
    projects: input.projects.map(project => ({ ...project, sessionLink: getSessionLink(project), themes: getWorkThemes(project), blockers: getOpenBlockers(project) })),
    refreshedAt: new Date(input.refreshedAt).toISOString(),
    errors: input.errors,
    reloadMs: RELOAD_MS,
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project desk</title>
<style>${STYLE}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="data">${embed(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}

const STYLE = `
:root { --bg: #ffffff; --fg: #1f2328; --dim: #656d76; --line: #d0d7de; --chip: #f6f8fa; --on: #0969da;
  --green: #1a7f37; --amber: #9a6700; --red: #cf222e; --none: #8c959f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1117; --fg: #e6edf3; --dim: #8d96a0;
  --line: #30363d; --chip: #161b22; --on: #58a6ff; --green: #3fb950; --amber: #d29922; --red: #f85149; --none: #6e7681; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 -apple-system, system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin: 18px 0 6px; }
.dim { color: var(--dim); } .err { color: var(--red); } .ok { color: var(--green); }
.mono { font-family: ui-monospace, monospace; font-size: 13px; }
a { color: var(--on); text-decoration: none; } a:hover { text-decoration: underline; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 500; font-size: 13px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; }
.bar { display: inline-block; width: 90px; height: 6px; border-radius: 3px; background: var(--line); vertical-align: middle; margin-right: 6px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--on); }
.phases { display: inline-flex; gap: 2px; vertical-align: middle; margin-right: 6px; }
.phases i { width: 12px; height: 8px; border-radius: 2px; background: var(--line); }
.phases i.done { background: var(--green); } .phases i.in-progress { background: var(--on); }
.phases i.failed { background: var(--red); } .phases i.blocked { background: var(--amber); }
.pill { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; font-size: 12px; color: var(--dim); }
.pill.open { color: var(--on); border-color: var(--on); } .pill.merged, .pill.ready { color: var(--green); border-color: var(--green); }
.pill.red { color: var(--red); border-color: var(--red); }
.pill.review { color: var(--amber); border-color: var(--amber); } .pill.inprogress { color: var(--on); border-color: var(--on); }
.pill.waiting { color: var(--dim); } .pill.stalled { color: var(--red); border-color: var(--red); } .pill.todo { color: var(--fg); }
.pill.wip-over { color: #fff; background: var(--red); border-color: var(--red); }
.forge { display: flex; flex-wrap: wrap; gap: 6px; }
button { border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 999px; padding: 3px 10px; font: inherit; cursor: pointer; }
.project { border: 1px solid var(--line); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
.project-head { display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: center; padding: 10px 12px; cursor: pointer; background: var(--chip); }
.project-head:hover { filter: brightness(0.98); }
.project-head .facts { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--dim); margin-top: 2px; }
.theme-row { display: grid; grid-template-columns: 18px 220px 1fr auto; gap: 8px; align-items: center; padding: 7px 12px; border-top: 1px solid var(--line); cursor: pointer; }
.theme-row:hover { background: var(--chip); }
.theme-row .tree { color: var(--line); text-align: right; }
.theme-row .forge { justify-content: flex-end; }
.nothemes { padding: 7px 12px 7px 38px; border-top: 1px solid var(--line); }
.form-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.themebar { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 0; padding: 10px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); align-items: center; }
.themebar .label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin-right: 4px; }
.theme-chip { border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px; background: var(--bg); text-align: left; }
.theme-chip.sel { border-color: var(--on); box-shadow: 0 0 0 1px var(--on) inset; }
.theme-chip small { display: block; color: var(--dim); font-size: 12px; }
.tabs { display: flex; border-bottom: 1px solid var(--line); margin-top: 12px; overflow-x: auto; }
.tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 8px 12px; color: var(--dim); white-space: nowrap; }
.tab.sel { color: var(--fg); border-bottom-color: var(--on); font-weight: 600; }
.tab .n { font-size: 12px; color: var(--dim); margin-left: 4px; }
.panel { padding-top: 6px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 12px; }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.card .k { font-size: 12px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; }
.card .v { font-size: 20px; font-weight: 600; margin-top: 2px; }
.card .s { font-size: 12px; color: var(--dim); }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 24px; }
.note { padding-left: 12px; font-size: 13px; }
.crumb { margin-bottom: 10px; }
.members { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
.members .label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin-right: 4px; }
.member-chip.sel { border-color: var(--on); color: var(--on); }
.person { border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; overflow: hidden; }
.person.over { border-color: var(--red); }
.person-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 12px; background: var(--chip); flex-wrap: wrap; }
.person-head .who small { color: var(--dim); margin-left: 6px; }
.person table td, .person table th { padding: 5px 12px; }
.person .empty { padding: 7px 12px; }
@media (max-width: 720px) {
  .theme-row { grid-template-columns: 18px 1fr; } .theme-row .forge { grid-column: 2; justify-content: flex-start; }
  .theme-row > :nth-child(3) { grid-column: 2; }
}
`

// The route lives in the URL hash so the reload keeps it: '' overview · '<path>' recap · '<path>/tab/<id>' · '<path>/theme/<WP-id>'.
const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent)
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c !== null && c !== undefined && c !== false)); return node }
const dot = light => el('span', { className: 'dot', title: 'tolerances: ' + light, style: 'background: var(--' + light + ')' })
const fileLink = (path, label) => el('a', { href: 'file://' + encodeURI(path), textContent: label })
const sessionLink = p => el('a', { href: p.sessionLink, textContent: 'Open session', onclick: e => e.stopPropagation() })
const bar = (done, total) => el('span', {}, el('span', { className: 'bar' }, el('i', { style: 'width:' + (total ? Math.round(100 * done / total) : 0) + '%' })), done + '/' + total)
const phaseBar = d => d.phases.length ? el('span', { className: 'phases', title: d.summary.current }, ...d.phases.map(ph => el('i', { className: ph.state, title: 'Phase ' + ph.number + ': ' + ph.title + ' · ' + ph.state }))) : el('span', { className: 'dim', textContent: 'no plan' })
const pill = (text, cls = '') => el('span', { className: 'pill ' + cls, textContent: text })
const stageOf = p => p.stage.current === null ? 'no stage' : 'stage ' + p.stage.current + (p.stage.name ? ' ' + p.stage.name : '')
const isOpen = s => s === 'open'
// WIP: one red badge per person over the limit, in the card head and in the recap's "Needs attention".
const overLimit = p => p.team.filter(m => m.isOverLimit)
const wipText = m => 'WIP ' + m.person + ' ' + m.wip + '/' + m.wipLimit
const wipBadges = p => overLimit(p).map(m => pill(wipText(m), 'wip-over'))

let route = decodeURIComponent(location.hash.slice(1))
const go = r => { route = r; history.replaceState(null, '', r ? '#' + encodeURIComponent(r) : location.pathname); draw() }
const link = (text, r, className = '') => el('a', { href: '#', className, textContent: text, onclick: e => { e.preventDefault(); go(r) } })

function forgePills(d) {
  const f = d.forge, out = []
  if (f && f.issue) out.push(pill('#' + f.issue.number + ' ' + f.issue.state, isOpen(f.issue.state) ? 'open' : ''))
  else if (d.issue !== null) out.push(pill('#' + d.issue))
  if (f && f.milestone) out.push(pill(f.milestone.title + ' ' + f.milestone.closed + '/' + (f.milestone.open + f.milestone.closed)))
  else if (d.milestone) out.push(pill(d.milestone))
  if (f) f.pulls.forEach(pr => out.push(pill('PR #' + pr.number + ' ' + pr.state, pr.state)))
  if (d.summary.failed) out.push(pill(d.summary.failed + ' failed', 'red'))
  if (f && f.isReadyToClose) out.push(pill('ready to close', 'ready'))
  return out
}

function progressText(d) {
  const s = d.summary
  return s.total ? s.done + '/' + s.total + (s.current ? ' · ' + s.current : '') : ''
}

function tableOf(head, rows) {
  if (!rows.length) return el('p', { className: 'dim', textContent: 'None.' })
  return el('table', {}, el('thead', {}, el('tr', {}, ...head.map(h => el('th', { textContent: h })))),
    el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', {}, c))))))
}

function noteLine(n) {
  const open = n.kind === 'blocker' && n.status === 'open'
  return el('div', { className: 'note ' + (open ? 'err' : 'dim'), textContent: n.kind + ' · ' + n.status + ' · ' + n.text + (n.date ? ' (' + n.date + ')' : '') })
}
const shaNote = n => el('div', {}, el('span', { className: 'mono', textContent: n.sha.slice(0, 7) + ' ' }), noteLine(n))

function overview() {
  return [
    el('h1', { textContent: 'Project desk' }),
    el('p', { className: 'dim', textContent: data.projects.length + ' projects · updated ' + new Date(data.refreshedAt).toLocaleString() }),
    ...data.errors.map(e => el('p', { className: 'err', textContent: e })),
    ...data.projects.map(p => el('div', { className: 'project' },
      el('div', { className: 'project-head', onclick: () => go(p.path) },
        dot(p.light),
        el('div', {}, el('strong', { textContent: p.name }), ' ', el('span', { className: 'dim', textContent: p.code }),
          el('div', { className: 'facts' },
            el('span', { textContent: stageOf(p) }),
            el('span', {}, 'WPs ', bar(p.progress.done, p.progress.total)),
            el('span', { className: p.highRisks ? 'err' : '', textContent: 'high risks ' + p.highRisks }),
            el('span', { className: p.openBlockers ? 'err' : '', textContent: 'blockers ' + p.openBlockers }),
            el('span', { textContent: 'open issues ' + p.openIssues }),
            el('span', { className: p.nextReport.isOverdue ? 'err' : '', textContent: 'next report ' + (p.nextReport.due || '—') + (p.nextReport.isOverdue ? ' overdue' : '') }),
            p.errors.length ? el('span', { className: 'err', textContent: '⚠ ' + p.errors.length + ' errors' }) : null,
            ...wipBadges(p))),
        el('span', {}, sessionLink(p))),
      ...(p.themes.length ? p.themes.map(w => el('div', { className: 'theme-row', onclick: () => go(p.path + '/theme/' + w.id) },
        el('span', { className: 'tree', textContent: '└' }),
        el('div', {}, el('span', { className: 'mono', textContent: w.id + ' ' }), w.title),
        el('div', {}, phaseBar(w.delivery), el('span', { className: 'dim', textContent: progressText(w.delivery) })),
        el('div', { className: 'forge' }, ...forgePills(w.delivery))))
        : [el('div', { className: 'nothemes dim', textContent: "No work theme in the current stage: run /pm-link in the project's repo to see phases, commits and pull requests." })]))),
  ]
}

function attention(p) {
  const blockers = p.blockers.map(b => [b.wp, b.sha, b.text])
  const risks = p.risks.filter(r => isOpen(r.status) && r.score >= 6).sort((a, b) => b.score - a.score)
  const lines = [
    ...blockers.map(([wp, sha, text]) => el('div', { className: 'err' }, el('span', { className: 'mono', textContent: wp + ' ' + sha + ' ' }), text)),
    ...risks.map(r => el('div', { className: 'err', textContent: r.id + ' [' + r.score + '] ' + r.title })),
    p.nextReport.isOverdue ? el('div', { className: 'err', textContent: 'Highlight report overdue since ' + p.nextReport.due }) : null,
    ...overLimit(p).map(m => el('div', { className: 'err', textContent: wipText(m) })),
  ].filter(Boolean)
  return lines.length ? lines : [el('p', { className: 'dim', textContent: 'Nothing.' })]
}

function card(key, value, sub, className = '') {
  return el('div', { className: 'card' }, el('div', { className: 'k', textContent: key }), el('div', { className: 'v ' + className }, value), el('div', { className: 's', textContent: sub }))
}

function recap(p) {
  return [
    el('div', { className: 'cards' },
      card('Stage', p.stage.current === null ? '—' : p.stage.current + (p.stage.name ? ' · ' + p.stage.name : ''), (p.stage.start || '—') + ' → ' + (p.stage.plannedEnd || '—')),
      card('Work packages', bar(p.progress.done, p.progress.total), p.themes.length + ' work themes active'),
      card('Blockers', String(p.openBlockers), 'open blocker notes', p.openBlockers ? 'err' : ''),
      card('Next report', p.nextReport.due || '—', p.nextReport.isOverdue ? 'overdue' : 'highlight report', p.nextReport.isOverdue ? 'err' : '')),
    el('div', { className: 'grid2' },
      el('div', {}, el('h3', { textContent: 'Tolerances' }), tableOf(['', 'Area', 'Used / limit'], p.tolerances.map(t => [dot(t.light), t.area, t.used + ' / ' + t.limit + ' ' + t.unit]))),
      el('div', {}, el('h3', { textContent: 'Needs attention' }), ...attention(p))),
    el('h3', { textContent: 'Work themes' }),
    tableOf(['', 'Theme', 'Phases', 'Forge'], p.themes.map(w => [link(w.id, p.path + '/theme/' + w.id, 'mono'), w.title,
      el('span', {}, phaseBar(w.delivery), el('span', { className: 'dim', textContent: w.delivery.summary.current })), el('span', { className: 'forge' }, ...forgePills(w.delivery))])),
    ...(p.unthemedNotes.length ? [el('h3', { textContent: 'Notes without a work theme' }), ...p.unthemedNotes.map(shaNote)] : []),
  ]
}

function themePanel(p, w) {
  const d = w.delivery
  const f = d.forge
  const isClosed = w.status === 'completed' || w.status === 'cancelled'
  return [
    el('p', {}, el('strong', { textContent: w.id + ' ' + w.title }), ' ',
      el('span', { className: 'dim', textContent: [w.status, d.issue === null ? '' : '#' + d.issue, d.milestone && 'milestone ' + d.milestone, d.ref || d.branch, d.base && 'over ' + d.base].filter(Boolean).join(' · ') })),
    el('div', { className: 'forge' }, ...forgePills(d)),
    el('div', { className: 'grid2' },
      el('div', {}, el('h3', { textContent: 'Phases' }), d.phases.length
        ? tableOf(['', 'Phase', 'State'], d.phases.map(ph => [String(ph.number), ph.title, el('span', { className: ph.state === 'done' ? 'ok' : ph.state === 'failed' ? 'err' : ph.state === 'in-progress' ? '' : 'dim', textContent: ph.state })]))
        : el('p', { className: 'dim', textContent: d.ref ? 'No phased plan on the branch.' : 'No branch linked.' })),
      el('div', {}, el('h3', { textContent: 'Issue and pull requests' }),
        f && f.issue ? el('p', { textContent: '#' + f.issue.number + ' · ' + f.issue.state + ' · ' + f.issue.title }) : null,
        f && f.milestone ? el('p', { textContent: f.milestone.title + ' ' + f.milestone.closed + '/' + (f.milestone.open + f.milestone.closed) + (f.milestone.due ? ' · due ' + f.milestone.due : '') }) : null,
        tableOf(['PR', 'State', 'Title'], (f ? f.pulls : []).map(pr => [el('a', { href: pr.url, textContent: '#' + pr.number }), pill(pr.state, pr.state), pr.title])))),
    el('h3', { textContent: 'Commits and notes' }),
    tableOf(['Commit', 'Date', 'Subject and notes'], d.commits.map(c => [el('span', { className: 'mono', textContent: c.short }), c.date, el('div', {}, c.subject, ...c.notes.map(noteLine))])),
    ...(d.unlinkedNotes.length ? [el('p', { className: 'dim', textContent: isClosed ? 'Branch not read: the work package is closed' : 'Notes on commits not on the branch' }), ...d.unlinkedNotes.map(shaNote)] : []),
  ]
}

const wpLink = (p, w) => w.delivery ? link([w.delivery.issue === null ? '' : '#' + w.delivery.issue, w.delivery.milestone, w.delivery.branch].filter(Boolean).join(' · ') || 'theme', p.path + '/theme/' + w.id) : el('span', { className: 'dim', textContent: '—' })

const STATUS_LABEL = { review: 'review asked', inprogress: 'in progress', todo: 'to do', waiting: 'waiting for review', stalled: 'stalled' }
// Member filter of the Team tab: page-local, everyone shown when none is picked; another project starts unfiltered.
const picked = new Set()
let pickedFor = ''
function team(p) {
  if (pickedFor !== p.path) { picked.clear(); pickedFor = p.path }
  const shown = picked.size ? p.team.filter(m => picked.has(m.person)) : p.team
  const toggle = name => { picked.has(name) ? picked.delete(name) : picked.add(name); draw() }
  return el('div', {},
    el('div', { className: 'members' }, el('span', { className: 'label', textContent: 'Members' }),
      ...p.team.map(m => el('button', { className: 'member-chip' + (picked.has(m.person) ? ' sel' : ''), onclick: () => toggle(m.person) }, m.person)),
      picked.size ? el('a', { href: '#', textContent: 'all', onclick: e => { e.preventDefault(); picked.clear(); draw() } }) : null),
    ...shown.map(m => el('div', { className: 'person' + (m.isOverLimit ? ' over' : '') },
      el('div', { className: 'person-head' },
        el('div', { className: 'who' }, el('strong', { textContent: m.person }), el('small', { textContent: (m.login ? '@' + m.login : 'no forge login') + ' · ' + m.roles.join(', ') })),
        m.login ? pill('WIP ' + m.wip + '/' + m.wipLimit, m.isOverLimit ? 'wip-over' : '') : el('span', { className: 'dim', textContent: 'add team.people in project.yaml' })),
      !m.login ? null : m.items.length
        ? el('table', {}, el('tbody', {}, ...m.items.map(i => el('tr', {},
            el('td', { style: 'width:80px; white-space:nowrap' }, el('a', { href: i.url, className: 'mono', textContent: (i.kind === 'pr' ? 'PR #' : '#') + i.number })),
            el('td', { textContent: i.title }),
            el('td', { className: 'dim', style: 'width:100px; white-space:nowrap', textContent: i.updatedAt }),
            el('td', { style: 'width:150px; text-align:right' }, pill(STATUS_LABEL[i.status], i.status))))))
        : el('div', { className: 'empty dim', textContent: 'No open item.' }))))
}

// One entry per tab: [id, label, count(p), render(p)].
// Risks and issues list every entry, the open ones first; a closed one is dimmed.
const openFirst = rows => rows.filter(r => isOpen(r.status)).concat(rows.filter(r => !isOpen(r.status)))
const dimUnlessOpen = (status, cells) => isOpen(status) ? cells : cells.map(c => el('span', { className: 'dim' }, c))
const TABS = [
  ['roles', 'Roles', p => p.roles.length, p => tableOf(['Role', 'People'], p.roles.map(r => [r.label, r.people.join(', ') || '—']))],
  ['team', 'Team', p => p.team.length, team],
  ['documents', 'Documents', p => p.documents.length, p => tableOf(['Document', 'Status', 'Version'], p.documents.map(d => [fileLink(d.path, d.title), d.status, d.version]))],
  ['wps', 'Work packages', p => p.workPackages.length, p => tableOf(['', 'Title', 'Stage', 'Status', 'Team manager', 'Due', 'Link'],
    p.workPackages.map(w => [fileLink(w.path, w.id), w.title, w.stage === null ? '' : String(w.stage), w.status, w.teamManager, w.due, wpLink(p, w)]))],
  ['risks', 'Risks', p => p.risks.filter(r => isOpen(r.status)).length, p => tableOf(['', 'Risk', 'P × I', 'Status'], openFirst(p.risks).map(r => dimUnlessOpen(r.status, [r.id, r.title, r.probability + ' × ' + r.impact + ' = ' + r.score, r.status])))],
  ['issues', 'Issues', p => p.issues.filter(i => isOpen(i.status)).length, p => tableOf(['', 'Issue', 'Type', 'Priority', 'Status'], openFirst(p.issues).map(i => dimUnlessOpen(i.status, [i.id, i.title, i.type, i.priority, i.status])))],
  ['approvals', 'Approvals', p => p.approvals.length, p => tableOf(['Date', 'Decision', 'By', 'Note'], p.approvals.map(a => [a.date, a.decision, a.by, a.note]))],
]

function form(p, sub) {
  const cut = sub.indexOf('/')
  const kind = cut < 0 ? sub : sub.slice(0, cut)
  const key = cut < 0 ? '' : sub.slice(cut + 1)
  const theme = kind === 'theme' ? p.workPackages.find(w => w.id === key && w.delivery) : null
  const tab = kind === 'tab' ? TABS.find(t => t[0] === key) : null
  const body = theme ? themePanel(p, theme) : tab ? [tab[3](p)] : recap(p)
  return [
    el('div', { className: 'crumb' }, link('← All projects', '')),
    el('div', { className: 'form-head' },
      el('div', {}, el('h2', {}, dot(p.light), ' ', p.name, ' ', el('span', { className: 'dim', textContent: p.code })),
        el('div', { className: 'dim' }, stageOf(p) + ' · ' + (p.status || 'no status') + ' · profile ' + p.profile + ' · ', fileLink(p.path, p.path))),
      el('div', {}, sessionLink(p))),
    ...p.errors.map(e => el('p', { className: 'err', textContent: e })),
    el('div', { className: 'themebar' }, el('span', { className: 'label', textContent: 'Work themes' }),
      ...(p.themes.length ? p.themes.map(w => el('button', { className: 'theme-chip' + (theme && theme.id === w.id ? ' sel' : ''), onclick: () => go(p.path + '/theme/' + w.id) },
        el('span', { className: 'mono', textContent: w.id + ' ' }), w.title,
        el('small', {}, phaseBar(w.delivery), w.delivery.summary.total ? w.delivery.summary.done + '/' + w.delivery.summary.total : '')))
        : [el('span', { className: 'dim', textContent: "none in the current stage: run /pm-link in the project's repo" })])),
    el('div', { className: 'tabs' },
      el('button', { className: 'tab' + (!theme && !tab ? ' sel' : ''), textContent: 'Recap', onclick: () => go(p.path) }),
      ...TABS.map(t => el('button', { className: 'tab' + (tab === t ? ' sel' : ''), onclick: () => go(p.path + '/tab/' + t[0]) }, t[1], el('span', { className: 'n', textContent: t[2](p) })))),
    el('div', { className: 'panel' }, ...body),
  ]
}

function draw() {
  const p = data.projects.filter(x => route === x.path || route.startsWith(x.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
  document.getElementById('app').replaceChildren(...(p ? form(p, route.slice(p.path.length + 1)) : overview()))
}

draw()
setInterval(() => location.reload(), data.reloadMs)
`
