import { getLinkBase, getPackageLink, getSessionLink } from './actions'
import { getBoardLanes } from './lanes'
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
      lanes: getBoardLanes(project),
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
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2328; --dim: #656d76; --line: #d0d7de; --chip: #f6f8fa; --on: #0969da;
  --green: #1a7f37; --amber: #9a6700; --red: #cf222e; --purple: #8250df; --none: #8c959f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1117; --fg: #e6edf3; --dim: #8d96a0;
  --line: #30363d; --chip: #161b22; --on: #58a6ff; --green: #3fb950; --amber: #d29922; --red: #f85149; --purple: #a371f7; --none: #6e7681; } }
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
.bar.met i { background: var(--green); }
.phases { display: inline-flex; gap: 2px; vertical-align: middle; margin-right: 6px; }
.phases i { width: 12px; height: 8px; border-radius: 2px; background: var(--line); }
.phases i.done { background: var(--green); } .phases i.in-progress { background: var(--on); }
.phases i.failed { background: var(--red); } .phases i.blocked { background: var(--amber); }
.pill { white-space: nowrap; display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; font-size: 12px; color: var(--dim); }
.pill.open { color: var(--on); border-color: var(--on); } .pill.merged, .pill.ready { color: var(--green); border-color: var(--green); }
.pill.red { color: var(--red); border-color: var(--red); }
.pill.review { color: var(--amber); border-color: var(--amber); } .pill.inprogress { color: var(--on); border-color: var(--on); }
.pill.waiting { color: var(--dim); } .pill.stalled { color: var(--red); border-color: var(--red); } .pill.todo { color: var(--fg); }
.pill.notready { color: var(--amber); border-color: var(--amber); }
.pill.wip-over { color: #fff; background: var(--red); border-color: var(--red); }
.forge { display: flex; flex-wrap: wrap; gap: 6px; }
button { border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 999px; padding: 3px 10px; font: inherit; cursor: pointer; }
/* Form controls share one look, themed like the buttons: the native ones stay light in dark mode and are tiny on macOS. Selects
   draw their own chevron from two gradients, so it follows --dim in both themes. */
select, textarea, input[type=text], input[type=number], input[type=search] { font: inherit; font-size: 13px; color: var(--fg); background-color: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; min-height: 28px; }
select { appearance: none; -webkit-appearance: none; padding-right: 26px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--dim) 50%), linear-gradient(135deg, var(--dim) 50%, transparent 50%);
  background-position: calc(100% - 14px) 52%, calc(100% - 9px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }
