import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'

const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/plain\n  - path: /t/other\n',
  '/t/plain/.pm/project.yaml': 'name: Plain\n',
  '/t/other/.pm/project.yaml': 'name: Other\n',
}
// The test sandbox forbids new Function: the page script is read as text.
const script = () => {
  const page = renderBoard({ projects: [buildProject({ path: '/t/plain', project: FILES['/t/plain/.pm/project.yaml'], products: [], workPackages: [] }, '2026-11-27')], refreshedAt: 0, errors: [] })
  return page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
}
const bodyOf = (code: string, start: string) => code.split(start)[1].split('\n}\n')[0]

test('each contextual button sits by what it acts on and opens its dialog', () => {
  // wf:contract: Small `act` buttons (issue #94): Log by the Daily log, + problem by Problems, + risk by Risks, Iterate by Iterations
  // wf:contract: (next to the register's title, or its name on the Empty line), + document on the Documents tab, + report in the Next
  // wf:contract: report card; each opens its dialog.
  const code = script()
  expect(code).toContain("const contextButton = (label, title, open) => el('button', { className: 'act'")
  for (const [id, label, dialog] of [['risks', '+ risk', 'riskDialog'], ['problems', '+ problem', 'problemDialog'], ['iterations', '+ iteration', 'iterateDialog'], ['log', '+ log', 'logDialog']]) {
    expect(code).toContain(`  ${id}: p => contextButton('${label}', `)
    expect(code).toContain(`() => ${dialog}(p)),`)
  }
  expect(bodyOf(code, 'function registers(p) {')).toContain('title.append(action)')
  expect(bodyOf(code, 'function registers(p) {')).toContain("r[1] + ' (' + r[4] + ')', registerAction(p, r[0])")
  expect(bodyOf(code, 'function documents(p) {')).toContain("contextButton('+ document', ")
  expect(bodyOf(code, 'function recap(p) {')).toContain("card('Next report', el('span', {}, p.nextReport.due || '—', contextButton('+ report', ")
  expect(code).not.toContain('${')
})

test('every dialog opens Claude with its skill and the fields typed; Preview only where the helper writes, and only with it', () => {
  // wf:contract: formDialog adds an `Open in Claude` link built with skillLink(p, <skill>, <args from the fields>) to every dialog, and
  // wf:contract: Preview only when the dialog has a helper request and canWrite(p) (helper running, .pm/ not read from git).
  // wf:contract: Helper requests: log-add, problem-add, risk-add, issue-create; + document, + report and + iteration open Claude only.
  const code = script()
  expect(code).toContain('const canWrite = p => Boolean(server) && !p.pmRef')
  expect(bodyOf(code, 'function claudeLink(p, skill, args) {')).toContain("textContent: 'Open in Claude'")
  expect(bodyOf(code, 'function claudeLink(p, skill, args) {')).toContain('a.href = skillLink(p, skill, args())')
  expect(bodyOf(code, 'function formDialog(')).toContain('const writes = Boolean(request) && canWrite(p)')
  expect(bodyOf(code, 'function formDialog(')).toContain("claudeLink(p, skill, args), writes ? el('button', { className: 'primary', textContent: 'Preview'")
  const dialogs: [string, string, string | null][] = [['logDialog', 'pm-log', 'log-add'], ['problemDialog', 'pm-problem', 'problem-add'], ['riskDialog', 'pm-risk', 'risk-add'],
    ['issueDialog', 'pm-issue', 'issue-create'], ['documentDialog', 'pm-document', null], ['reportDialog', 'pm-report', null], ['iterateDialog', 'pm-iterate', null]]
  for (const [name, skill, kind] of dialogs) {
    const body = bodyOf(code, `function ${name}(p`)
    expect(body).toContain(`'${skill}'`)
    if (kind) expect(body).toContain(`kind: '${kind}'`)
    else expect(body).toMatch(/, null, \w+\)$/)
  }
  // The + issue dialog no longer links pm-issue in its text: Open in Claude does.
  expect(code).not.toContain('draft it with pm-issue')
  // The dialog fields the user agreed on.
  expect(code).toContain("const LOG_ENTRY_KINDS = ['decision', 'action', 'problem', 'event', 'note']")
  expect(code).toContain("const DOCUMENT_TYPES = ['Exception Report', 'Checkpoint Report', 'End Stage Report', 'End Project Report', 'Lessons Report', 'Free document']")
  for (const field of ["formRow('Cause', cause)", "formRow('Probability', probability)", "formRow('Impact', impact)", "formRow('Owner', owner)", "formRow('Response', response)", "formRow('Actions', actions)"]) {
    expect(bodyOf(code, 'function riskDialog(p')).toContain(field)
  }
  expect(bodyOf(code, 'function iterateDialog(p')).toContain("formRow('Work packages', wps)")
})

test('Draft with Claude: the four dialogs the helper writes carry it, the Open-in-Claude-only ones do not', () => {
  // wf:contract: Issue #95: a `Draft with Claude` button in + issue, + risk, + problem and + log, only with the helper and .pm/ not read
  // wf:contract: from git (canWrite); it POSTs { project, target, fields } to /draft and fills the dialog's controls with the answer.
  // wf:contract: + document, + report and + iteration get none.
  const code = script()
  expect(bodyOf(code, 'function formDialog(')).toContain('const drafting = draft && canWrite(p) ? draftControl(p, draft) : null')
  expect(bodyOf(code, 'function formDialog(')).toContain("buttons(closeButton('Cancel'), drafting && drafting.button, claudeLink(p, skill, args)")
  const control = bodyOf(code, 'function draftControl(p, draft) {')
  expect(control).toContain("textContent: 'Draft with Claude'")
  expect(control).toContain("post({ project: p.path, target: draft.target, fields: draft.read() }, '/draft')")
  expect(control).toContain("'Drafting with Claude… '")
  expect(control).toContain("if (document.getElementById('dialog') !== dialog) return")
  expect(control).toContain('setField(draft.controls[key], value)')
  expect(code).toContain("async function post(body, path = '/action') {")
  for (const [name, target] of [['issueDialog', 'issue'], ['riskDialog', 'risk'], ['problemDialog', 'problem'], ['logDialog', 'log']]) {
    expect(bodyOf(code, `function ${name}(p`)).toContain(`{ target: '${target}', read: () => `)
  }
  for (const name of ['documentDialog', 'reportDialog', 'iterateDialog']) {
    const body = bodyOf(code, `function ${name}(p`)
    expect(body).not.toContain('target:')
    expect(body).toMatch(/, null, \w+\)$/)
  }
})

test('an empty Problems register points at /pm-problem, in the page and the pane', async ($, on) => {
  expect(script()).toContain("p => p.issues.filter(i => isOpen(i.status)).length + ' open', '/pm-problem',")
  mock.store(on)
  await mock.clock(on).set(Date.parse('2026-11-27T12:00:00Z'))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run({ command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } })
  const ui = await $.ui.mount({
    plugin: 'p2kit', component: 'Pane', requestId: 'p2kit-desk', surface: 'desktop',
    props: { title: 'Project desk', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
  })
  await ui.press({ key: 'open:/t/plain' })
  await ui.press({ key: 'tab:registers' })
  expect(await ui.find({ type: 'Text', text: /^Empty: .*Problems \(\/pm-problem\)/ })).toBeTruthy()
  await ui.unmount()
})
