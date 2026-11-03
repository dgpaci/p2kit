import { getSessionLink } from './actions'
import type { Project } from '../types'

// The page reloads itself to pick up the file the next refresh writes.
const RELOAD_MS = 60 * 1000

export type BoardInput = { projects: Project[]; refreshedAt: number; errors: string[] }

// JSON inside a <script> element: nothing in it may close the element.
const embed = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c')

/** The whole desk as one self-contained HTML page: the overview, and a project's detail on click. */
export function renderBoard(input: BoardInput): string {
  const data = {
    projects: input.projects.map(project => ({ ...project, sessionLink: getSessionLink(project) })),
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
<header><h1>Project desk</h1><p class="dim" id="summary"></p><div id="errors"></div></header>
<table id="overview">
  <thead><tr><th></th><th>Project</th><th>Stage</th><th>Progress</th><th>High risks</th><th>Open issues</th><th>Next report</th><th></th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<section id="detail" hidden></section>
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
h2 { font-size: 16px; margin: 0 0 4px; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin: 16px 0 6px; }
.dim { color: var(--dim); }
.err { color: var(--red); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 500; }
#overview tbody tr { cursor: pointer; }
#overview tbody tr:hover, #overview tbody tr.sel { background: var(--chip); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.bar { display: inline-block; width: 80px; height: 6px; border-radius: 3px; background: var(--line); vertical-align: middle; margin-right: 6px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--on); }
.overdue { color: var(--red); }
a { color: var(--on); text-decoration: none; }
a:hover { text-decoration: underline; }
#detail { margin-top: 20px; padding-top: 4px; border-top: 2px solid var(--line); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 24px; }
#detail td:first-child { white-space: nowrap; }
.mono { font-family: ui-monospace, monospace; }
button { border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 999px; padding: 3px 10px; font: inherit; cursor: pointer; }
@media (max-width: 720px) { thead { display: none; } tr { display: block; border-bottom: 1px solid var(--line); padding: 6px 0; }
  td { display: inline-block; border: 0; padding: 2px 6px; } }
`

// The selected project lives in the URL hash so a reload keeps it.
const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent)
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node }
const dot = light => el('span', { className: 'dot', title: 'tolerances: ' + light, style: 'background: var(--' + light + ')' })
const fileLink = (path, label) => el('a', { href: 'file://' + encodeURI(path), textContent: label })
let selected = decodeURIComponent(location.hash.slice(1))

function select(path) {
  selected = selected === path ? '' : path
  history.replaceState(null, '', selected ? '#' + encodeURIComponent(selected) : location.pathname)
  draw()
}

function progress(p) {
  const pct = p.total ? Math.round(100 * p.done / p.total) : 0
  return el('span', {}, el('span', { className: 'bar' }, el('i', { style: 'width:' + pct + '%' })), p.done + '/' + p.total)
}

function section(title, ...children) { return el('div', {}, el('h3', { textContent: title }), ...children) }
function table(head, rows) {
  if (rows.length === 0) return el('p', { className: 'dim', textContent: 'None.' })
  return el('table', {}, el('thead', {}, el('tr', {}, ...head.map(h => el('th', { textContent: h })))),
    el('tbody', {}, ...rows.map(cells => el('tr', {}, ...cells.map(c => el('td', {}, c))))))
}

function detail(p) {
  const stage = p.stage.current === null ? 'no stage' : 'Stage ' + p.stage.current + (p.stage.name ? ' — ' + p.stage.name : '')
  return [
    el('h2', { textContent: p.name + (p.code ? ' (' + p.code + ')' : '') }),
    el('p', { className: 'dim' }, stage + ' · ' + (p.status || 'no status') + ' · profile ' + p.profile + ' · ',
      fileLink(p.path, p.path), ' · ', el('a', { href: p.sessionLink, textContent: 'Open session' })),
    ...p.errors.map(e => el('p', { className: 'err', textContent: e })),
    el('div', { className: 'grid' },
      section('Roles', table(['Role', 'People'], p.roles.map(r => [r.label, r.people.join(', ') || '—']))),
      section('Tolerances', table(['', 'Area', 'Used / limit'], p.tolerances.map(t => [dot(t.light), t.area, t.used + ' / ' + t.limit + ' ' + t.unit]))),
    ),
    section('Documents', table(['Document', 'Status', 'Version'], p.documents.map(d => [fileLink(d.path, d.title), d.status, d.version]))),
    section('Work packages', table(['', 'Title', 'Stage', 'Status', 'Team manager', 'Due'],
      p.workPackages.map(w => [fileLink(w.path, w.id), w.title, w.stage ?? '', w.status, w.teamManager, w.due]))),
    el('div', { className: 'grid' },
      section('Risks', table(['', 'Risk', 'P × I', 'Status'], p.risks.map(r => [r.id, r.title, r.probability + ' × ' + r.impact + ' = ' + r.score, r.status]))),
      section('Issues', table(['', 'Issue', 'Type', 'Priority', 'Status'], p.issues.map(i => [i.id, i.title, i.type, i.priority, i.status]))),
    ),
    section('Board approvals', table(['Date', 'Decision', 'By', 'Note'], p.approvals.map(a => [a.date, a.decision, a.by, a.note]))),
  ]
}

function draw() {
  document.getElementById('summary').textContent = data.projects.length + ' projects · updated ' + new Date(data.refreshedAt).toLocaleString()
  document.getElementById('errors').replaceChildren(...data.errors.map(e => el('p', { className: 'err', textContent: e })))
  document.getElementById('rows').replaceChildren(...data.projects.map(p => {
    const row = el('tr', { className: p.path === selected ? 'sel' : '', onclick: () => select(p.path) },
      el('td', {}, dot(p.light)),
      el('td', {}, el('strong', { textContent: p.name }), el('div', { className: 'dim', textContent: p.code })),
      el('td', { textContent: p.stage.current === null ? '—' : p.stage.current + ' ' + p.stage.name }),
      el('td', {}, progress(p.progress)),
      el('td', { className: p.highRisks ? 'overdue' : '', textContent: p.highRisks }),
      el('td', { textContent: p.openIssues }),
      el('td', { className: p.nextReport.isOverdue ? 'overdue' : '', textContent: (p.nextReport.due || '—') + (p.nextReport.isOverdue ? ' overdue' : '') }),
      el('td', {}, p.errors.length ? el('span', { className: 'err', textContent: '⚠ ' + p.errors.length }) : ''),
    )
    return row
  }))
  const chosen = data.projects.find(p => p.path === selected)
  const box = document.getElementById('detail')
  box.hidden = !chosen
  box.replaceChildren(...(chosen ? detail(chosen) : []))
}

draw()
setInterval(() => location.reload(), data.reloadMs)
`