select:hover, textarea:hover, input[type=text]:hover, input[type=number]:hover, input[type=search]:hover { border-color: var(--dim); }
select:focus-visible, textarea:focus-visible, input[type=text]:focus-visible, input[type=number]:focus-visible, input[type=search]:focus-visible { outline: none; border-color: var(--on); box-shadow: 0 0 0 3px color-mix(in srgb, var(--on) 25%, transparent); }
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
.pill.kind-decision { color: var(--on); border-color: var(--on); } .pill.kind-action { color: var(--amber); border-color: var(--amber); }
.pill.kind-problem { color: var(--purple); border-color: var(--purple); } .pill.kind-note { color: var(--green); border-color: var(--green); }
.log-source { margin-left: 6px; color: var(--dim); cursor: help; }
.log-filters { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin: 8px 0; }
.log-filters input[type=search] { flex: 1 1 180px; min-width: 0; max-width: 320px; }
.log-filters .n { font-size: 12px; color: var(--dim); }
/* Fixed layout: the ref, pill and date columns line up across the separate group tables. */
table.rows { table-layout: fixed; }
/* Set by tidyTables on the columns of short cells. */
td.nw, th.nw { white-space: nowrap; }
.doc-folder table { table-layout: fixed; } .doc-folder th:last-child { width: 26em; } .doc-folder td:last-child { overflow-wrap: anywhere; }
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
.act { font-size: 12px; padding: 1px 8px; margin-left: 6px; white-space: nowrap; }
.row-actions { text-align: right; white-space: nowrap; }
.board-head { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
.desk-head { display: flex; justify-content: space-between; align-items: center; gap: 8px 12px; flex-wrap: wrap; }
.head-side { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.clock { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.clock-form { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 10px; align-items: center; margin: 10px 0; }
.clock-form select { width: 100%; min-width: 0; }
.clock.on .clock-time { color: var(--red); font-weight: 600; font-variant-numeric: tabular-nums; }
.board-head p { flex: 1; min-width: 0; margin: 0; }
.new-issue { flex-shrink: 0; margin-left: auto; font-size: 14px; padding: 6px 16px; white-space: nowrap; }
.dialog { position: fixed; inset: 0; z-index: 10; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding: 60px 16px; }
.dialog-box { background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; width: min(640px, 100%); max-height: calc(100vh - 120px); overflow: auto; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
.dialog-box h3 { text-transform: none; letter-spacing: 0; font-size: 15px; color: var(--fg); margin: 0 0 10px; }
.dialog-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dialog-row { display: flex; gap: 8px; } .dialog-row input { flex: 1; }
.dialog textarea { flex: 1; }
.dialog-row + .dialog-row { margin-top: 8px; }
.diff { font-family: ui-monospace, monospace; font-size: 12px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.diff .del { color: var(--red); } .diff .add { color: var(--green); }
.warn { color: var(--amber); }
/* Drag and drop: rows and cards that can be dragged, the targets under a dragged item, the dock of targets. */
.drag { cursor: grab; }
.drop-over { outline: 2px solid var(--on); outline-offset: -2px; background: color-mix(in srgb, var(--on) 10%, transparent); }
/* A work package row under a dragged one: the line it goes in at, above or below the row. */
.drop-above > td { box-shadow: inset 0 3px 0 var(--on); } .drop-below > td { box-shadow: inset 0 -3px 0 var(--on); }
/* The dock never changes size under a drag: the target line has its own reserved height and adds nothing to the width (width 0,
   min-width 100%), so naming a target never moves the chips away from the pointer, which would end the hover and loop. */
.dock { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 9; max-width: min(900px, calc(100vw - 32px)); padding: 10px 14px; border: 1px solid var(--on); border-radius: 10px; background: var(--bg); box-shadow: 0 8px 30px rgba(0,0,0,.25); font-size: 13px; }
.dock-row { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.dock .label { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-left: 6px; }
.dock-target { display: block; width: 0; min-width: 100%; min-height: 1.45em; margin-top: 6px; color: var(--on); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drag-ghost { position: fixed; top: -100px; left: 0; padding: 2px 8px; border: 1px solid var(--on); border-radius: 999px; background: var(--bg); color: var(--fg); font: 12px ui-monospace, monospace; }
.drop-zone { border: 1px dashed var(--line); border-radius: 8px; padding: 14px; text-align: center; color: var(--dim); }
.drop-chip { border: 1px dashed var(--line); border-radius: 999px; padding: 4px 10px; background: var(--chip); }
/* Board tab: one swimlane per work package, four columns; cards carry data-number and lanes data-wp for drag and drop. */
.lane { border: 1px solid var(--line); border-radius: 8px; margin-top: 12px; overflow: hidden; }
.lane.reopened { border-color: var(--amber); }
.lane.unplanned { border-style: dashed; }
.lane-head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; padding: 8px 12px; background: var(--chip); border-bottom: 1px solid var(--line); }
.lane-cols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.lane-col { padding: 8px; border-left: 1px solid var(--line); min-height: 56px; }
.lane-col:first-child { border-left: 0; }
.lane-col h4 { margin: 0 0 6px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }
.bcard { border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; background: var(--bg); font-size: 13px; }
.bcard .who { display: block; font-size: 12px; color: var(--dim); margin-top: 2px; }
.bcard .who.none { color: var(--red); font-weight: 600; }
.bcard .ms { font-size: 11px; color: var(--dim); }
.lane-done { font-size: 13px; color: var(--green); }
@media (max-width: 720px) { .lane-cols { grid-template-columns: 1fr 1fr; } .lane-col:nth-child(3) { border-left: 0; } }
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
// Served over http the page cannot follow a file:// link (the browser drops the click): the desk helper opens the file in its
// default application. Opened from disk, the file:// link works as it is.
const fileLink = (path, label) => el('a', { href: 'file://' + encodeURI(path), textContent: label, onclick: e => {
  if (!window.P2KIT_SERVER) return
  e.preventDefault()
  e.stopPropagation()
  fetch('/open', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-P2kit-Token': window.P2KIT_SERVER.token }, body: JSON.stringify({ path }) })
    .then(r => r.ok ? null : r.json().catch(() => ({})).then(a => alert('Cannot open ' + path + ': ' + (a.error || 'HTTP ' + r.status))))
} })
// A Markdown document opens rendered as HTML by the desk helper, in a new tab; without the helper, or for any other file, it
// is a file link.
const docLink = (path, label) => window.P2KIT_SERVER && /\\.md$/i.test(path)
  ? el('a', { href: '/doc?path=' + encodeURIComponent(path), target: '_blank', rel: 'noopener', textContent: label, onclick: e => e.stopPropagation() })
  : fileLink(path, label)
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
// The brief's objectives checklist: the dropped ones are listed but never counted. A project without the field (a hand-built
// fixture) or a brief without the section shows nothing.
const liveObjectives = p => (p.objectives || []).filter(o => !o.isDropped)
const metBar = (done, total) => el('span', {}, el('span', { className: 'bar met' }, el('i', { style: 'width:' + (total ? Math.round(100 * done / total) : 0) + '%' })), done + '/' + total)
const objectivesBar = p => metBar(liveObjectives(p).filter(o => o.isMet).length, liveObjectives(p).length)
const objectivesFact = p => liveObjectives(p).length ? el('span', { title: 'brief objectives met' }, 'objectives ', objectivesBar(p)) : null
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
// How an issue or a pull request is named: its repo in front on a cross-repo project (project.yaml repos:), as genropy#498.
const refOf = (x, kind) => (kind === 'pr' ? 'PR ' : '') + (x.repo || '') + '#' + x.number
const sameItem = (a, b) => a.number === b.number && (a.repo || '') === (b.repo || '')
// A cross-repo project has no forge action yet (issue #89): its issues and pull requests are shown, not changed.
const isCrossRepo = p => (p.repos || []).length > 0
// The reference column: 80px, on a cross-repo project as wide as its longest reference, which carries the repo (PR genropy#12).
const refStyle = p => 'width:' + (isCrossRepo(p) ? Math.max(8, ...p.forgeIssues.map(i => refOf(i).length), ...p.forgePulls.map(x => refOf(x, 'pr').length)) + 2 + 'ch' : '80px') + '; white-space:nowrap'
const missingOf = (p, item) => (p.forgeIssues.find(i => sameItem(i, item)) || {}).missing || []
// The assignees of a team item, from the project's open issues or pull requests once they carry them; undefined until then.
const assigneesOf = (p, i) => ((i.kind === 'pr' ? p.forgePulls : p.forgeIssues).find(x => sameItem(x, i)) || {}).assignees
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
// The desk clock (server/timelog.py): the PM's own time on a project, an issue of it or a meeting, appended to the local time
// log on Stop or Switch and written to the project's timesheet only by /pm-log. Only with the helper: the page asks it once per
// load and ticks on its own; the time log stays on this machine.
let clock = null
let today = {}
const projectName = path => (data.projects.find(x => x.path === path) || { name: path }).name
const clockLabel = c => projectName(c.project) + (c.ref ? ' ' + c.ref : '') + (c.kind === 'meeting' ? ' · meeting' : '')
const elapsed = start => { const m = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000)); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') }
const minutesText = m => (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm'
const setClock = state => { clock = state.clock || null; today = state.today || {} }
async function clockPost(body) {
  const res = await fetch('/clock', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-P2kit-Token': server.token }, body: JSON.stringify(body) })
  const answer = await res.json().catch(() => ({ error: 'HTTP ' + res.status }))
  if (!res.ok) throw new Error(answer.error || 'HTTP ' + res.status)
  setClock(answer)
}
async function readClock() {
  if (!server) return
  try { setClock(await fetch('/clock', { cache: 'no-store' }).then(r => r.json())) } catch (error) { return }
  if (!dialogOpen) draw()
}
const stopClock = () => clockPost({ op: 'stop' }).then(() => draw(), error => failed(openDialog('Clock'), 'Not stopped', error))
// Start, or Switch while it runs: on a project, an issue of it (its open issues) or a meeting.
function clockDialog() {
  const first = (clock && clock.project) || (current && current.path) || (data.projects[0] || {}).path
  const project = el('select', {}, ...data.projects.map(x => el('option', { value: x.path, textContent: x.name, selected: x.path === first })))
  const target = el('select', {})
  const kind = el('select', {}, el('option', { value: 'desk', textContent: 'desk work' }), el('option', { value: 'meeting', textContent: 'meeting' }))
  const targets = () => {
    const p = data.projects.find(x => x.path === project.value)
    target.replaceChildren(el('option', { value: '', textContent: 'the project' }),
      ...(p ? p.forgeIssues : []).map(i => el('option', { value: refOf(i), textContent: refOf(i) + ' ' + i.title })))
  }
  project.onchange = targets
  targets()
  const start = async () => {
    try { await clockPost({ op: 'start', project: project.value, ref: target.value || null, kind: kind.value }) } catch (error) { return failed(box, 'Not started', error) }
    closeDialog()
  }
  const box = openDialog(clock ? 'Switch the clock' : 'Start the clock',
    el('p', { className: 'dim', textContent: clock ? 'The time so far on ' + clockLabel(clock) + ' goes to the time log; the clock starts again on:' : 'Your own time, kept on this machine until /pm-log writes the day to the timesheet.' }),
    el('div', { className: 'clock-form' }, el('span', { className: 'dim', textContent: 'Project' }), project,
      el('span', { className: 'dim', textContent: 'On' }), target, el('span', { className: 'dim', textContent: 'As' }), kind),
    buttons(closeButton('Cancel'), el('button', { className: 'primary', textContent: clock ? 'Switch' : 'Start', onclick: start })))
}
function clockBar() {
  if (!server) return null
  if (!clock) return el('div', { className: 'clock' }, el('button', { textContent: '⏱ Start clock', title: 'record your own time on a project, an issue or a meeting', onclick: clockDialog }))
  const time = el('span', { className: 'clock-time', textContent: '⏱ ' + elapsed(clock.start) })
  time.dataset.start = clock.start
  return el('div', { className: 'clock on' }, time, el('span', { textContent: clockLabel(clock) }), el('button', { textContent: 'Switch…', onclick: clockDialog }), el('button', { textContent: 'Stop', onclick: stopClock }))
}
// The running time ticks in place: a redraw would drop what the user is doing on the page.
setInterval(() => document.querySelectorAll('.clock-time').forEach(n => { n.textContent = '⏱ ' + elapsed(n.dataset.start) }), 15 * 1000)
const timeFact = p => p.time ? el('span', { title: Object.entries(p.time.byKind).map(([k, h]) => k + ' ' + h + 'h').join(' · ') + ' — ' + p.time.people.join(', '), textContent: 'time ' + p.time.hours + 'h' }) : null
const todayFact = p => today[p.path] ? el('span', { title: 'logged today, not yet in the timesheet', textContent: 'today ' + minutesText(today[p.path]) }) : null
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
// One file of a preview: its path, then each line before and after.
const fileChanges = f => [el('p', { className: 'dim mono', textContent: f.file }),
  ...f.changes.map(c => el('div', { className: 'diff' }, el('div', { className: 'dim', textContent: 'line ' + c.line }),
    c.before ? el('div', { className: 'del', textContent: '- ' + c.before }) : null, c.after ? el('div', { className: 'add', textContent: '+ ' + c.after }) : null))]
// What an action will change: the line before and after, or the plan of a package with the items to move picked here.
function previewOf(preview, extra) {
  if (preview.kind === 'issue-milestone') return [
    el('p', { className: 'dim', textContent: 'On ' + preview.forge }),
    el('p', {}, el('strong', { textContent: preview.item.ref + ' ' }), preview.item.title),
    preview.link ? el('p', {}, el('strong', { textContent: (preview.milestone.action === 'create' ? 'Create' : 'Reuse') + ' milestone ' }), preview.milestone.title) : null,
    el('div', { className: 'diff' }, el('div', { className: 'del', textContent: '- milestone: ' + (preview.before || 'none') }),
      el('div', { className: 'add', textContent: '+ milestone: ' + preview.milestone.title + ' (' + preview.wp + ')' })),
    preview.link ? el('div', {}, el('p', { className: 'dim mono', textContent: preview.link.file }), el('div', { className: 'diff' }, el('div', { className: 'dim', textContent: 'line ' + preview.link.change.line }),
      el('div', { className: 'add', textContent: '+ ' + preview.link.change.after }))) : null,
    preview.milestone.closed ? el('p', { className: 'warn', textContent: 'The milestone ' + preview.milestone.title + ' is closed.' }) : null]
  if (preview.kind === 'issue-create') return [
    el('p', { className: 'dim', textContent: 'On ' + preview.forge }),
    el('div', { className: 'diff add', textContent: '+ ' + preview.issue.title + (preview.issue.body ? '\\n\\n' + preview.issue.body : '') }),
    el('p', { textContent: 'Milestone: ' + (preview.milestone ? preview.milestone.title + ' (' + preview.wp + ')' : 'none') + ' · assignee: ' + (preview.assignee ? preview.assignee.person : 'none') }),
    preview.milestone && preview.milestone.closed ? el('p', { className: 'warn', textContent: 'The milestone ' + preview.milestone.title + ' is closed.' }) : null,
    el('p', { className: 'warn', textContent: 'An issue cannot be deleted once created: if it is not wanted, close it.' })]
  if (preview.kind === 'assign') return [
    el('p', { className: 'dim', textContent: 'On ' + preview.forge }),
    el('p', {}, el('strong', { textContent: preview.item.ref + ' ' }), preview.item.title),
    el('div', { className: 'diff' }, el('div', { className: 'del', textContent: '- assignees: ' + (preview.before.join(', ') || 'none') }),
      el('div', { className: 'add', textContent: '+ assignees: ' + (preview.after.join(', ') || 'none') }))]
  if (preview.kind === 'assign-many') return [
    el('p', { className: 'dim', textContent: 'On ' + preview.forge }),
    el('div', { className: 'diff' }, ...preview.items.map(i => el('div', {}, el('strong', { textContent: i.ref + ' ' }), i.title,
      el('div', { className: 'del', textContent: '- assignees: ' + (i.before.join(', ') || 'none') }), el('div', { className: 'add', textContent: '+ assignees: ' + (i.after.join(', ') || 'none') })))),
    preview.skipped.length ? el('div', {}, el('h3', { textContent: 'Left out' }), ...preview.skipped.map(i => el('div', { className: 'dim', textContent: i.ref + ' · ' + i.reason }))) : null]
  // A drop in the Work packages tab writes one file or, renumbering the horizon, several.
  if (preview.kind === 'wp-place') return preview.files.flatMap(fileChanges)
  if (preview.kind === 'log-owner') return [...fileChanges(preview),
    preview.skipped.length ? el('div', {}, el('h3', { textContent: 'Left out' }), ...preview.skipped.map(i => el('div', { className: 'dim', textContent: i.reason }))) : null]
  if (preview.kind !== 'package') return fileChanges(preview)
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
// A new issue on the project's forge, optionally in a work package's milestone and assigned to a team member: the helper previews
// it and creates it on Confirm. Without the helper, or for the readiness headings, the pm-issue skill drafts it in a session.
// Starting the work is the developer's move, from their forge desk's Solve.
const issueTargets = p => p.workPackages.filter(w => w.delivery && w.delivery.milestone && !['completed', 'archived', 'cancelled'].includes(w.status))
function issueDialog(p, wp) {
  const title = el('input', { type: 'text', placeholder: 'Export the daily log as CSV' })
  const body = el('textarea', { rows: 6, placeholder: '## Why\\n\\n## What changes\\n\\n## Done when\\n' })
  const pickWp = el('select', { title: 'work package' }, el('option', { value: '', textContent: 'No work package' }),
    ...issueTargets(p).map(w => el('option', { value: w.id, textContent: w.id + ' ' + w.title, selected: w.id === wp })))
  const pickWho = el('select', { title: 'assignee' }, el('option', { value: '', textContent: 'Unassigned' }),
    ...p.team.filter(m => m.login).map(m => el('option', { value: m.login, textContent: m.person })))
  const draft = el('a', { textContent: 'draft it with pm-issue' })
  const drafted = () => { draft.href = skillLink(p, 'pm-issue', pickWp.value || 'a work package') }
  pickWp.onchange = drafted
  drafted()
  const preview = () => title.value.trim() && act(p, { kind: 'issue-create', title: title.value.trim(), body: body.value, wp: pickWp.value, login: pickWho.value })
  title.onkeydown = e => { if (e.key === 'Enter') preview() }
  openDialog('New issue on ' + p.name,
    el('div', { className: 'dialog-row' }, title), el('div', { className: 'dialog-row' }, body), el('div', { className: 'dialog-row' }, pickWp, pickWho),
    el('p', { className: 'dim' }, 'For the readiness headings of a work package: ', draft, '.'),
    buttons(closeButton('Cancel'), el('button', { className: 'primary', textContent: 'Preview', onclick: preview })))
  title.focus()
}
function newIssueButton(p, wp, label = 'New issue', className = 'act') {
  if (!server || p.pmRef || isCrossRepo(p)) return null
  return el('button', { className, textContent: label, title: 'create an issue' + (wp ? ' in ' + wp : ''), onclick: e => { e.stopPropagation(); issueDialog(p, wp) } })
}
// Assign or unassign one team member on every picked issue and pull request (the only assign control besides a drop on a member,
// issue #58): one preview lists them all, with those left out. Only with the helper, and never on a project whose .pm/ is read from git.
const canAssign = p => server && !p.pmRef && !isCrossRepo(p) && p.team.some(m => m.login)
function assignManyControl(p, numbers) {
  if (!canAssign(p)) return null
  const members = p.team.filter(m => m.login)
  const group = (op, label) => el('optgroup', { label }, ...members.map(m => el('option', { value: op + ':' + m.login, textContent: (op === 'add' ? '+ ' : '− ') + m.person })))
  const pick = el('select', { className: 'assign', title: 'assign or unassign a team member on the selected items',
    onchange: () => { const [op, login] = pick.value.split(':'); pick.value = ''; if (login) act(p, { kind: 'assign-many', numbers, login, op }) } },
    el('option', { value: '', textContent: 'Assign to…' }), group('add', 'Assign'), group('remove', 'Unassign'))
  return pick
}
function packageDialog(p, refs) {
  const title = el('input', { type: 'text', placeholder: 'one to three words' })
  const preview = () => title.value.trim() && act(p, { kind: 'package', refs, title: title.value.trim() })
  title.onkeydown = e => { if (e.key === 'Enter') preview() }
  openDialog('Package ' + refs.join(' '), el('p', { className: 'dim', textContent: 'The title names the milestone and the work package.' }), el('div', { className: 'dialog-row' }, title),
    buttons(closeButton('Cancel'), el('button', { className: 'primary', textContent: 'Preview', onclick: preview })))
  title.focus()
}

// Drag and drop: the same preview and Confirm as the selects; attaching one issue or pull request to a work package is a drop only
// (no per-row select, issue #57), a checked group goes through Create package. An issue or pull request dropped on a
// member is assigned to them, on a work package attached to its milestone; a milestone dropped on a work package is linked to it.
// While a drag is on, a dock lists the members and work packages that accept it, from any tab; Board lanes and Team members
// accept a drop too. An open work package dragged in the Work packages tab is placed: dropped on a horizon group (or its dock
// chip) it goes last there, on Not placed it leaves the roadmap, above or below a row it takes that place (issue #67).
// Only with the helper, and never on a project whose .pm/ is read from git. dragging holds the reload.
let dragging = null
const loginsOf = assignees => assignees ? assignees.map(a => (a.login || a).toLowerCase()) : null
// The request a drop of item on a member or a work package makes; null when that target does not accept it.
function assignRequest(item, m) {
  if (item.kind === 'milestone' || item.kind === 'wp' || !m.login || (item.logins && item.logins.includes(m.login.toLowerCase()))) return null
  return { kind: 'assign', number: item.number, login: m.login, op: 'add' }
}
// The request a drop of a work package makes in a horizon ('' for Not placed), above or below the row beside or last; null
// when it would leave the roadmap as it is.
function placeRequest(p, item, horizon, beside, side) {
  if (item.kind !== 'wp' || beside === item.id) return null
  if (!horizon) return item.isPlaced ? { kind: 'wp-place', target: item.id, horizon: '' } : null
  const order = (p.roadmap && p.roadmap[horizon]) || []
  const others = order.filter(id => id !== item.id)
  const index = beside ? others.indexOf(beside) + (side === 'below' ? 1 : 0) : others.length
  if (order.indexOf(item.id) === index) return null
  return beside ? { kind: 'wp-place', target: item.id, horizon, beside, side } : { kind: 'wp-place', target: item.id, horizon }
}
const placeText = r => (r.horizon ? HORIZONS.find(h => h[0] === r.horizon)[1] : 'Not placed') + (r.beside ? ', ' + r.side + ' ' + r.beside : r.horizon ? ', last' : '')
function wpRequest(p, item, w) {
  if (item.kind === 'wp' || ['archived', 'cancelled'].includes(w.status)) return null
  const milestone = w.delivery ? w.delivery.milestone : ''
  if (item.kind === 'milestone') return milestone === item.title ? null : { kind: 'wp-link', target: w.id, field: 'milestone', value: item.title }
  if (!milestone) return w.title && w.status !== 'completed' ? { kind: 'issue-milestone', number: item.number, wp: w.id } : null
  return milestone !== item.milestone ? { kind: 'issue-milestone', number: item.number, wp: w.id } : null
}
function endDrag() {
  dragging = null
  const dock = document.getElementById('dock')
  if (dock) dock.remove()
  document.querySelectorAll('.drop-over').forEach(unmark)
}
const unmark = n => n.classList.remove('drop-over', 'drop-above', 'drop-below')
// The dock names the target under the pointer: the dragged image may cover it.
const showTarget = text => { const shown = document.getElementById('dock-target'); if (shown) shown.textContent = text }
// A drop target: highlighted, and named in the dock, while a dragged item it accepts is over it; the drop opens the preview
// of request(item, event). A target inside another one (a work package row in its horizon group) is the only one highlighted;
// one that stops accepting under the pointer (a row over itself) lets go of its highlight.
function dropTarget(p, node, request, label) {
  node.addEventListener('dragover', e => {
    const wanted = dragging && request(dragging, e)
    if (!wanted) {
      if (node.classList.contains('drop-over')) { unmark(node); showTarget('') }
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'link'
    document.querySelectorAll('.drop-over').forEach(n => { if (n !== node) unmark(n) })
    node.classList.add('drop-over')
    node.classList.toggle('drop-above', wanted.side === 'above')
    node.classList.toggle('drop-below', wanted.side === 'below')
    showTarget('→ ' + (wanted.kind === 'wp-place' ? 'place in ' + placeText(wanted)
      : (wanted.kind === 'assign' ? 'assign to ' : wanted.kind === 'wp-link' ? 'link to ' : 'attach to ') + label))
  })
  node.addEventListener('dragleave', e => { if (!node.contains(e.relatedTarget)) { unmark(node); showTarget('') } })
  node.addEventListener('drop', e => {
    const wanted = dragging && request(dragging, e)
    endDrag()
    if (!wanted) return
    e.preventDefault()
    e.stopPropagation()
    act(p, wanted)
  })
  return node
}
function showDock(p, item) {
  const chip = (label, request) => dropTarget(p, el('span', { className: 'drop-chip', textContent: label }), request, label)
  const members = item.kind === 'milestone' ? [] : p.team.filter(m => assignRequest(item, m))
  const packages = p.workPackages.filter(w => wpRequest(p, item, w))
  // A work package goes last in a horizon from its chip: the only way into a horizon with no work package, which shows no group.
  const places = item.kind === 'wp' ? HORIZONS.concat([['', 'Not placed']]).filter(([key]) => placeRequest(p, item, key)) : []
  const dock = el('div', { className: 'dock', id: 'dock' }, el('div', { className: 'dock-row' }, el('strong', { textContent: 'Drop ' + item.ref + ' on' }),
    members.length ? el('span', { className: 'label', textContent: 'Assign to' }) : null,
    ...members.map(m => chip(m.person, x => assignRequest(x, m))),
    packages.length ? el('span', { className: 'label', textContent: item.kind === 'milestone' ? 'Link to' : 'Attach to' }) : null,
    ...packages.map(w => chip(w.id + ' ' + w.title, x => wpRequest(p, x, w))),
    places.length ? el('span', { className: 'label', textContent: 'Place in' }) : null,
    ...places.map(([key, label]) => chip(label, x => placeRequest(p, x, key))),
    members.length || packages.length || places.length ? null : el('span', { className: 'dim', textContent: 'no member or work package accepts it' })),
    el('strong', { className: 'dock-target', id: 'dock-target' }))
  document.body.append(dock)
}
// Makes a row or a card draggable; item: { kind: 'issue' | 'pr' | 'milestone', ref, number, title, milestone, logins }, or
// { kind: 'wp', ref, id, isPlaced } for a work package row.
function draggable(p, node, item) {
  if (!server || p.pmRef || (isCrossRepo(p) && item.kind !== 'wp')) return node
  node.draggable = true
  node.classList.add('drag')
  node.addEventListener('dragstart', e => {
    dragging = item
    e.dataTransfer.effectAllowed = 'link'
    e.dataTransfer.setData('text/plain', item.ref)
    // A small image of the reference, not the whole row: a wide row would hide the target under the pointer.
    const ghost = el('div', { className: 'drag-ghost', textContent: item.ref })
    document.body.append(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => ghost.remove(), 0)
    // Changing the page inside dragstart can cancel the drag: the dock comes on the next turn.
    setTimeout(() => { if (dragging === item) showDock(p, item) }, 0)
  })
  node.addEventListener('dragend', endDrag)
  return node
}
const dragItem = (kind, x) => ({ kind, ref: refOf(x, kind), number: x.number, milestone: x.milestone || '', logins: loginsOf(x.assignees) })

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

// decorate(tr, index) may make a row draggable or a drop target.
function tableOf(head, rows, decorate = tr => tr) {
  if (!rows.length) return el('p', { className: 'dim', textContent: 'None.' })
  return el('table', { className: 'grid' }, el('thead', {}, el('tr', {}, ...head.map(h => el('th', { textContent: h })))),
    el('tbody', {}, ...rows.map((r, i) => decorate(el('tr', {}, ...r.map(c => el('td', {}, c))), i))))
}

// Once drawn, the tableOf tables of a view are tidied: a column whose cells are all short (an id, a date, a score, a name) never
// wraps, and the tables sharing a header line up, each column as wide as its widest cell in the group, the longest column taking
// the rest. While a table would overflow its box, short columns go back to wrapping, the longest first; ids never do.
const SHORT_CELL = 28
const MIN_FLEX = 180
function tidyTables(root) {
  const groups = new Map()
  root.querySelectorAll('table.grid').forEach(t => {
    const key = [...t.tHead.rows[0].cells].map(c => c.textContent).join('|')
    groups.set(key, (groups.get(key) || []).concat(t))
  })
  for (const tables of groups.values()) {
    const heads = tables.map(t => [...t.tHead.rows[0].cells])
    const rows = tables.flatMap(t => [...t.rows])
    const len = heads[0].map((_, i) => Math.max(...rows.map(r => r.cells[i] ? r.cells[i].textContent.trim().length : 0)))
    const flex = len.indexOf(Math.max(...len))
    const short = len.map((l, i) => i !== flex && l <= SHORT_CELL)
    const apply = () => rows.forEach(r => [...r.cells].forEach((c, i) => c.classList.toggle('nw', Boolean(short[i]))))
    apply()
    const loosen = short.map((_, i) => i).filter(i => short[i] && len[i] > 8).sort((a, b) => len[b] - len[a])
    while (loosen.length && tables.some(t => t.offsetWidth > t.parentElement.clientWidth + 1)) { short[loosen.shift()] = false; apply() }
    if (tables.length < 2) continue
    // A fixed layout holds the shared widths; when they leave the longest column too little room, the other wrapping columns
    // give it back in proportion.
    // Measured at their natural width: stretched to the box, each table spreads its spare room differently, and the widest of
    // each column across the group would leave the longest one nothing.
    tables.forEach(t => { t.style.tableLayout = ''; t.style.width = 'auto' })
    heads.forEach(h => h.forEach(c => { c.style.width = '' }))
    const widths = heads[0].map((_, i) => Math.max(...heads.map(h => h[i].getBoundingClientRect().width)))
    tables.forEach(t => { t.style.width = '' })
    const free = tables[0].clientWidth - widths.reduce((a, w, i) => a + (i === flex ? 0 : w), 0)
    const give = widths.map((w, i) => i !== flex && !short[i] ? w : 0)
    const givable = give.reduce((a, w) => a + w, 0)
    if (free < MIN_FLEX && givable) widths.forEach((w, i) => { widths[i] = w - give[i] * Math.min(1, (MIN_FLEX - free) / givable) })
    heads.forEach(h => h.forEach((c, i) => { if (i !== flex) c.style.width = widths[i] + 'px' }))
    tables.forEach(t => { t.style.tableLayout = 'fixed' })
  }
}

function noteLine(n) {
  const open = n.kind === 'blocker' && n.status === 'open'
  return el('div', { className: 'note ' + (open ? 'err' : 'dim') }, n.kind + ' · ' + n.status + ' · ' + n.text + (n.date ? ' (' + n.date + ')' : ''), noteAction(n))
}
const shaNote = n => el('div', {}, el('span', { className: 'mono', textContent: n.sha.slice(0, 7) + ' ' }), noteLine(n))

function overview() {
  return [
    el('div', { className: 'desk-head' }, el('h1', { textContent: 'Project desk' }), clockBar()),
    el('p', { className: 'dim', textContent: data.projects.length + ' projects · updated ' + new Date(data.refreshedAt).toLocaleString() }),
    ...data.errors.map(e => el('p', { className: 'err', textContent: e })),
    ...data.projects.map(p => el('div', { className: 'project' },
      el('div', { className: 'project-head', onclick: () => go(p.path) },
        dot(p.light),
        el('div', {}, el('strong', { textContent: p.name }), ' ', el('span', { className: 'dim', textContent: p.code }),
          el('div', { className: 'facts' },
            el('span', { textContent: stageOf(p) }),
            objectivesFact(p),
            el('span', {}, 'WPs ', progressOf(p)),
            p.iteration ? iterationFact(p.iteration) : null,
            p.effort ? effortFact(p) : null,
            timeFact(p),
            todayFact(p),
            el('span', { className: p.highRisks ? 'err' : '', textContent: 'high risks ' + p.highRisks }),
            el('span', { className: p.openBlockers ? 'err' : '', textContent: 'blockers ' + p.openBlockers }),
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

// A risk is covered when its response actions are written and Claude judged them adequate; a snapshot of older code has neither, so
// its risks read as uncovered. A covered risk stays open, and in Needs attention, until the user confirms its closure in chat.
const isCovered = r => !!r.responseActions && r.verdict === 'adequate'
const riskState = r => !r.responseActions ? 'no response' : r.verdict === 'adequate' ? 'response adequate: confirm the closure'
  : r.verdict === 'not-adequate' ? 'response not adequate' + (r.verdictReason ? ': ' + r.verdictReason : '') : 'response not assessed'

function attention(p) {
  const blockers = p.blockers.map(b => [b.wp, b.sha, b.text])
  // The high open risks (score 6 or more): the uncovered ones first and red, then the covered ones waiting for the closure; by score.
  const risks = p.risks.filter(r => isOpen(r.status) && r.score >= 6).sort((a, b) => isCovered(a) - isCovered(b) || b.score - a.score)
  const lines = [
    ...blockers.map(([wp, sha, text]) => el('div', { className: 'err' }, el('span', { className: 'mono', textContent: wp + ' ' + sha + ' ' }), text)),
    ...risks.map(r => el('div', { className: isCovered(r) ? '' : 'err', textContent: r.id + ' [' + r.score + '] ' + r.title + ' · ' + riskState(r) })),
    p.nextReport.isOverdue ? el('div', { className: 'err', textContent: 'Highlight report overdue since ' + p.nextReport.due }) : null,
    p.iteration && p.iteration.isOverdue ? el('div', { className: 'err', textContent: 'Iteration ' + p.iteration.number + ' past its end (' + p.iteration.end + ')' }) : null,
    ...openActions(p).map(a => el('div', { textContent: actionText(a) })),
    ...logOf(p).filter(d => d.isOverdue).map(d => el('div', { className: 'err', textContent: d.id + ' ' + d.text + (d.owner ? ' · ' + d.owner : '') + ' · due ' + d.due })),
    ...overLimit(p).map(m => el('div', { className: 'err', textContent: wipText(m) })),
    p.notReady ? el('div', { textContent: p.notReady + ' issues not ready' }) : null,
  ].filter(Boolean)
  return lines.length ? lines : [el('p', { className: 'dim', textContent: 'Nothing.' })]
}

// Per objective: ticked or open (struck through when dropped), the work packages naming it and how many are completed.
const WP_DONE = ['completed', 'archived']
function objectivesTable(p, objectives) {
  const status = id => (p.workPackages.find(w => w.id === id) || {}).status || ''
  return tableOf(['', 'Objective', 'Work packages', 'Progress'], objectives.map(o => [
    el('span', { className: 'mono' + (o.isDropped ? ' dim' : ''), textContent: o.id }),
    o.isDropped ? el('s', { className: 'dim', textContent: o.title }) : el('span', {}, o.isMet ? el('span', { className: 'ok', textContent: '✔ ' }) : '☐ ', o.title),
    el('span', { className: 'forge' }, ...o.wps.map(id => pill(id + ' ' + status(id), WP_DONE.includes(status(id)) ? 'merged' : 'open'))),
    o.isDropped ? el('span', { className: 'dim', textContent: 'dropped' }) : o.wps.length ? el('span', {}, metBar(o.done, o.wps.length), el('span', { className: 'dim', textContent: ' completed' })) : el('span', { className: 'dim', textContent: '—' }),
  ]))
}
// The recap's objectives, right after the cards; nothing when the brief has no checklist.
function objectivesSection(p) {
  if (!liveObjectives(p).length) return null
  return el('div', {}, el('h3', {}, 'Objectives ', el('span', { style: 'text-transform: none' }, objectivesBar(p), ' met')), objectivesTable(p, p.objectives))
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
    objectivesSection(p),
    el('div', { className: 'grid2' },
      el('div', {}, el('h3', { textContent: 'Tolerances' }), tableOf(['', 'Area', 'Used / limit'], p.tolerances.map(t => [dot(t.light), t.area, t.used + ' / ' + t.limit + ' ' + t.unit + (t.isComputed ? ' · from work packages' : '')]))),
      el('div', {}, el('h3', { textContent: 'Needs attention' }), ...attention(p))),
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
  const served = (p.objectives || []).filter(o => (w.objectives || []).includes(o.id))
  return [
    el('p', {}, el('strong', { textContent: w.id + ' ' + w.title }), ' ',
      el('span', { className: 'dim', textContent: [w.status, d.issue === null ? '' : '#' + d.issue, d.milestone && 'milestone ' + d.milestone, d.ref || d.branch, d.base && 'over ' + d.base].filter(Boolean).join(' · ') }), statusAction(p, w)),
    el('div', { className: 'forge' }, ...forgePills(d)),
    // The brief objectives the work package serves, above its phases.
    ...(served.length ? [el('h3', { textContent: 'Objectives' }), objectivesTable(p, served)] : []),
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

// A work package's status, coloured like the theme lanes: completed or archived green, in progress blue.
const wpStatus = status => pill(status || 'no status', status === 'completed' || status === 'archived' ? 'ready' : status === 'in-progress' ? 'inprogress' : '')

const STATUS_LABEL = { review: 'review asked', inprogress: 'in progress', todo: 'to do', waiting: 'waiting for review', stalled: 'stalled' }
// The issues and pull requests checked on the Team and Activity tabs: one page-local selection shared by both, keyed 'i' or
// 'p' and the reference (genropy#498 on a cross-repo project), mapped to the reference; another project starts with nothing picked. A reload waits until nothing is picked.
const pickedItems = new Map()
let pickedItemsFor = ''
function itemPicks(p) {
  if (pickedItemsFor !== p.path) { pickedItems.clear(); pickedItemsFor = p.path }
  return {
    cell: (key, ref) => el('td', { className: 'sel-col' }, el('input', { type: 'checkbox', checked: pickedItems.has(key),
      onchange: () => { pickedItems.has(key) ? pickedItems.delete(key) : pickedItems.set(key, ref); draw() } })),
    rowClass: key => pickedItems.has(key) ? 'checked' : '',
    refs: [...pickedItems.values()],
    numbers: () => [...pickedItems.values()].map(r => Number(r.replace(/^(PR )?#/, ''))),
    clear: el('a', { href: '#', textContent: 'clear', onclick: e => { e.preventDefault(); pickedItems.clear(); draw() } }),
  }
}
// Member filter of the Team tab: page-local, everyone shown when none is picked; another project starts unfiltered.
// The items are checked as on the Activity tab and assigned or unassigned from the one control on top.
const picked = new Set()
let pickedFor = ''
function team(p) {
  if (pickedFor !== p.path) { picked.clear(); pickedFor = p.path }
  const shown = picked.size ? p.team.filter(m => picked.has(m.person)) : p.team
  const toggle = name => { picked.has(name) ? picked.delete(name) : picked.add(name); draw() }
  const sel = itemPicks(p)
  const assignable = canAssign(p)
  const selectionBar = !assignable ? null : sel.refs.length
    ? el('div', { className: 'activity-bar' }, el('strong', { textContent: sel.refs.length + ' selected' }), el('span', { className: 'refs', textContent: sel.refs.join(' ') }),
        assignManyControl(p, sel.numbers()), sel.clear)
    : el('div', { className: 'activity-bar idle dim', textContent: 'Check issues or pull requests to assign or unassign them.' })
  return el('div', {},
    // The roles on top, one chip each with its people; each person's card below names their own roles.
    el('div', { className: 'members' }, el('span', { className: 'label', textContent: 'Roles' }),
      ...(p.roles.length ? p.roles.map(r => pill(r.label + ' · ' + (r.people.join(', ') || '—'), r.people.length ? '' : 'notready')) : [el('span', { className: 'dim', textContent: 'none set' })])),
    el('div', { className: 'members' }, el('span', { className: 'label', textContent: 'Members' }),
      ...p.team.map(m => el('button', { className: 'member-chip' + (picked.has(m.person) ? ' sel' : ''), onclick: () => toggle(m.person) }, m.person)),
      picked.size ? el('a', { href: '#', textContent: 'all', onclick: e => { e.preventDefault(); picked.clear(); draw() } }) : null),
    selectionBar,
    ...shown.map(m => dropTarget(p, el('div', { className: 'person' + (m.isOverLimit ? ' over' : '') },
      el('div', { className: 'person-head' },
        el('div', { className: 'who' }, el('strong', { textContent: m.person }), el('small', { textContent: (m.login ? '@' + m.login : 'no forge login') + ' · ' + m.roles.join(', ') })),
        m.login ? pill('WIP ' + m.wip + '/' + m.wipLimit, m.isOverLimit ? 'wip-over' : '') : el('span', { className: 'dim', textContent: 'add team.people in project.yaml' })),
      !m.login ? null : m.items.length
        ? el('table', { className: 'rows' }, el('tbody', {}, ...m.items.map(i => draggable(p, el('tr', { className: sel.rowClass(i.kind[0] + refOf(i)) },
            assignable ? sel.cell(i.kind[0] + refOf(i), refOf(i, i.kind)) : null,
            el('td', { style: refStyle(p) }, el('a', { href: i.url, className: 'mono', textContent: refOf(i, i.kind) })),
            el('td', { textContent: i.title }),
            el('td', { className: 'dim', style: 'width:100px; white-space:nowrap', textContent: i.updatedAt }),
            el('td', { style: 'width:200px; text-align:right' }, i.kind === 'issue' ? notReadyPill(missingOf(p, i)) : null, ' ', pill(STATUS_LABEL[i.status], i.status))),
          dragItem(i.kind, Object.assign({}, (i.kind === 'pr' ? p.forgePulls : p.forgeIssues).find(x => sameItem(x, i)), { number: i.number, assignees: i.assignees || assigneesOf(p, i) }))))))
        : el('div', { className: 'empty dim', textContent: 'No open item.' }),
      actionRows(m.actions || [], false, assignable && m.login && m.items.length, refStyle(p))), x => assignRequest(x, m), m.person)),
    // The open actions of the Daily Log no person of the roles owns, last and only while no member is picked.
    !picked.size && (p.strayActions || []).length ? el('div', { className: 'person' },
      el('div', { className: 'person-head' }, el('div', { className: 'who' }, el('strong', { textContent: 'No team member' }),
        el('small', { textContent: 'open Daily Log actions owned by nobody, or by someone not in the roles' }))),
      actionRows(p.strayActions, true, false, refStyle(p))) : null)
}
// A person's open actions of the Daily Log under their issues and pull requests, assigned from the Daily log section of Registers:
// the id, the text (with the owner when it is not theirs), the due date, red once past; lead keeps a blank check column, in line
// with the checked items above; idStyle sizes the id column as the reference column above it.
function actionRows(actions, withOwner, lead, idStyle) {
  if (!actions.length) return null
  return el('table', { className: 'rows' }, el('tbody', {}, ...actions.map(d => el('tr', {}, lead ? el('td', { className: 'sel-col' }) : null,
    el('td', { className: 'mono', style: idStyle || 'width:80px; white-space:nowrap', textContent: d.id }),
    el('td', {}, d.text, withOwner ? el('span', { className: 'dim', textContent: ' · ' + (d.owner || 'no owner') }) : null),
    el('td', { style: 'width:100px; white-space:nowrap' }, dueCell(d)),
    el('td', { style: 'width:200px; text-align:right' }, pill('action', 'kind-action'))))))
}

// Activity tab: the open milestones with their work package, the open pull requests, the open issues grouped by milestone.
// The "Not ready only" toggle filters the issues, page-local like the member filter; another project starts unfiltered. The
// checked issues and pull requests are the selection shared with the Team tab (itemPicks). Without the helper the page never
// writes: Create package only opens a session.
let notReadyOnly = false
let activityFor = ''
// The package link carries the prompt last: the picked references are appended to it (hooks/actions.ts getPackageLink).
const packageLink = (p, refs) => p.packageLink + encodeURIComponent(' ' + refs.join(' '))
const blockTitle = (title, sub) => el('div', { className: 'block-title' }, el('h3', { textContent: title }), el('span', { className: 'n', textContent: sub }))
function activity(p) {
  if (activityFor !== p.path) { notReadyOnly = false; activityFor = p.path }
  const today = data.refreshedAt.slice(0, 10)
  const sel = itemPicks(p)
  const pick = isCrossRepo(p) ? () => null : sel.cell, rowClass = sel.rowClass, refs = sel.refs
  const selectionBar = isCrossRepo(p)
    ? el('div', { className: 'activity-bar idle dim', textContent: 'The issues and pull requests carrying the label of each repo in project.yaml repos:. Packaging and assigning are not available on a cross-repo project yet.' })
    : refs.length
    ? el('div', { className: 'activity-bar' }, el('strong', { textContent: refs.length + ' selected' }), el('span', { className: 'refs', textContent: refs.join(' ') }),
        server ? el('button', { className: 'btn-primary', textContent: 'Create package', onclick: () => packageDialog(p, refs) })
          : el('a', { className: 'btn btn-primary', href: packageLink(p, refs), textContent: 'Create package' }),
        assignManyControl(p, sel.numbers()), sel.clear,
        el('span', { className: 'dim hint', textContent: server ? 'previews the milestone and the work package, then writes them on Confirm' : 'opens a Claude session on ' + p.name + ' with the pm-package skill: ' + refs.join(' ') }))
    : el('div', { className: 'activity-bar idle dim', textContent: 'Check issues or pull requests to group them into a work package or assign them.' })

  const milestoneRow = m => {
    const wp = p.milestonePackages[m.title]
    return draggable(p, el('div', { className: 'ms-row' },
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
            isCrossRepo(p) ? null : server ? el('button', { textContent: 'Create work package', onclick: () => act(p, { kind: 'package', title: m.title, fromMilestone: true }) })
              : el('a', { className: 'btn', href: packageLink(p, ['--milestone', "'" + m.title + "'"]), textContent: 'Create work package' })))),
      { kind: 'milestone', ref: 'milestone ' + m.title, title: m.title })
  }

  const pullRow = pr => draggable(p, el('tr', { className: rowClass('p' + refOf(pr)) }, pick('p' + refOf(pr), refOf(pr, 'pr')),
    el('td', { style: refStyle(p) }, el('a', { href: pr.url, className: 'mono', textContent: refOf(pr, 'pr') })),
    el('td', { textContent: pr.title }),
    el('td', { style: 'width:220px; text-align:right' }, pr.milestone ? pill(pr.milestone) : null, ' ', pr.draft ? pill('draft') : pr.inReview ? pill('in review', 'review') : null),
    el('td', { className: 'dim', style: 'width:100px; white-space:nowrap', textContent: pr.updatedAt })), dragItem('pr', pr))

  const issueRow = i => draggable(p, el('tr', { className: rowClass('i' + refOf(i)) }, pick('i' + refOf(i), refOf(i)),
    el('td', { style: refStyle(p) }, el('a', { href: i.url, className: 'mono', textContent: refOf(i) })),
    el('td', { textContent: i.title }),
    el('td', { style: 'width:220px; text-align:right' }, notReadyPill(i.missing || [])),
    el('td', { className: 'dim', style: 'width:100px; white-space:nowrap', textContent: i.updatedAt })), dragItem('issue', i))

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

// Documents: the products of .pm/, then each folder of the project.yaml documents key with its files. A Markdown one opens
// rendered as HTML when the desk helper serves the page (docLink).
function documents(p) {
  const own = p.documents.filter(d => !d.folder)
  const folders = [...new Set(p.documents.filter(d => d.folder).map(d => d.folder))]
  return el('div', {},
    p.documents.length ? null : el('p', { className: 'dim', textContent: 'None yet.' }),
    own.length ? tableOf(['Document', 'Status', 'Version'], own.map(d => [docLink(d.path, d.title), d.status, d.version])) : null,
    // Every folder's File column has the same width, so the folders line up one under the other.
    ...folders.map(f => el('div', { className: 'doc-folder' },
      el('h3', { textContent: f }),
      tableOf(['Document', 'File'], p.documents.filter(d => d.folder === f).map(d => [docLink(d.path, d.title), el('span', { className: 'dim mono', textContent: d.path.split('/').pop() })])))))
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

// Work packages grouped by roadmap horizon: Now, Next, Later in p.roadmap order, then every other one as Not placed (open with
// no horizon, or closed). Estimate, actual and deviation are columns only when some work package carries one of them.
const HORIZONS = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']]
function workPackages(p) {
  if (!p.workPackages.length) return el('p', { className: 'dim', textContent: "None yet: run /pm-initiate or /pm-package in the project's repo." })
  const byId = ids => ids.map(id => p.workPackages.find(w => w.id === id)).filter(Boolean)
  const placed = new Set(HORIZONS.flatMap(([key]) => p.roadmap[key]))
  const hasEffort = p.workPackages.some(w => w.estimate !== null || w.actual !== null)
  const head = ['', 'Title', 'Stage', 'Status', 'Team manager', 'Due', ...(hasEffort ? ['Estimate', 'Actual', 'Deviation'] : []), '']
  // The id opens the work package's own page when it has one (a delivery to follow), else its file; the last cell holds the actions,
  // Link… only while nothing is linked.
  const row = w => [w.delivery ? link(w.id, p.path + '/theme/' + w.id) : fileLink(w.path, w.id), w.title, w.stage === null ? '' : String(w.stage), wpStatus(w.status), w.teamManager, w.due,
    ...(hasEffort ? [hours(w.estimate), w.tracked != null ? el('span', { title: 'from the timesheets', textContent: hours(w.actual) + ' ⏱' }) : hours(w.actual), w.deviation === null ? '' : signed(w.deviation)] : []),
    el('div', { className: 'row-actions' }, statusAction(p, w), w.delivery ? null : linkAction(p, w))]
  const groups = [...HORIZONS.map(([key, label]) => [label, byId(p.roadmap[key])]), ['Not placed', p.workPackages.filter(w => !placed.has(w.id))]]
  const empty = groups.filter(g => !g[1].length).map(g => g[0])
  const canPlace = server && !p.pmRef && p.workPackages.some(isOpenWp)
  // Placed by drag and drop: an open work package's row is dragged; a horizon's row takes it above or below itself (by the half
  // of the row under the pointer), the group's title takes it last, Not placed anywhere takes it off the roadmap.
  const placeRow = (tr, w, key) => {
    if (!isOpenWp(w)) return tr
    draggable(p, tr, { kind: 'wp', ref: w.id, id: w.id, isPlaced: Boolean(w.horizon) || (w.rank !== null && w.rank !== undefined) })
    const side = e => e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2 ? 'below' : 'above'
    return key ? dropTarget(p, tr, (x, e) => placeRequest(p, x, key, w.id, side(e))) : tr
  }
  // An empty group is still a drop zone while work packages can be placed: with nothing placed yet, Now, Next and Later have
  // no row to drop on.
  const group = (label, list) => {
    const key = (HORIZONS.find(h => h[1] === label) || [''])[0]
    const body = list.length ? tableOf(head, list.map(row), (tr, i) => placeRow(tr, list[i], key)) : el('div', { className: 'drop-zone', textContent: 'Drop a work package here' })
    const block = el('div', {}, blockTitle(label, String(list.length)), body)
    return canPlace ? dropTarget(p, block, (x, e) => key && e.target.closest && e.target.closest('tbody tr') ? null : placeRequest(p, x, key), label) : block
  }
  return el('div', {},
    p.effort ? el('p', { textContent: stageEffort(p.effort) }) : null,
    canPlace ? el('p', { className: 'dim', textContent: 'Drag a work package to another horizon, or above or below another one, to place it.' }) : null,
    ...groups.filter(g => canPlace || g[1].length).map(([label, list]) => group(label, list)),
    empty.length && !canPlace ? el('p', { className: 'dim', textContent: 'Empty: ' + empty.join(' · ') + (placed.size ? '' : " — run /pm-roadmap in the project's repo to place them") }) : null)
}
const isOpenWp = w => !['completed', 'archived', 'cancelled'].includes(w.status)

// Registers: one section per PRINCE2 register, the non-empty ones first; the empty ones share one line naming the skill that starts
// each. The PRINCE2 issue register is called Problems here, next to the forge's issues. Risks and problems list every entry, the
// open ones first; a closed one is dimmed. Entry: [id, label, size(p), subtitle(p), skill that starts it, render(p)].
const openFirst = rows => rows.filter(r => isOpen(r.status)).concat(rows.filter(r => !isOpen(r.status)))
const dimUnlessOpen = (status, cells) => isOpen(status) ? cells : cells.map(c => el('span', { className: 'dim' }, c))
// A risk's response: its type, then the actions taken (red "no response" on an open risk without them); the verdict: Claude's
// assessment of those actions, an icon and its one line of reasoning.
const riskResponse = r => r.responseActions ? el('span', {}, r.response ? el('span', { className: 'dim', textContent: r.response + ' · ' }) : null, r.responseActions)
  : el('span', { className: isOpen(r.status) ? 'err' : 'dim', textContent: (r.response ? r.response + ' · ' : '') + 'no response' })
const riskVerdict = r => !r.responseActions ? '' : r.verdict === 'adequate' ? el('span', {}, el('span', { className: 'ok', textContent: '✔ adequate' }), r.verdictReason ? el('div', { className: 'dim', textContent: r.verdictReason }) : null)
  : r.verdict === 'not-adequate' ? el('span', {}, el('span', { className: 'err', textContent: '✘ not adequate' }), r.verdictReason ? el('div', { className: 'dim', textContent: r.verdictReason }) : null)
  : el('span', { className: 'dim', textContent: 'not assessed' })
const riskRow = r => dimUnlessOpen(r.status, [r.id, r.title, r.probability + ' × ' + r.impact + ' = ' + r.score, riskResponse(r), riskVerdict(r), r.status])
const REGISTERS = [
  ['risks', 'Risks', p => p.risks.length, p => p.risks.filter(r => isOpen(r.status)).length + ' open', '/pm-risk',
    p => tableOf(['', 'Risk', 'P × I', 'Response', 'Verdict', 'Status'], openFirst(p.risks).map(riskRow))],
  ['approvals', 'Approvals', p => p.approvals.length, p => String(p.approvals.length), '/pm-start-up',
    p => tableOf(['Date', 'Decision', 'By', 'Note'], p.approvals.map(a => [a.date, a.decision, a.by, a.note]))],
  ['problems', 'Problems', p => p.issues.length, p => p.issues.filter(i => isOpen(i.status)).length + ' open', '/pm-log',
    p => tableOf(['', 'Problem', 'Type', 'Priority', 'Status'], openFirst(p.issues).map(i => dimUnlessOpen(i.status, [i.id, i.title, i.type, i.priority, i.status])))],
  ['lessons', 'Lessons', p => p.actions.length + p.lessons.length + (p.lastRetro ? 1 : 0), p => openActions(p).length + ' open actions', '/pm-retro', lessons],
  ['iterations', 'Iterations', p => p.iterations.length, p => String(p.iterations.length), '/pm-iterate', iterations],
  // The Daily Log closes the tab: the longest register, with filters of its own.
  ['log', 'Daily log', p => logOf(p).length, p => openLogActions(p).length + ' open actions', '/pm-log', dailyLog],
]
// The tab count: open risks, open problems, open actions of the Lessons and the Daily Log.
const registersCount = p => p.risks.filter(r => isOpen(r.status)).length + p.issues.filter(i => isOpen(i.status)).length + openActions(p).length + openLogActions(p).length
function registers(p) {
  const full = REGISTERS.filter(r => r[2](p))
  const empty = REGISTERS.filter(r => !r[2](p))
  return el('div', {},
    ...full.map(([id, label, , sub, , render]) => el('div', { id: 'register-' + id }, blockTitle(label, sub(p)), render(p))),
    empty.length ? el('p', { className: 'dim', textContent: 'Empty: ' + empty.map(r => r[1] + ' (' + r[4] + ')').join(' · ') }) : null)
}

// The Daily Log: a filter bar (day, kinds, free text), then a block per day, newest first, its entries in file order; an open action
// past its due is red; every column but the entry stays on one line. Each kind has its colour, each source its symbol. The filters
// are page-local, like the Activity ones: another project starts unfiltered, and the page does not reload itself while a filter is
// set. A change redraws only the list, so the search box keeps the focus. p.dailyLog is missing on a project built by older code:
// read as empty.
const logOf = p => p.dailyLog || []
const openLogActions = p => logOf(p).filter(d => d.status === 'open')
const logText = d => d.text + (d.ref ? ' ' + d.ref : '') + (d.register ? ' → ' + d.register : '')
const LOG_KINDS = ['event', 'decision', 'action', 'problem', 'note']
const LOG_SOURCES = { forge: ['⑂', 'from the forge'], meeting: ['◎', 'from a meeting'], manual: ['✎', 'from notes'] }
const logFilter = { day: '', kinds: new Set(), text: '' }
let logFor = ''
const isLogFiltered = () => Boolean(logFilter.day || logFilter.kinds.size || logFilter.text)
const logHaystack = d => [d.id, d.kind, d.source, d.text, d.ref, d.register, d.owner, d.due, d.status, d.issue === null ? '' : '#' + d.issue].join(' ').toLowerCase()
const logMatches = d => (!logFilter.day || d.date === logFilter.day) && (!logFilter.kinds.size || logFilter.kinds.has(d.kind))
  && logFilter.text.toLowerCase().split(/\\s+/).filter(Boolean).every(w => logHaystack(d).includes(w))
const logKind = d => {
  const source = LOG_SOURCES[d.source]
  return el('span', {}, pill(d.kind || '—', 'kind-' + d.kind),
    d.source ? el('span', { className: 'log-source', title: source ? source[1] : d.source, textContent: source ? source[0] : d.source }) : null)
}
const dueCell = d => d.isOverdue ? el('span', { className: 'err', textContent: d.due }) : d.due
// The open actions checked in the Daily Log, given an owner or relieved of it from the one control on top: page-local like the
// filters, another project starts with none; a reload waits until none is checked. Only with the helper, and never on a project
// whose .pm/ is read from git. The people offered are those of the roles, by name (a note in brackets dropped), not only those
// with a forge login.
const pickedActions = new Set()
const canOwn = p => server && !p.pmRef && p.team.length > 0
const nameOf = m => m.name || m.person
const isOpenAction = d => d.kind === 'action' && d.status === 'open'
function ownerControl(p, ids) {
  const names = [...new Map(p.team.map(m => [nameOf(m).toLowerCase(), nameOf(m)])).values()]
  const pick = el('select', { className: 'assign', title: 'set or remove the owner of the selected actions',
    onchange: () => { const owner = pick.value; pick.value = ''; if (owner) act(p, { kind: 'log-owner', ids, owner: owner === '-' ? '' : owner }) } },
    el('option', { value: '', textContent: 'Assign to…' }), el('optgroup', { label: 'Assign' }, ...names.map(n => el('option', { value: n, textContent: '+ ' + n }))),
    el('optgroup', { label: 'Unassign' }, el('option', { value: '-', textContent: '− no owner' })))
  return pick
}
function logDays(p, entries, onPick) {
  if (!entries.length) return [el('p', { className: 'dim', textContent: 'No entry matches the filters.' })]
  const days = [...new Set(entries.map(d => d.date))].sort().reverse()
  const pickCell = d => el('td', { className: 'sel-col' }, isOpenAction(d) ? el('input', { type: 'checkbox', title: 'select ' + d.id, checked: pickedActions.has(d.id),
    onchange: () => { pickedActions.has(d.id) ? pickedActions.delete(d.id) : pickedActions.add(d.id); onPick() } }) : null)
  const decorate = list => (tr, i) => { if (onPick) { tr.prepend(pickCell(list[i])); tr.classList.toggle('checked', pickedActions.has(list[i].id)) } return tr }
  return days.map(day => {
    const list = entries.filter(d => d.date === day)
    const table = tableOf(['', 'Kind', 'Entry', 'Issue', 'Owner', 'Due', 'Status'], list.map(d => dimUnlessOpen(d.status || 'open',
      [d.id, logKind(d), logText(d), d.issue === null ? '' : issueLink(p, d.issue), d.owner, dueCell(d), d.status])), decorate(list))
    if (onPick && table.tHead) table.tHead.rows[0].prepend(el('th', { className: 'sel-col' }))
    return el('div', { className: 'log-day' }, el('h3', { textContent: day }), table)
  })
}
function dailyLog(p) {
  if (logFor !== p.path) { logFilter.day = ''; logFilter.kinds.clear(); logFilter.text = ''; pickedActions.clear(); logFor = p.path }
  const list = el('div', {})
  const bar = el('div', {})
  const owning = canOwn(p)
  function showBar() {
    for (const id of [...pickedActions]) if (!logOf(p).some(d => d.id === id && isOpenAction(d))) pickedActions.delete(id)
    const ids = logOf(p).filter(d => pickedActions.has(d.id)).map(d => d.id)
    const clearPicks = el('a', { href: '#', textContent: 'clear', onclick: e => { e.preventDefault(); pickedActions.clear(); show() } })
    fill(bar, ids.length
      ? el('div', { className: 'activity-bar' }, el('strong', { textContent: ids.length + ' selected' }), el('span', { className: 'refs', textContent: ids.join(' ') }), ownerControl(p, ids), clearPicks)
      : el('div', { className: 'activity-bar idle dim', textContent: 'Check open actions to assign them or remove their owner.' }))
  }
  const count = el('span', { className: 'n' })
  const kinds = LOG_KINDS.filter(k => logOf(p).some(d => d.kind === k))
  const chips = kinds.map(k => el('button', { className: 'member-chip' + (logFilter.kinds.has(k) ? ' sel' : ''), textContent: k,
    onclick: () => { logFilter.kinds.has(k) ? logFilter.kinds.delete(k) : logFilter.kinds.add(k); chips.forEach((c, i) => c.classList.toggle('sel', logFilter.kinds.has(kinds[i]))); show() } }))
  const day = el('select', { title: 'day', onchange: () => { logFilter.day = day.value; show() } }, el('option', { value: '', textContent: 'All days' }),
    ...[...new Set(logOf(p).map(d => d.date))].sort().reverse().map(d => el('option', { value: d, textContent: d, selected: d === logFilter.day })))
  const search = el('input', { type: 'search', placeholder: 'Search the log', value: logFilter.text, oninput: () => { logFilter.text = search.value; show() } })
  const clear = el('a', { href: '#', textContent: 'clear', onclick: e => {
    e.preventDefault(); logFilter.day = ''; logFilter.kinds.clear(); logFilter.text = ''; day.value = ''; search.value = ''; chips.forEach(c => c.classList.remove('sel')); show() } })
  function show() {
    const entries = logOf(p).filter(logMatches)
    count.textContent = isLogFiltered() ? entries.length + ' of ' + logOf(p).length + ' entries' : logOf(p).length + ' entries'
    clear.hidden = !isLogFiltered()
    fill(list, ...logDays(p, entries, owning ? show : null))
    if (owning) showBar()
    if (list.isConnected) tidyTables(list)
  }
  show()
  return el('div', {}, el('div', { className: 'log-filters' }, day, ...chips, search, count, clear), owning ? bar : null, list)
}

// Board: a swimlane per work package with a milestone (p.lanes, hooks/lanes.ts), its open items in To do / In progress / In review,
// the milestone's closed count as Done; a completed or archived package with open items is flagged reopened; the last lane holds
// the open items of no work package. p.lanes is missing on a page built by older code: read as empty.
const LANE_COLUMNS = [['todo', 'To do'], ['inprogress', 'In progress'], ['review', 'In review']]
const lanesOf = p => p.lanes || []
const unplannedCount = p => { const last = lanesOf(p).find(l => !l.wp); return last ? last.cards.length : 0 }
function boardCard(c) {
  return el('div', { className: 'bcard', title: (c.kind === 'pr' ? 'pull request ' : 'issue ') + refOf(c) },
    el('a', { href: c.url, className: 'mono', textContent: refOf(c, c.kind) }), ' ', c.title,
    c.milestone && !c.inLane ? el('span', { className: 'ms', textContent: ' · ' + c.milestone }) : null,
    c.assignees.length ? el('span', { className: 'who', textContent: c.assignees.map(a => '@' + a).join(' ') }) : el('span', { className: 'who none', textContent: 'unassigned' }))
}
function boardLane(p, l) {
  const cardOf = c => draggable(p, boardCard(Object.assign({ inLane: Boolean(l.wp) }, c)), dragItem(c.kind, c))
  const column = (key, label) => {
    const list = l.cards.filter(c => c.column === key)
    const col = el('div', { className: 'lane-col' }, el('h4', { textContent: label + ' · ' + list.length }), ...list.map(c => { const node = cardOf(c); node.dataset.number = String(c.number); node.dataset.kind = c.kind; return node }))
    col.dataset.column = key
    return col
  }
  const unassigned = l.cards.filter(c => !c.assignees.length).length
  const lane = el('div', { className: 'lane' + (l.reopened ? ' reopened' : '') + (l.wp ? '' : ' unplanned') },
    el('div', { className: 'lane-head' },
      l.wp ? el('strong', {}, el('span', { className: 'mono', textContent: l.wp + ' ' }), l.title) : el('strong', { textContent: 'Unplanned' }),
      l.wp ? wpStatus(l.status) : el('span', { className: 'dim', textContent: 'open items in no work package' }),
      l.milestone ? el('span', { className: 'dim', textContent: 'milestone ' + l.milestone }) : null,
      l.progress ? el('span', { title: 'milestone items closed' }, bar(l.progress.closed, l.progress.total)) : null,
      l.reopened ? pill('reopened: ' + l.reopened + ' open', 'review') : null,
      unassigned ? pill(unassigned + ' unassigned', 'red') : null,
      l.wp && issueTargets(p).some(w => w.id === l.wp) ? newIssueButton(p, l.wp, '+ issue') : null),
    el('div', { className: 'lane-cols' }, ...LANE_COLUMNS.map(([key, label]) => column(key, label)),
      el('div', { className: 'lane-col' }, el('h4', { textContent: 'Done' }),
        l.progress ? el('div', { className: 'lane-done', textContent: l.progress.closed + ' closed' }) : el('div', { className: 'dim', textContent: '—' }))))
  lane.dataset.wp = l.wp
  const w = l.wp && p.workPackages.find(x => x.id === l.wp)
  return w ? dropTarget(p, lane, x => wpRequest(p, x, w), w.id + ' ' + w.title) : lane
}
// The board header: the text on the left, the New issue button on the right of the same line at any width (issue #66).
const boardHead = (p, text) => el('div', { className: 'board-head' }, el('p', { className: 'dim', textContent: text }),
  newIssueButton(p, '', 'New issue', 'btn-primary new-issue'))
function board(p) {
  const lanes = lanesOf(p)
  if (lanes.length <= 1 && !unplannedCount(p)) return boardHead(p, "No work package with a milestone and no open item: run /pm-link or /pm-package in the project's repo.")
  return el('div', {}, boardHead(p, "Open items by work package: To do, In progress, In review; Done is the milestone's closed count. The tab count is the open items in no work package. " +
    'An issue is in progress from its first commit, or once a pull request closes it; assigned alone it is still to do.'),
    ...lanes.map(l => boardLane(p, l)))
}

// One entry per tab after Recap: [id, label, count(p), render(p)].
const TABS = [
  ['board', 'Board', unplannedCount, board],
  ['activity', 'Activity', p => p.forgeIssues.length + p.forgePulls.length, activity],
  ['team', 'Team', p => p.team.length, team],
  ['wps', 'Work packages', p => p.workPackages.length, workPackages],
  ['documents', 'Documents', p => p.documents.length, documents],
  ['registers', 'Registers', registersCount, registers],
  ['metrics', 'Metrics', p => p.flow ? p.flow.windows[0].merge.count : 0, metrics],
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
      p.pmRef ? el('p', { className: 'warn', textContent: '.pm/ read from ' + p.pmRef + ' — the checkout has no .pm/, so the desk is read-only until it does' }) : null,
      el('div', { className: 'head-side' }, clockBar(), sessionLink(p))),
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
  const app = document.getElementById('app')
  app.replaceChildren(...(p ? form(p, route.slice(p.path.length + 1)) : overview()))
  tidyTables(app)
}
// A narrower window may need columns back to wrapping, a wider one lets them stay on one line.
let tidyTimer = 0
addEventListener('resize', () => { clearTimeout(tidyTimer); tidyTimer = setTimeout(() => tidyTables(document.getElementById('app')), 150) })

draw()
readClock()
// A reload would drop the picked issues and pull requests: it waits until nothing is picked.
// An open dialog holds it too, and so does a drag in progress.
setInterval(() => { if (dialogOpen || dragging) return; if (isLogFiltered()) return; if (!pickedItems.size && !pickedActions.size) location.reload() }, data.reloadMs)
`
