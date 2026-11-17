import { getLinkBase, getPackageLink, getSessionLink } from './actions'
import { getMilestonePackage } from './milestones'
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

/** Per open milestone title, its work package `{ id, title }`, or null when none carries it. */
export function getMilestonePackages(project: Project): Record<string, { id: string; title: string } | null> {
  return Object.fromEntries(project.milestones.map(({ title }) => {
    const wp = getMilestonePackage(project.workPackages, title)
    return [title, wp ? { id: wp.id, title: wp.title } : null]
  }))
}

export type BoardInput = { projects: Project[]; refreshedAt: number; errors: string[] }

// JSON inside a <script> element: nothing in it may close the element.
const embed = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c')

/** The whole desk as one self-contained HTML page: the overview of projects and their work themes, and a project's form. */
export function renderBoard(input: BoardInput): string {
  const data = {
    projects: input.projects.map(project => ({
      ...project, sessionLink: getSessionLink(project), themes: getWorkThemes(project), blockers: getOpenBlockers(project),
      packageLink: getPackageLink(project, []), linkBase: getLinkBase(project), milestonePackages: getMilestonePackages(project),
    })),
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
.pill.notready { color: var(--amber); border-color: var(--amber); }
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
.weeks { display: flex; gap: 4px; align-items: stretch; height: 150px; margin-top: 8px; }
.week { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.week .stack { flex: 1; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
.week .stack i { display: block; width: 100%; }
.week i.issues { background: var(--on); } .week i.pulls { background: var(--green); }
.week small { font-size: 10px; color: var(--dim); white-space: nowrap; }
.legend i { display: inline-block; width: 10px; height: 10px; margin: 0 4px 0 10px; vertical-align: middle; }
.legend i.issues { background: var(--on); } .legend i.pulls { background: var(--green); }
a.btn { display: inline-block; border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 999px; padding: 3px 10px; }
a.btn:hover { text-decoration: none; filter: brightness(0.97); }
a.btn-primary { background: var(--on); border-color: var(--on); color: #fff; font-weight: 600; }
/* One line whatever is picked: the bar never grows, so checking an item never moves the list under the pointer. */
.activity-bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 10px; align-items: center; flex-wrap: nowrap; white-space: nowrap; min-height: 42px; padding: 8px 12px; margin: 10px 0 0; border: 1px solid var(--on); border-radius: 8px; background: var(--bg); box-shadow: 0 2px 6px rgba(0,0,0,.08); }
.activity-bar.idle { position: static; border-style: dashed; border-color: var(--line); box-shadow: none; font-size: 13px; overflow: hidden; text-overflow: ellipsis; }
.activity-bar .refs { font-family: ui-monospace, monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.activity-bar .hint { margin-left: auto; font-size: 12px; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 0; text-align: right; }
.block-title { display: flex; align-items: baseline; gap: 8px; margin: 22px 0 4px; }
.block-title h3 { margin: 0; }
.block-title .n { font-size: 12px; color: var(--dim); }
/* Fixed layout: the ref, pill and date columns line up across the separate group tables. */
table.rows { table-layout: fixed; }
.sel-col { width: 28px; padding-right: 0 !important; }
.sel-col input { margin: 0; cursor: pointer; }
tr.checked td { background: color-mix(in srgb, var(--on) 8%, transparent); }
.ms-row { display: grid; grid-template-columns: minmax(180px, 1.3fr) 150px 1fr minmax(220px, 1fr); gap: 10px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--line); }
.ms-row:first-child { border-top: 0; }
.ms-row .pills { display: flex; gap: 4px; flex-wrap: wrap; }
.ms-row .wp { text-align: right; }
.wp-link { font-weight: 500; }
.nowp { color: var(--dim); font-style: italic; margin-right: 8px; }
.group-head { padding: 6px 12px; background: var(--chip); font-size: 13px; border-top: 1px solid var(--line); }
.group-head:first-child { border-top: 0; }
button.primary, button.btn-primary { background: var(--on); border-color: var(--on); color: #fff; font-weight: 600; }
.act { font-size: 12px; padding: 1px 8px; margin-left: 6px; }
.place select, .place input { font: inherit; font-size: 12px; margin-left: 6px; }
.place input { width: 52px; }
.dialog { position: fixed; inset: 0; z-index: 10; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding: 60px 16px; }
.dialog-box { background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; width: min(640px, 100%); max-height: calc(100vh - 120px); overflow: auto; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
.dialog-box h3 { text-transform: none; letter-spacing: 0; font-size: 15px; color: var(--fg); margin: 0 0 10px; }
.dialog-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dialog-row { display: flex; gap: 8px; } .dialog-row input { flex: 1; }
.dialog input[type=text], .dialog select { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
.diff { font-family: ui-monospace, monospace; font-size: 12px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.diff .del { color: var(--red); } .diff .add { color: var(--green); }
.warn { color: var(--amber); }
@media (max-width: 720px) {
  .theme-row { grid-template-columns: 18px 1fr; } .theme-row .forge { grid-column: 2; justify-content: flex-start; }
  .theme-row > :nth-child(3) { grid-column: 2; }
  .ms-row { grid-template-columns: 1fr; } .ms-row .wp { text-align: left; }
}
@media (max-width: 480px) { .week small:last-child { display: none; } }
`

// The route lives in the URL hash so the reload keeps it: '' overview · '<path>' recap · '<path>/tab/<id>' · '<path>/theme/<WP-id>'.
const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent)
// A link to the web (forge issues and pull requests) or to a file (documents) opens in a new tab, so the desk stays open.
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); if (tag === 'a' && /^(https?|file):/.test(node.getAttribute('href') || '')) Object.assign(node, { target: '_blank', rel: 'noopener' }); node.append(...children.filter(c => c !== null && c !== undefined && c !== false)); return node }
const dot = light => el('span', { className: 'dot', title: 'tolerances: ' + light, style: 'background: var(--' + light + ')' })
const fileLink = (path, label) => el('a', { href: 'file://' + encodeURI(path), textContent: label })
const sessionLink = p => el('a', { href: p.sessionLink, textContent: 'Open session', onclick: e => e.stopPropagation() })
const bar = (done, total) => el('span', {}, el('span', { className: 'bar' }, el('i', { style: 'width:' + (total ? Math.round(100 * done / total) : 0) + '%' })), done + '/' + total)
// The milestone's items closed over all of them, from its item list when read, else from its counts; null without a milestone.
const itemProgress = f => f && f.milestoneItems && f.milestoneItems.length ? { done: f.milestoneItems.filter(i => i.state !== 'open').length, total: f.milestoneItems.length }
  : f && f.milestone ? { done: f.milestone.closed, total: f.milestone.open + f.milestone.closed } : null
// The phases of the plan, one square each; with no plan, the milestone's closed items over all of them; else "no plan".
const phaseBar = d => {
  if (d.phases.length) return el('span', { className: 'phases', title: d.summary.current }, ...d.phases.map(ph => el('i', { className: ph.state, title: 'Phase ' + ph.number + ': ' + ph.title + ' · ' + ph.state })))
  const items = itemProgress(d.forge)
  return items ? el('span', { title: 'milestone items closed' }, bar(items.done, items.total), el('span', { className: 'dim', textContent: ' closed' })) : el('span', { className: 'dim', textContent: 'no plan' })
}
// A continuous stage has no end and no percentage: open and completed work packages, and the day it started.
const progressOf = p => p.stage.isContinuous ? el('span', { textContent: (p.progress.total - p.progress.done) + ' open · ' + p.progress.done + ' completed' }) : bar(p.progress.done, p.progress.total)
const stageSpan = p => p.stage.isContinuous ? 'since ' + (p.stage.start || '—') + ' · continuous' : (p.stage.start || '—') + ' → ' + (p.stage.plannedEnd || '—')
const pill = (text, cls = '') => el('span', { className: 'pill ' + cls, textContent: text })
// A completed work theme stays in view until archived: it says so.
const completedPill = w => w.status === 'completed' ? el('span', {}, ' ', pill('completed', 'ready')) : null
const stageOf = p => p.stage.current === null ? 'no stage' : 'stage ' + p.stage.current + (p.stage.name ? ' ' + p.stage.name : '')
const isOpen = s => s === 'open'
// WIP: one red badge per person over the limit, in the card head and in the recap's "Needs attention".
const overLimit = p => p.team.filter(m => m.isOverLimit)
const wipText = m => 'WIP ' + m.person + ' ' + m.wip + '/' + m.wipLimit
const wipBadges = p => overLimit(p).map(m => pill(wipText(m), 'wip-over'))
// Effort in hours: the deviation signed ("+4h", "0h", "-3h"); '' when a figure is missing.
const signed = n => (n > 0 ? '+' : '') + n + 'h'
const hours = n => n === null ? '' : n + 'h'
const effortRed = p => p.tolerances.some(t => t.area === 'effort' && t.light === 'red')
const effortFact = p => el('span', { className: effortRed(p) ? 'err' : '', textContent: 'effort ' + p.effort.actual + '/' + p.effort.estimate + 'h ' + signed(p.effort.deviation) })
const stageEffort = e => 'Stage ' + e.stage + ' effort: ' + e.actual + 'h of ' + e.estimate + 'h, deviation ' + signed(e.deviation) + ' over ' + e.counted + ' work packages'
// The open iteration: "iteration <n> · <done>/<planned> WPs · ends <end>", red and " overdue" past its end.
const iterationFact = it => el('span', { className: it.isOverdue ? 'err' : '', textContent: 'iteration ' + it.number + ' · ' + it.done + '/' + it.planned + ' WPs · ends ' + (it.end || '—') + (it.isOverdue ? ' overdue' : '') })
// Readiness: an open issue lacking a heading of project.yaml readiness.headings carries a notready pill naming what is missing.
const missingOf = (p, number) => (p.forgeIssues.find(i => i.number === number) || {}).missing || []
const notReadyPill = missing => missing.length ? Object.assign(pill('notready', 'notready'), { title: 'missing: ' + missing.join(', ') }) : null

// Desk actions. Served by the desk helper (server/desk_server.py), the page carries its token: every action is previewed, then
// applied on Confirm only while its file is still as previewed. Opened from disk the page cannot write: an action becomes the
// link to a session with its skill, or is not offered. Nothing is committed.
const server = window.P2KIT_SERVER || null
let dialogOpen = false
let current = null
const skillLink = (p, skill, args) => p.linkBase + encodeURIComponent('[p2kit] Use the p2kit:' + skill + ' skill with: ' + args)
async function post(body) {
  const res = await fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-P2kit-Token': server.token }, body: JSON.stringify(body) })
  const answer = await res.json().catch(() => ({ error: 'HTTP ' + res.status }))
  if (!res.ok) throw new Error(answer.error || 'HTTP ' + res.status)
  return answer
}
const snapshotTime = () => fetch('/desk.json', { cache: 'no-store' }).then(r => r.json()).then(s => s.refreshedAt).catch(() => '')
function closeDialog() {
  const open = document.getElementById('dialog')
  if (open) open.remove()
  dialogOpen = false
  draw()
}
function openDialog(title, ...content) {
  const open = document.getElementById('dialog')
  if (open) open.remove()
  dialogOpen = true
  const box = el('div', { className: 'dialog-box' }, el('h3', { textContent: title }), ...content)
  const back = el('div', { className: 'dialog', id: 'dialog' }, box)
  back.onclick = e => { if (e.target === back) closeDialog() }
  document.body.append(back)
  return box
}
// replaceChildren with el's rule: null, undefined and false are left out.
const fill = (box, ...children) => box.replaceChildren(...children.filter(c => c !== null && c !== undefined && c !== false))
const buttons = (...list) => el('div', { className: 'dialog-buttons' }, ...list)
const closeButton = (label = 'Close') => el('button', { textContent: label, onclick: closeDialog })
const failed = (box, title, error) => fill(box, el('h3', { textContent: title }), el('p', { className: 'err', textContent: error.message }), buttons(closeButton()))
// An action button with the helper; without it, the session link of its skill when there is one.
function actionButton(label, run, fallback) {
  if (server) return el('button', { className: 'act', textContent: label, onclick: e => { e.stopPropagation(); run() } })
  return fallback ? el('a', { className: 'btn act', href: fallback, textContent: label, title: 'opens a Claude session: the desk helper is not running', onclick: e => e.stopPropagation() }) : null
}
// What an action will change: the line before and after, or the plan of a package with the items to move picked here.
function previewOf(preview, extra) {
  if (preview.kind !== 'package') return [el('p', { className: 'dim mono', textContent: preview.file }),
    ...preview.changes.map(c => el('div', { className: 'diff' }, el('div', { className: 'dim', textContent: 'line ' + c.line }),
      c.before ? el('div', { className: 'del', textContent: '- ' + c.before }) : null, c.after ? el('div', { className: 'add', textContent: '+ ' + c.after }) : null))]
  const m = preview.milestone
  extra.move = []
  const item = i => el('div', { textContent: i.ref + ' ' + i.title })
  return [
    el('p', { className: 'dim', textContent: 'On ' + preview.forge }),
    el('p', {}, el('strong', { textContent: (m.action === 'create' ? 'Create' : 'Reuse') + ' milestone ' }), m.title, m.closed ? el('span', { className: 'warn', textContent: ' (closed)' }) : null),
    preview.assign.length ? el('div', {}, el('h3', { textContent: 'Assign to it' }), ...preview.assign.map(item)) : null,
    preview.others.length ? el('div', {}, el('h3', { textContent: 'In another milestone: tick to move' }), ...preview.others.map(i => el('label', { style: 'display:block' },
      el('input', { type: 'checkbox', onchange: e => { e.target.checked ? extra.move.push(i.ref) : extra.move.splice(extra.move.indexOf(i.ref), 1) } }), ' ' + i.ref + ' ' + i.title + ' · ' + i.milestone))) : null,
    preview.skipped.length ? el('div', {}, el('h3', { textContent: 'Left out' }), ...preview.skipped.map(i => el('div', { className: 'dim', textContent: i.ref + ' · ' + i.reason }))) : null,
    el('h3', { textContent: 'Work package' }),
    preview.wp.action === 'create' ? el('div', {}, el('p', { className: 'dim mono', textContent: preview.wp.file }), el('div', { className: 'diff add', textContent: preview.wp.text }))
      : el('p', { textContent: preview.wp.id + ' already carries the milestone: nothing written' }),
  ]
}
// Preview, then Confirm: the helper applies it only if the preview, computed again, is the same; then the desk is read again.
async function act(p, request, note) {
  const box = openDialog('Preview', el('p', { className: 'dim', textContent: 'Reading…' }))
  const extra = {}
  let answer
  try { answer = await post(Object.assign({ project: p.path }, request)) } catch (error) { return failed(box, 'Not possible', error) }
  fill(box, el('h3', { textContent: answer.preview.summary }), note ? el('p', { className: 'warn', textContent: note }) : null, ...previewOf(answer.preview, extra),
    buttons(closeButton('Cancel'), el('button', { className: 'primary', textContent: 'Confirm', onclick: () => apply(p, request, answer.hash, extra, box) })))
}
async function apply(p, request, hash, extra, box) {
  fill(box, el('p', { className: 'dim', textContent: 'Writing…' }))
  const before = await snapshotTime()
  let result
  try { result = await post(Object.assign({ project: p.path }, request, extra, { confirm: hash })) } catch (error) { return failed(box, 'Not applied', error) }
  fill(box, el('h3', { textContent: result.summary }), el('p', { className: 'ok', textContent: 'Done: ' + result.done.join(', ') }),
    el('p', { className: 'dim', textContent: 'Nothing is committed. Reading the desk again…' }))
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const now = await snapshotTime()
    if (now && now !== before) return location.reload()
  }
  box.append(el('p', { className: 'dim', textContent: 'The desk is not read again yet: reload the page later.' }), buttons(closeButton()))
}
// Archive a completed work package; completing one is the Board's decision, which the PM confirms.
function statusAction(p, w) {
  if (w.status === 'completed') return actionButton('Archive', () => act(p, { kind: 'wp-status', target: w.id, value: 'archived' }), skillLink(p, 'pm-archive', w.id))
  if (w.status === 'in-progress' || w.status === 'authorized') return actionButton('Mark completed', () => act(p, { kind: 'wp-status', target: w.id, value: 'completed' },
    'Completing a work package is a decision of the Project Board: confirm only if the Board has taken it.'), null)
  return null
}
function linkAction(p, w) {
  return actionButton('Link…', () => {
    const field = el('select', {}, ...['issue', 'milestone', 'branch'].map(f => el('option', { value: f, textContent: f })))
    const value = el('input', { type: 'text', placeholder: '498, a milestone title or a branch' })
    const preview = () => act(p, { kind: 'wp-link', target: w.id, field: field.value, value: field.value === 'issue' ? Number(value.value.replace('#', '')) : value.value.trim() })
    value.onkeydown = e => { if (e.key === 'Enter') preview() }
    openDialog('Link ' + w.id + ' ' + w.title, el('div', { className: 'dialog-row' }, field, value), buttons(closeButton('Cancel'), el('button', { className: 'primary', textContent: 'Preview', onclick: preview })))
    value.focus()
  }, skillLink(p, 'pm-link', w.id))
}
function noteAction(n) {
  const p = current
  if (!p) return null
  const value = n.status === 'open' ? 'closed' : 'open'
  return actionButton(value === 'closed' ? 'Close' : 'Reopen', () => act(p, { kind: 'note-status', target: { sha: n.sha, text: n.text }, value }),
    skillLink(p, 'pm-note', (value === 'closed' ? 'close' : 'reopen') + ' the note on ' + n.sha + ': ' + n.text))
}
// Horizon and rank of a work package, each change previewed; only with the helper.
function placeControls(p, w) {
  if (!server) return null
  const horizon = el('select', { title: 'horizon', onchange: () => act(p, { kind: 'wp-horizon', target: w.id, value: horizon.value }) },
    ...[['', '—'], ['now', 'Now'], ['next', 'Next'], ['later', 'Later']].map(([v, l]) => el('option', { value: v, textContent: l, selected: w.horizon === v })))
  const rank = el('input', { type: 'number', min: 1, title: 'rank', value: w.rank === null ? '' : String(w.rank),
    onchange: () => act(p, { kind: 'wp-rank', target: w.id, value: rank.value === '' ? '' : Number(rank.value) }) })
  return el('span', { className: 'place' }, horizon, rank)
}
function packageDialog(p, refs) {
  const title = el('input', { type: 'text', placeholder: 'one to three words' })
  const preview = () => title.value.trim() && act(p, { kind: 'package', refs, title: title.value.trim() })
  title.onkeydown = e => { if (e.key === 'Enter') preview() }
  openDialog('Package ' + refs.join(' '), el('p', { className: 'dim', textContent: 'The title names the milestone and the work package.' }), el('div', { className: 'dialog-row' }, title),
    buttons(closeButton('Cancel'), el('button', { className: 'primary', textContent: 'Preview', onclick: preview })))
  title.focus()
}

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
  return el('div', { className: 'note ' + (open ? 'err' : 'dim') }, n.kind + ' · ' + n.status + ' · ' + n.text + (n.date ? ' (' + n.date + ')' : ''), noteAction(n))
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
            el('span', {}, 'WPs ', progressOf(p)),
            p.iteration ? iterationFact(p.iteration) : null,
            p.effort ? effortFact(p) : null,
            el('span', { className: p.highRisks ? 'err' : '', textContent: 'high risks ' + p.highRisks }),
            el('span', { className: p.openBlockers ? 'err' : '', textContent: 'blockers ' + p.openBlockers }),
            el('span', { textContent: 'open issues ' + p.openIssues }),
            el('span', { className: p.nextReport.isOverdue ? 'err' : '', textContent: 'next report ' + (p.nextReport.due || '—') + (p.nextReport.isOverdue ? ' overdue' : '') }),
            el('span', { textContent: 'last retro ' + (p.lastRetro || '—') }),
            p.errors.length ? el('span', { className: 'err', textContent: '⚠ ' + p.errors.length + ' errors' }) : null,
            p.notReady ? pill('notready ' + p.notReady, 'notready') : null,
            ...wipBadges(p))),
        el('span', {}, sessionLink(p))),
      ...(p.themes.length ? p.themes.map(w => el('div', { className: 'theme-row', onclick: () => go(p.path + '/theme/' + w.id) },
        el('span', { className: 'tree', textContent: '└' }),
        el('div', {}, el('span', { className: 'mono', textContent: w.id + ' ' }), w.title, completedPill(w)),
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
    p.iteration && p.iteration.isOverdue ? el('div', { className: 'err', textContent: 'Iteration ' + p.iteration.number + ' past its end (' + p.iteration.end + ')' }) : null,
    ...openActions(p).map(a => el('div', { textContent: actionText(a) })),
    ...logOf(p).filter(d => d.isOverdue).map(d => el('div', { className: 'err', textContent: d.id + ' ' + d.text + (d.owner ? ' · ' + d.owner : '') + ' · due ' + d.due })),
    ...overLimit(p).map(m => el('div', { className: 'err', textContent: wipText(m) })),
    p.notReady ? el('div', { textContent: p.notReady + ' issues not ready' }) : null,
  ].filter(Boolean)
  return lines.length ? lines : [el('p', { className: 'dim', textContent: 'Nothing.' })]
}

function card(key, value, sub, className = '') {
  return el('div', { className: 'card' }, el('div', { className: 'k', textContent: key }), el('div', { className: 'v ' + className }, value), el('div', { className: 's', textContent: sub }))
}

function recap(p) {
  return [
    el('div', { className: 'cards' },
      card('Stage', p.stage.current === null ? '—' : p.stage.current + (p.stage.name ? ' · ' + p.stage.name : ''), stageSpan(p)),
      card('Work packages', progressOf(p), p.themes.length + ' work themes active'),
      p.iteration ? card('Iteration', p.iteration.number + ' · ' + p.iteration.done + '/' + p.iteration.planned, p.iteration.goal + ' · ends ' + (p.iteration.end || '—'), p.iteration.isOverdue ? 'err' : '') : null,
      card('Blockers', String(p.openBlockers), 'open blocker notes', p.openBlockers ? 'err' : ''),
      card('Next report', p.nextReport.due || '—', p.nextReport.isOverdue ? 'overdue' : 'highlight report', p.nextReport.isOverdue ? 'err' : '')),
    el('div', { className: 'grid2' },
      el('div', {}, el('h3', { textContent: 'Tolerances' }), tableOf(['', 'Area', 'Used / limit'], p.tolerances.map(t => [dot(t.light), t.area, t.used + ' / ' + t.limit + ' ' + t.unit + (t.isComputed ? ' · from work packages' : '')]))),
      el('div', {}, el('h3', { textContent: 'Needs attention' }), ...attention(p))),
    el('h3', { textContent: 'Work themes' }),
    tableOf(['', 'Theme', 'Progress', 'Forge'], p.themes.map(w => [link(w.id, p.path + '/theme/' + w.id, 'mono'), el('span', {}, w.title, completedPill(w)),
      el('span', {}, phaseBar(w.delivery), el('span', { className: 'dim', textContent: w.delivery.summary.current })), el('span', { className: 'forge' }, ...forgePills(w.delivery))])),
    ...(p.unthemedNotes.length ? [el('h3', { textContent: 'Notes without a work theme' }), ...p.unthemedNotes.map(shaNote)] : []),
  ]
}

// The items of a work package's milestone: what is still open first, said in words, then every issue and pull request.
const ITEM_STATE = { open: '', closed: 'dim', merged: 'ok' }
function milestoneItems(items) {
  const open = items.filter(i => i.state === 'open')
  const name = i => (i.kind === 'pr' ? 'PR ' : '') + '#' + i.number
  return [
    el('p', {}, el('strong', { textContent: (items.length - open.length) + ' of ' + items.length + ' closed' }), open.length
      ? el('span', {}, ' · still open: ', ...open.flatMap((i, n) => [n ? ', ' : '', el('a', { href: i.url, textContent: name(i) }), ' ' + i.title]))
      : el('span', { className: 'dim', textContent: ' · nothing left open' })),
    tableOf(['Item', 'State', 'Title'], items.map(i => [el('a', { href: i.url, textContent: name(i) }), el('span', { className: ITEM_STATE[i.state], textContent: i.state }), i.title])),
  ]
}

// Each phase of the plan with what it adds: the plan's Done summary once the phase closed, else its Done criterion.
const PHASE_CLASS = { done: 'ok', failed: 'err', 'in-progress': '' }
function phaseTable(d) {
  if (!d.phases.length) return el('p', { className: 'dim', textContent: d.ref ? 'No phased plan on the branch.' : d.branch ? 'Branch not read.' : 'No branch linked.' })
  return el('div', {},
    d.objective ? el('p', { textContent: d.objective }) : null,
    tableOf(['', 'Phase', 'What it adds', 'State'], d.phases.map(ph => [String(ph.number), el('strong', { textContent: ph.title }),
      el('span', { className: ph.outcome ? '' : 'dim', textContent: ph.outcome || '—' }),
      el('span', { className: ph.state in PHASE_CLASS ? PHASE_CLASS[ph.state] : 'dim', textContent: ph.state })])))
}

function themePanel(p, w) {
  const d = w.delivery
  const f = d.forge
  const noted = d.commits.filter(c => c.notes.length)
  return [
    el('p', {}, el('strong', { textContent: w.id + ' ' + w.title }), ' ',
      el('span', { className: 'dim', textContent: [w.status, d.issue === null ? '' : '#' + d.issue, d.milestone && 'milestone ' + d.milestone, d.ref || d.branch, d.base && 'over ' + d.base].filter(Boolean).join(' · ') }), statusAction(p, w)),
    el('div', { className: 'forge' }, ...forgePills(d)),
    el('h3', { textContent: 'Phases' }),
    phaseTable(d),
    el('div', {}, el('h3', { textContent: 'Issue and pull requests' }),
        f && f.issue ? el('p', { textContent: '#' + f.issue.number + ' · ' + f.issue.state + ' · ' + f.issue.title }) : null,
        f && f.milestone ? el('p', { textContent: f.milestone.title + ' ' + f.milestone.closed + '/' + (f.milestone.open + f.milestone.closed) + (f.milestone.due ? ' · due ' + f.milestone.due : '') }) : null,
        ...(f && f.milestoneItems ? milestoneItems(f.milestoneItems) : []),
        f && f.pulls.length ? tableOf(['PR', 'State', 'Title'], f.pulls.map(pr => [el('a', { href: pr.url, textContent: '#' + pr.number }), pill(pr.state, pr.state), pr.title])) : null),
    // The commits themselves are not listed: only the ones carrying a note, and the notes of commits off the branch.
    ...(noted.length || d.unlinkedNotes.length ? [el('h3', { textContent: 'Notes on commits' })] : []),
    ...(noted.length ? [tableOf(['Commit', 'Date', 'Subject and notes'], noted.map(c => [el('span', { className: 'mono', textContent: c.short }), c.date, el('div', {}, c.subject, ...c.notes.map(noteLine))]))] : []),
    ...(d.unlinkedNotes.length ? [el('p', { className: 'dim', textContent: d.ref ? 'Notes on commits not on the branch' : 'Branch not read' }), ...d.unlinkedNotes.map(shaNote)] : []),
  ]
}

const wpLink = (p, w) => w.delivery ? link([w.delivery.issue === null ? '' : '#' + w.delivery.issue, w.delivery.milestone, w.delivery.branch].filter(Boolean).join(' · ') || 'theme', p.path + '/theme/' + w.id) : linkAction(p, w) || el('span', { className: 'dim', textContent: '—' })

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
            el('td', { style: 'width:150px; text-align:right' }, i.kind === 'issue' ? notReadyPill(missingOf(p, i.number)) : null, ' ', pill(STATUS_LABEL[i.status], i.status))))))
        : el('div', { className: 'empty dim', textContent: 'No open item.' }))))
}

// Activity tab: the open milestones with their work package, the open pull requests, the open issues grouped by milestone.
// The "Not ready only" toggle filters the issues and the picked issues and pull requests are page-local, like the member filter;
// another project starts unfiltered, with nothing picked. The page never writes: Create package only opens a session.
let notReadyOnly = false
const pickedItems = new Map()
let activityFor = ''
// The package link carries the prompt last: the picked references are appended to it (hooks/actions.ts getPackageLink).
const packageLink = (p, refs) => p.packageLink + encodeURIComponent(' ' + refs.join(' '))
const blockTitle = (title, sub) => el('div', { className: 'block-title' }, el('h3', { textContent: title }), el('span', { className: 'n', textContent: sub }))
function activity(p) {
  if (activityFor !== p.path) { notReadyOnly = false; pickedItems.clear(); activityFor = p.path }
  const today = data.refreshedAt.slice(0, 10)
  const pick = (key, ref) => el('td', { className: 'sel-col' }, el('input', { type: 'checkbox', checked: pickedItems.has(key),
    onchange: () => { pickedItems.has(key) ? pickedItems.delete(key) : pickedItems.set(key, ref); draw() } }))
  const rowClass = key => pickedItems.has(key) ? 'checked' : ''
  const refs = [...pickedItems.values()]
  const selectionBar = refs.length
    ? el('div', { className: 'activity-bar' }, el('strong', { textContent: refs.length + ' selected' }), el('span', { className: 'refs', textContent: refs.join(' ') }),
        server ? el('button', { className: 'btn-primary', textContent: 'Create package', onclick: () => packageDialog(p, refs) })
          : el('a', { className: 'btn btn-primary', href: packageLink(p, refs), textContent: 'Create package' }),
        el('a', { href: '#', textContent: 'clear', onclick: e => { e.preventDefault(); pickedItems.clear(); draw() } }),
        el('span', { className: 'dim hint', textContent: server ? 'previews the milestone and the work package, then writes them on Confirm' : 'opens a Claude session on ' + p.name + ' with the pm-package skill: ' + refs.join(' ') }))
    : el('div', { className: 'activity-bar idle dim', textContent: 'Check issues or pull requests to group them into a work package.' })

  const milestoneRow = m => {
    const wp = p.milestonePackages[m.title]
    return el('div', { className: 'ms-row' },
      el('div', {}, el('strong', { textContent: m.title })),
      el('div', {}, bar(m.closed, m.open + m.closed)),
      el('div', { className: 'pills' },
        m.due ? pill('due ' + m.due) : null,
        m.due && m.due < today && m.open > 0 ? pill('overdue', 'red') : null,
        pill('stalled ' + m.stalled, m.stalled ? 'stalled' : ''),
        pill('in review ' + m.inReview, m.inReview ? 'review' : '')),
      el('div', { className: 'wp' }, wp
        ? el('a', { href: '#', className: 'wp-link', onclick: e => { e.preventDefault(); go(p.path + '/theme/' + wp.id) } }, el('span', { className: 'mono', textContent: wp.id + ' ' }), wp.title)
        : el('span', {}, el('span', { className: 'nowp', textContent: 'no work package' }),
            server ? el('button', { textContent: 'Create work package', onclick: () => act(p, { kind: 'package', title: m.title, fromMilestone: true }) })
              : el('a', { className: 'btn', href: packageLink(p, ['--milestone', "'" + m.title + "'"]), textContent: 'Create work package' }))))
  }

  const pullRow = pr => el('tr', { className: rowClass('p' + pr.number) }, pick('p' + pr.number, 'PR #' + pr.number),
    el('td', { style: 'width:80px; white-space:nowrap' }, el('a', { href: pr.url, className: 'mono', textContent: 'PR #' + pr.number })),
    el('td', { textContent: pr.title }),
    el('td', { style: 'width:220px; text-align:right' }, pr.milestone ? pill(pr.milestone) : null, ' ', pr.draft ? pill('draft') : pr.inReview ? pill('in review', 'review') : null),
    el('td', { className: 'dim', style: 'width:100px; white-space:nowrap', textContent: pr.updatedAt }))

  const issueRow = i => el('tr', { className: rowClass('i' + i.number) }, pick('i' + i.number, '#' + i.number),
    el('td', { style: 'width:80px; white-space:nowrap' }, el('a', { href: i.url, className: 'mono', textContent: '#' + i.number })),
    el('td', { textContent: i.title }),
    el('td', { style: 'width:100px; text-align:right' }, notReadyPill(i.missing || [])),
    el('td', { className: 'dim', style: 'width:100px; white-space:nowrap', textContent: i.updatedAt }))

  // Issues by milestone: the open ones in their order, then any other title (closed, or past the one-page read), then "No milestone".
  const shown = notReadyOnly ? p.forgeIssues.filter(i => (i.missing || []).length) : p.forgeIssues
  const openTitles = new Set(p.milestones.map(m => m.title))
  const others = [...new Set(shown.map(i => i.milestone).filter(t => t && !openTitles.has(t)))]
  const groups = [
    ...p.milestones.map(m => [m.title, '', shown.filter(i => i.milestone === m.title)]),
    ...others.map(t => [t, 'closed', shown.filter(i => i.milestone === t)]),
    ['No milestone', '', shown.filter(i => !i.milestone)],
  ].filter(g => g[2].length)
  const notReadyCount = p.forgeIssues.filter(i => (i.missing || []).length).length

  return el('div', {},
    selectionBar,
    blockTitle('Milestones', p.milestones.length + ' open'),
    p.milestones.length ? el('div', { className: 'person' }, ...p.milestones.map(milestoneRow)) : el('div', { className: 'empty dim', textContent: 'No open milestone.' }),
    blockTitle('Pull requests', p.forgePulls.length + ' open'),
    p.forgePulls.length ? el('div', { className: 'person' }, el('table', { className: 'rows' }, el('tbody', {}, ...p.forgePulls.map(pullRow)))) : el('div', { className: 'empty dim', textContent: 'No open pull request.' }),
    blockTitle('Issues', p.forgeIssues.length + ' open' + (notReadyCount ? ' · ' + notReadyCount + ' not ready' : '')),
    el('div', { className: 'members' },
      el('button', { className: 'member-chip' + (notReadyOnly ? ' sel' : ''), onclick: () => { notReadyOnly = !notReadyOnly; draw() } }, 'Not ready only')),
    groups.length
      ? el('div', { className: 'person' }, ...groups.flatMap(([title, note, list]) => [
          el('div', { className: 'group-head' }, el('strong', { textContent: title }), el('span', { className: 'dim', textContent: ' · ' + (note || list.length) })),
          el('table', { className: 'rows' }, el('tbody', {}, ...list.map(issueRow)))]))
      : el('div', { className: 'empty dim', textContent: 'No open issue.' }))
}

// Metrics: lead, review and merge time over 30 and 90 days, then the weekly throughput of the 90 days as stacked bars.
const FLOW_ROWS = [['Lead time', 'issue opened → closed', 'leadTime'], ['Review', 'opened → first review', 'firstReview'], ['Merge', 'opened → merged', 'merge']]
const flowCell = s => s.count ? s.median + ' · ' + s.p90 + ' (' + s.count + ')' : '—'
function metrics(p) {
  if (!p.flow) return el('p', { className: 'dim', textContent: 'No forge data.' })
  const [w30, w90] = p.flow.windows
  const top = Math.max(1, ...w90.throughput.map(w => w.issues + w.pulls))
  const height = n => 'height:' + Math.round(100 * n / top) + '%'
  return el('div', {},
    blockTitle('Cycle times', 'days: median · p90 (count)'),
    tableOf(['', '30 days', '90 days'], FLOW_ROWS.map(([label, sub, key]) =>
      [el('span', {}, label, el('span', { className: 'dim', textContent: ' · ' + sub })), flowCell(w30[key]), flowCell(w90[key])])),
    blockTitle('Weekly throughput', '90 days'),
    el('div', { className: 'legend dim' }, el('i', { className: 'issues' }), 'issues closed', el('i', { className: 'pulls' }), 'pull requests merged'),
    el('div', { className: 'weeks' }, ...w90.throughput.map(w => el('div', { className: 'week', title: w.week + ': ' + w.issues + ' issues · ' + w.pulls + ' PRs' },
      el('small', { textContent: String(w.issues + w.pulls) }),
      el('div', { className: 'stack' }, el('i', { className: 'pulls', style: height(w.pulls) }), el('i', { className: 'issues', style: height(w.issues) })),
      el('small', { textContent: w.week.slice(5) })))))
}

// Documents: the products of .pm/, then each folder of the project.yaml documents key with its files.
function documents(p) {
  const own = p.documents.filter(d => !d.folder)
  const folders = [...new Set(p.documents.filter(d => d.folder).map(d => d.folder))]
  if (!p.documents.length) return el('p', { className: 'dim', textContent: 'None yet.' })
  return el('div', {},
    own.length ? tableOf(['Document', 'Status', 'Version'], own.map(d => [fileLink(d.path, d.title), d.status, d.version])) : null,
    ...folders.map(f => el('div', {},
      el('h3', { textContent: f }),
      tableOf(['Document', 'File'], p.documents.filter(d => d.folder === f).map(d => [fileLink(d.path, d.title), el('span', { className: 'dim mono', textContent: d.path.split('/').pop() })])))))
}

// The Lessons Log: the last retrospective, the actions open first, the lessons newest first.
const openActions = p => p.actions.filter(a => a.status === 'open')
const actionText = a => a.id + ' ' + a.text + (a.issue === null ? '' : ' #' + a.issue)
// The forge issue of an action: its own url when the desk read it, else the url of any item of the repo with the number swapped.
function issueLink(p, number) {
  const known = p.forgeIssues.concat(p.flow ? p.flow.closedIssues : [])
  const own = known.find(i => i.number === number)
  const any = own || known.concat(p.forgePulls)[0]
  const url = own ? own.url : any ? any.url.slice(0, any.url.lastIndexOf('/', any.url.lastIndexOf('/') - 1)) + '/issues/' + number : ''
  return url ? el('a', { href: url, textContent: '#' + number }) : el('span', { textContent: '#' + number })
}
function lessons(p) {
  const actions = openActions(p).concat(p.actions.filter(a => a.status !== 'open'))
  const newest = p.lessons.slice().reverse().sort((a, b) => b.date.localeCompare(a.date))
  return el('div', {},
    el('p', { className: p.lastRetro ? '' : 'dim', textContent: p.lastRetro ? 'Last retrospective ' + p.lastRetro : 'No retrospective yet.' }),
    actions.length ? tableOf(['', 'Action', 'Issue', 'Status'], actions.map(a => dimUnlessOpen(a.status, [a.id, a.text, a.issue === null ? '—' : issueLink(p, a.issue), a.status]))) : null,
    newest.length ? tableOf(['Date', 'Iteration', 'Kind', 'Lesson'], newest.map(l => [l.date, l.iteration === null ? '—' : String(l.iteration), l.kind, l.text])) : null)
}

// Newest first; WPs is done/planned for the open iteration, the delivered count for a closed one.
function iterations(p) {
  if (!p.iterations.length) return el('p', { className: 'dim', textContent: 'No iteration.' })
  const wps = it => p.iteration && it.number === p.iteration.number ? p.iteration.done + '/' + p.iteration.planned : String(it.delivered.length)
  return tableOf(['#', 'Goal', 'Dates', 'WPs', 'Status', 'Result'], p.iterations.slice().reverse().map(it => [String(it.number), it.goal, (it.start || '—') + ' → ' + (it.end || '—'), wps(it), it.status, it.result]))
}

// The roadmap: a block per horizon in p.roadmap order, then the open work packages with no horizon.
const HORIZONS = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']]
const placedCount = p => p.roadmap.now.length + p.roadmap.next.length + p.roadmap.later.length
function roadmap(p) {
  if (!placedCount(p) && !p.roadmap.unplaced.length) return el('p', { className: 'dim', textContent: "No roadmap yet: run /pm-roadmap in the project's repo." })
  const wps = ids => ids.map(id => p.workPackages.find(w => w.id === id)).filter(Boolean)
  return el('div', {},
    ...HORIZONS.map(([key, label]) => el('div', {}, el('h3', { textContent: label }), p.roadmap[key].length
      ? tableOf(['', 'Title', 'Stage', 'Status', 'Due'], wps(p.roadmap[key]).map(w => [fileLink(w.path, w.id), w.title, w.stage === null ? '' : String(w.stage), w.status, el('span', {}, w.due, placeControls(p, w))]))
      : el('p', { className: 'dim', textContent: 'Nothing planned.' }))),
    p.roadmap.unplaced.length ? el('p', { className: 'dim', textContent: 'Not on the roadmap: ' + p.roadmap.unplaced.join(', ') }) : null,
    server && p.roadmap.unplaced.length ? tableOf(['', 'Title', 'Place'], wps(p.roadmap.unplaced).map(w => [w.id, w.title, placeControls(p, w)])) : null)
}

// The Daily Log: a block per day, newest first, its entries in file order; an open action past its due is red.
// p.dailyLog is missing on a project built by older code: read as empty.
const logOf = p => p.dailyLog || []
const openLogActions = p => logOf(p).filter(d => d.status === 'open')
const logText = d => d.text + (d.ref ? ' ' + d.ref : '') + (d.register ? ' → ' + d.register : '')
function dailyLog(p) {
  if (!logOf(p).length) return el('p', { className: 'dim', textContent: "No daily log yet: run /pm-log in the project's repo." })
  const days = [...new Set(logOf(p).map(d => d.date))].sort().reverse()
  return el('div', {}, ...days.map(day => el('div', {}, el('h3', { textContent: day }),
    tableOf(['', 'Kind', 'Entry', 'Issue', 'Owner', 'Due', 'Status'], logOf(p).filter(d => d.date === day).map(d => dimUnlessOpen(d.status || 'open',
      [d.id, d.kind + (d.source ? ' · ' + d.source : ''), logText(d), d.issue === null ? '' : issueLink(p, d.issue), d.owner, d.isOverdue ? el('span', { className: 'err', textContent: d.due }) : d.due, d.status]))))))
}

// One entry per tab: [id, label, count(p), render(p)].
// Risks and issues list every entry, the open ones first; a closed one is dimmed.
const openFirst = rows => rows.filter(r => isOpen(r.status)).concat(rows.filter(r => !isOpen(r.status)))
const dimUnlessOpen = (status, cells) => isOpen(status) ? cells : cells.map(c => el('span', { className: 'dim' }, c))
const TABS = [
  ['roles', 'Roles', p => p.roles.length, p => tableOf(['Role', 'People'], p.roles.map(r => [r.label, r.people.join(', ') || '—']))],
  ['team', 'Team', p => p.team.length, team],
  ['activity', 'Activity', p => p.forgeIssues.length + p.forgePulls.length, activity],
  ['metrics', 'Metrics', p => p.flow ? p.flow.windows[0].merge.count : 0, metrics],
  ['documents', 'Documents', p => p.documents.length, documents],
  ['wps', 'Work packages', p => p.workPackages.length, p => el('div', {}, p.effort ? el('p', { textContent: stageEffort(p.effort) }) : null, tableOf(['', 'Title', 'Stage', 'Status', 'Team manager', 'Due', 'Estimate', 'Actual', 'Deviation', 'Link'],
    p.workPackages.map(w => [fileLink(w.path, w.id), w.title, w.stage === null ? '' : String(w.stage), el('span', {}, w.status, statusAction(p, w)), w.teamManager, w.due, hours(w.estimate), hours(w.actual), w.deviation === null ? '' : signed(w.deviation), wpLink(p, w)])))],
  ['iterations', 'Iterations', p => p.iterations.length, iterations],
  ['lessons', 'Lessons', p => openActions(p).length, lessons],
  ['roadmap', 'Roadmap', placedCount, roadmap],
  ['log', 'Daily log', p => openLogActions(p).length, dailyLog],
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
        el('span', { className: 'mono', textContent: w.id + ' ' }), w.title, completedPill(w),
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
  current = p || null
  document.getElementById('app').replaceChildren(...(p ? form(p, route.slice(p.path.length + 1)) : overview()))
}

draw()
// A reload would drop the picked issues and pull requests: it waits until nothing is picked.
// An open dialog holds it too.
setInterval(() => { if (dialogOpen) return; if (!pickedItems.size) location.reload() }, data.reloadMs)
`
