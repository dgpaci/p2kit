import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { openFile, openSession } from './actions'
import { getOpenBlockers, renderBoard } from './board'
import type { CommitNote, Light, MilestoneItem, Phase, PhaseState, Project, Pull, TeamMember, TeamStatus, WorkPackage, WpDelivery, WpForge } from '../types'
import { EditError, setFrontmatterKey, setNoteStatus, setWpStatus } from './edits'
import type { LineChange } from './edits'
import { getFlowCell } from './flow'
import { getBoardLanes } from './lanes'
import { getItemProgress, getMilestonePackage } from './milestones'
import { getWorkThemes, loadProjects } from './project'
import { getDeskServer } from './server'
import { toSnapshot } from './snapshot'

const PANE = 'p2kit-desk'
const TITLE = 'Project desk'
// Local files only: cheap to read again.
const REFRESH_MS = 60 * 1000
// The browser board, under the home folder.
const BOARD_PATH = '.claude/p2kit/desk.html'
const SNAPSHOT_PATH = '.claude/p2kit/desk.json'
// Stamped by the desk helper after each write (server/desk_server.py mark_changed): `{ at }` in epoch ms.
const CHANGED_PATH = '.claude/p2kit/desk-changed.json'

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const projects = atom({ plugin: 'p2kit', key: 'projects' } as const, [], { shape: 'projects-15' })
const selected = atom({ plugin: 'p2kit', key: 'selected' } as const, '', { shape: 'selected-1' })
// The chosen project's body: '' the recap, `tab:<id>`, `theme:<WP-id>`.
const view = atom({ plugin: 'p2kit', key: 'view' } as const, '', { shape: 'view-1' })
// The people the Team tab shows; none picked shows everyone.
const members = atom({ plugin: 'p2kit', key: 'members' } as const, [], { shape: 'members-1' })
// The Activity tab shows only the issues missing a readiness heading.
const notReadyOnly = atom({ plugin: 'p2kit', key: 'notReadyOnly' } as const, false, { shape: 'not-ready-only-1' })
const meta = atom(
  { plugin: 'p2kit', key: 'meta' } as const,
  { refreshedAt: 0, errors: [], isLoading: false },
  { shape: 'meta-1' },
)

const LIGHT_COLOR: Record<Light, string> = { green: 'green', amber: 'yellow', red: 'red', none: 'gray' }
const PHASE_COLOR: Record<PhaseState, string> = { done: 'green', 'in-progress': 'cyan', todo: 'gray', failed: 'red', blocked: 'yellow' }
const PULL_COLOR: Record<Pull['state'], string> = { open: 'cyan', merged: 'green', closed: 'gray' }
const ITEM_COLOR: Record<MilestoneItem['state'], string> = { open: 'yellow', merged: 'green', closed: 'gray' }
const STATUS_LABEL: Record<TeamStatus, string> = { review: 'review asked', inprogress: 'in progress', todo: 'to do', waiting: 'waiting for review', stalled: 'stalled' }
const FLOW_ROWS: [string, 'leadTime' | 'firstReview' | 'merge'][] = [['Lead time', 'leadTime'], ['Review (opened → first review)', 'firstReview'], ['Merge (opened → merged)', 'merge']]
// The longest weekly bar of the Metrics tab, in characters.
const METRICS_BAR = 20
const WP_COLOR: Record<string, string> = { completed: 'green', 'in-progress': 'cyan', authorized: 'white', draft: 'gray', cancelled: 'gray', archived: 'gray' }

// The automatic refresh; a reload of the module starts a new one.
let timer: Timer | undefined

async function getBoardPath($: EngineInterface): Promise<string> {
  return `${await $.env.get('HOME')}/${BOARD_PATH}`
}

const getStageLabel = (project: Project): string =>
  project.stage.current === null ? 'no stage' : `stage ${project.stage.current}${project.stage.name ? ` ${project.stage.name}` : ''}`

/** `<start> → <end>`; a continuous stage has no end: `since <start> · continuous`. */
const getStageSpan = ({ stage }: Project): string =>
  stage.isContinuous ? `since ${stage.start || '—'} · continuous` : `${stage.start || '—'} → ${stage.plannedEnd || '—'}`

/** The forge's word on a work package in one line: issue and state, milestone closed/total, pull requests. */
function getForgeLine(forge: WpForge): string {
  const open = forge.pulls.filter(pull => pull.state === 'open').length
  return [
    forge.issue ? `#${forge.issue.number} · ${forge.issue.state}` : '',
    forge.milestone ? `${forge.milestone.title} ${forge.milestone.closed}/${forge.milestone.open + forge.milestone.closed}` : '',
    forge.pulls.length ? `PRs ${forge.pulls.length}${open ? ` (${open} open)` : ''}` : '',
  ].filter(Boolean).join(' · ')
}

/** `phases 2/5` from the plan; with no plan, `items 18/19 closed` from the milestone; '' with neither. */
function getThemeProgress(delivery: WpDelivery): string {
  const items = getItemProgress(delivery.forge)
  return delivery.summary.total ? `phases ${delivery.summary.done}/${delivery.summary.total}` : items ? `items ${items.done}/${items.total} closed` : ''
}

/** `▓▓░░░ 2/5`: completed work packages of the current stage; a continuous stage, which has no end, counts them: `3 open · 12 completed`. */
function getProgressBar({ progress: { done, total }, stage }: Project): string {
  if (stage.isContinuous) return `${total - done} open · ${done} completed`
  const width = 10
  const filled = total ? Math.round((width * done) / total) : 0
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${done}/${total}`
}

/** Hours with their sign: "+4h", "0h", "-3h". */
const getSignedHours = (hours: number): string => `${hours > 0 ? '+' : ''}${hours}h`

/** "Stage <n> effort: <actual>h of <estimate>h, deviation <signed>h over <counted> work packages". */
const getStageEffortLine = ({ stage, actual, estimate, deviation, counted }: NonNullable<Project['effort']>): string =>
  `Stage ${stage} effort: ${actual}h of ${estimate}h, deviation ${getSignedHours(deviation)} over ${counted} work packages`

/** "est <e>h · act <a>h · <signed>h" for the figures a work package has; '' with none. */
const getWpEffortText = ({ estimate, actual, deviation }: WorkPackage): string =>
  [estimate === null ? '' : `est ${estimate}h`, actual === null ? '' : `act ${actual}h`, deviation === null ? '' : getSignedHours(deviation)].filter(Boolean).join(' · ')

const HORIZON_LABEL = { now: 'Now', next: 'Next', later: 'Later' } as const
// The open columns of a Board lane in the pane.
const BOARD_COLUMNS = [['todo', 'To do'], ['inprogress', 'In progress'], ['review', 'In review']] as const

const getWipText = (member: TeamMember): string => `WIP ${member.person} ${member.wip}/${member.wipLimit}`

/** Rewrites the browser board from the projects as they stand, and the JSON snapshot beside it; a failed snapshot is only logged. */
async function writeBoard($: EngineInterface): Promise<void> {
  const state = await read($, meta)
  const input = { projects: await read($, projects), refreshedAt: state.refreshedAt, errors: state.errors }
  await $.fs.write(await getBoardPath($), renderBoard(input))
  // Before the first read there is nothing to snapshot: a skill would take the empty list for an unregistered repo.
  if (!state.refreshedAt && !input.projects.length) return
  await $.fs.write(`${await $.env.get('HOME')}/${SNAPSHOT_PATH}`, toSnapshot(input))
    .catch(error => $.ui.log(`p2kit: snapshot not written: ${String(error)}`, { to: 'debug' }))
}

/** Opens the browser board, written afresh first: served by the desk helper when python3 runs it, else the read-only file. */
async function openBoard($: EngineInterface): Promise<void> {
  await writeBoard($)
  const url = await getDeskServer($, () => void reloadAfterWrite($))
  await openFile($, url || await getBoardPath($))
}

/** Reads the projects again after the helper wrote a file, once any refresh under way is over: the page waits for it. */
async function reloadAfterWrite($: EngineInterface): Promise<void> {
  for (let waited = 0; (await read($, meta)).isLoading && waited < REFRESH_MS; waited += 1000) await $.clock.sleep(1000)
  await reload($, true)
}

/** "WP-03 Title" when the file is under .pm/, else the path: what a confirmation names. */
const getPmName = (path: string): string => path.split('/.pm/')[1] ?? path

/**
 * One line of a .pm/ file changed from the pane: the dialog shows the line before and after, and the file is written only
 * if it is still as read. Nothing is committed; the desk is read again after the write.
 */
async function editFromPane($: EngineInterface, path: string, summary: string, edit: (text: string) => LineChange, note = ''): Promise<void> {
  let change: LineChange
  let text: string
  try {
    text = await $.fs.read(path)
    change = edit(text)
  } catch (error) {
    $.ui.toast(`${summary}: ${error instanceof EditError ? error.message : String(error)}`)
    return
  }
  const shown = (line: string) => (line ? `"${line.trim()}"` : 'nothing')
  const question = `${summary}: ${getPmName(path)} line ${change.line}, ${shown(change.before)} → ${shown(change.after)}.${note ? ` ${note}` : ''} Nothing is committed. Apply?`
  const answer = await $.ui.ask(question, { options: ['Apply', 'Cancel'], header: 'Desk' }).catch(() => 'Cancel')
  if (answer !== 'Apply') return
  if ((await $.fs.read(path)) !== text) {
    $.ui.toast(`${summary}: the file changed meanwhile, nothing written`)
    return
  }
  await $.fs.write(path, change.text)
  $.ui.toast(`${summary}: done`)
  await reload($, true)
}

const HORIZON_CHOICES = [['Now', 'now'], ['Next', 'next'], ['Later', 'later'], ['Off the roadmap', '']] as const

/** Moves a work package to another horizon, or off the roadmap: the choice is the confirmation, the line is written only if unchanged. */
async function moveFromPane($: EngineInterface, wp: WorkPackage): Promise<void> {
  const options = HORIZON_CHOICES.filter(([, value]) => value !== wp.horizon)
  const now = wp.horizon ? HORIZON_LABEL[wp.horizon as keyof typeof HORIZON_LABEL] : 'off the roadmap'
  const answer = await $.ui.ask(`Move ${wp.id} ${wp.title} (${now}) to? It writes horizon: in its file; nothing is committed.`,
    { options: options.map(([label]) => label), header: 'Roadmap' }).catch(() => '')
  const chosen = options.find(([label]) => label === answer)
  if (!chosen) return
  try {
    const text = await $.fs.read(wp.path)
    await $.fs.write(wp.path, setFrontmatterKey(text, 'horizon', chosen[1] || null).text)
    $.ui.toast(`${wp.id}: ${chosen[0]}`)
    await reload($, true)
  } catch (error) {
    $.ui.toast(`${wp.id}: ${error instanceof EditError ? error.message : String(error)}`)
  }
}

/** When the desk helper last wrote, in epoch ms; 0 when it never did or the stamp cannot be read. */
async function getChangedAt($: EngineInterface): Promise<number> {
  try {
    const at = (JSON.parse(await $.fs.read(`${await $.env.get('HOME')}/${CHANGED_PATH}`)) as { at?: unknown }).at
    return typeof at === 'number' ? at : 0
  } catch {
    return 0
  }
}

/**
 * Reads every registered project again. Forced as well when the desk helper wrote after this session's last read: only the
 * session that started the helper hears its `changed`, and every other one would write its cached forge state over the change.
 */
async function reload($: EngineInterface, isForced = false): Promise<{ count: number; errors: string[] }> {
  const state = await read($, meta)
  if (state.isLoading) return { count: (await read($, projects)).length, errors: [] }
  const isStale = state.refreshedAt > 0 && (await getChangedAt($)) > state.refreshedAt
  await update($, meta, now => ({ ...now, isLoading: true }))
  try {
    const found = await loadProjects($, isForced || isStale)
    await update($, projects, () => found.projects)
    const refreshedAt = await $.clock.now()
    await update($, meta, () => ({ refreshedAt, errors: found.errors, isLoading: false }))
    await writeBoard($).catch(error => $.ui.log(`p2kit: board not written: ${String(error)}`, { to: 'debug' }))
    return { count: found.projects.length, errors: found.errors }
  } catch (error) {
    await update($, meta, now => ({ ...now, errors: [String(error)], isLoading: false }))
    return { count: 0, errors: [String(error)] }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pm-desk', description: 'Open the project desk: every registered p2kit project' })
    // A reload of the module mid-refresh would leave the flag set for good.
    await update($, meta, now => ({ ...now, isLoading: false }))
    void $.ui.open({ id: PANE, title: TITLE })
    void reload($)
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void reload($))

    return next(e)
  })

  // The desktop app attaches after session.start: seat the pane there if it still waits.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    const pane = (await $.ui.panes()).find(open => open.id === PANE)
    if (!pane?.isPlaced) {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      if (!opened.isPlaced) $.ui.log(`p2kit: pane not placed on ${e.surface}: ${opened.reason}`, { to: 'debug' })
    }

    return result
  })

  on('command.run', { command: 'pm-desk' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const { count, errors } = await reload($, true)

    return { text: [`${count} registered projects.`, ...errors].join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, projects)
    const state = await read($, meta)
    const selectedPath = await read($, selected)
    const chosenView = await read($, view)
    const pickedMembers = await read($, members)
    const isNotReadyOnly = await read($, notReadyOnly)
    const chosen = all.find(project => project.path === selectedPath)
    const select = (path: string) => {
      void update($, view, () => '')
      void update($, members, () => [])
      void update($, notReadyOnly, () => false)
      void update($, selected, () => path)
    }
    const show = (next: string) => void update($, view, () => next)
    const openTheme = (path: string, id: string) => {
      void update($, selected, () => path)
      void update($, view, () => `theme:${id}`)
      void update($, members, () => [])
      void update($, notReadyOnly, () => false)
    }
    const togglePerson = (person: string) =>
      void update($, members, now => (now.includes(person) ? now.filter(one => one !== person) : [...now, person]))
    /** One red line per person over the WIP limit. */
    const getWipLines = (project: Project) =>
      project.team.filter(member => member.isOverLimit).map(member => <Text color="red">{getWipText(member)}</Text>)
    /** The open iteration in the overview row, red and " overdue" past its end. */
    const getIterationFact = ({ iteration }: Project) => iteration && (
      <Text color={iteration.isOverdue ? 'red' : undefined} dimColor={!iteration.isOverdue}>
        {`iteration ${iteration.number} · ${iteration.done}/${iteration.planned} WPs · ends ${iteration.end || '—'}${iteration.isOverdue ? ' overdue' : ''}`}
      </Text>
    )
    /** The stage effort in the overview row, red when the effort tolerance is red. */
    const getEffortFact = ({ effort, tolerances }: Project) => {
      const isRed = tolerances.some(t => t.area === 'effort' && t.light === 'red')
      return effort && (
        <Text color={isRed ? 'red' : undefined} dimColor={!isRed}>
          {`effort ${effort.actual}/${effort.estimate}h ${getSignedHours(effort.deviation)}`}
        </Text>
      )
    }
    /** "notready <N>" in yellow when some open issue lacks a readiness heading. */
    const getNotReadyLine = (project: Project) => project.notReady > 0 && <Text color="yellow">{`notready ${project.notReady}`}</Text>
    /** One commit note: kind, status, text; red while an open blocker. */
    const getNoteLine = (note: CommitNote, withSha = false) => {
      const isOpenBlocker = note.kind === 'blocker' && note.status === 'open'
      const value = note.status === 'open' ? 'closed' : 'open'
      const notes = chosen && `${chosen.path}/.pm/registers/commit-notes.yaml`
      return (
        <Box flexDirection="row" columnGap={1}>
          <Text color={isOpenBlocker ? 'red' : undefined} dimColor={note.status === 'closed'} wrap="truncate-end">
            {`  ${withSha ? `${note.sha} ` : ''}${note.kind} · ${note.status} · ${note.text}`}
          </Text>
          {notes && (
            <Button key={`note:${note.sha}:${note.text}`} plain onPress={() =>
              void editFromPane($, notes, `${value === 'closed' ? 'Close' : 'Reopen'} the note on ${note.sha.slice(0, 7)}`, text => setNoteStatus(text, note.sha, note.text, value))}>
              {value === 'closed' ? 'close' : 'reopen'}
            </Button>
          )}
        </Box>
      )
    }
    /** One coloured square per phase. */
    const getPhaseBar = (phases: Phase[]) => (
      <Box flexDirection="row">
        {phases.map(phase => <Text color={PHASE_COLOR[phase.state]}>■</Text>)}
      </Box>
    )

    const toolbar = (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Box flexDirection="row" columnGap={1}>
          {chosen && <Button key="back" variant="secondary" onPress={() => select('')}>← All projects</Button>}
          <Button key="refresh" variant="secondary" onPress={() => void reload($, true)}>{state.isLoading ? 'Refreshing…' : 'Refresh'}</Button>
        </Box>
        <Button key="browser" variant="secondary" onPress={() => void openBoard($)}>Open in browser</Button>
      </Box>
    )
    const errors = state.errors.map(error => <Text color="red" wrap="truncate-end">{error}</Text>)

    if (!chosen) {
      return (
        <Box flexDirection="column" gap={1}>
          {toolbar}
          {errors}
          {all.length === 0 && !state.isLoading && (
            <Text dimColor>No projects registered. Run /pm-register in a project's repo.</Text>
          )}
          {all.map(project => (
            <Box key={project.path} flexDirection="column">
              <Box flexDirection="row" columnGap={1}>
                <Text color={LIGHT_COLOR[project.light]}>●</Text>
                <Button key={`open:${project.path}`} plain onPress={() => select(project.path)}>{project.name || project.path}</Button>
                <Text dimColor>{[project.code, getStageLabel(project), project.status].filter(Boolean).join(' · ')}</Text>
              </Box>
              <Text mono>{getProgressBar(project)}</Text>
              {getIterationFact(project)}
              {getEffortFact(project)}
              <Text dimColor wrap="truncate-end">
                {`high risks ${project.highRisks} · open issues ${project.openIssues} · next report ${project.nextReport.due || '—'} · last retro ${project.lastRetro || '—'}`}
              </Text>
              {getWipLines(project)}
              {getNotReadyLine(project)}
              {getWorkThemes(project).map(({ id, delivery }) => {
                const { summary, forge, phases } = delivery!
                return (
                  <Box key={`theme:${id}`} flexDirection="column">
                    <Box flexDirection="row" columnGap={1}>
                      {getPhaseBar(phases)}
                      <Text wrap="truncate-end">
                        {[id, getThemeProgress(delivery!), summary.current].filter(Boolean).join(' · ')}
                      </Text>
                      {summary.failed > 0 && <Text color="red">{`${summary.failed} failed`}</Text>}
                      <Button key={`go:${project.path}:${id}`} plain onPress={() => openTheme(project.path, id)}>Open</Button>
                    </Box>
                    {forge && (
                      <Box flexDirection="row" columnGap={1}>
                        <Text dimColor wrap="truncate-end">{getForgeLine(forge)}</Text>
                        {forge.isReadyToClose && <Text color="green">ready to close</Text>}
                      </Box>
                    )}
                  </Box>
                )
              })}
              {project.openBlockers > 0 && <Text color="red">{`blockers ${project.openBlockers}`}</Text>}
              {project.nextReport.isOverdue && <Text color="red">highlight report overdue</Text>}
              {project.errors.length > 0 && <Text color="red" wrap="truncate-end">{`⚠ ${project.errors[0]}`}</Text>}
              <Button key={`session:${project.path}`} plain onPress={() => void openSession($, project)}>Open session</Button>
            </Box>
          ))}
        </Box>
      )
    }

    const p = chosen
    const themes = getWorkThemes(p)
    const openRisks = p.risks.filter(risk => risk.status === 'open').sort((a, b) => b.score - a.score)
    const openActions = p.actions.filter(one => one.status === 'open')
    // A project held by older code has no dailyLog: read as empty.
    const log = p.dailyLog ?? []
    const logDays = [...new Set(log.map(one => one.date))].sort().reverse()
    const openIssues = p.issues.filter(issue => issue.status === 'open')
    // Risks and issues list every entry, the open ones first; a closed one is dimmed.
    const allRisks = [...openRisks, ...p.risks.filter(risk => risk.status !== 'open')]
    const allIssues = [...openIssues, ...p.issues.filter(issue => issue.status !== 'open')]
    const themeId = chosenView.startsWith('theme:') ? chosenView.slice('theme:'.length) : ''
    const theme = p.workPackages.find(wp => wp.id === themeId && wp.delivery)

    const notReady = new Set(p.forgeIssues.filter(issue => issue.missing.length > 0).map(issue => issue.number))
    const notReadySuffix = (number: number) => (notReady.has(number) ? ' · notready' : '')

    const placed = (['now', 'next', 'later'] as const).flatMap(horizon => p.roadmap[horizon].flatMap(id => {
      const wp = p.workPackages.find(one => one.id === id)
      return wp ? [{ label: HORIZON_LABEL[horizon], wp }] : []
    }))
    const lanes = getBoardLanes(p)
    const tabs: { id: string; label: string; count: number; render: () => unknown }[] = [
      {
        id: 'roles', label: 'Roles', count: p.roles.length,
        render: () => p.roles.map(role => <Text wrap="truncate-end">{`${role.label}: ${role.people.join(', ') || '—'}`}</Text>),
      },
      {
        id: 'team', label: 'Team', count: p.team.length,
        render: () => [
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {p.team.map(member => (
              <Button key={`member:${member.person}`} variant={pickedMembers.includes(member.person) ? 'primary' : 'secondary'} onPress={() => togglePerson(member.person)}>
                {member.person}
              </Button>
            ))}
          </Box>,
          ...(pickedMembers.length ? p.team.filter(member => pickedMembers.includes(member.person)) : p.team).map(member => (
            <Box key={`person:${member.person}`} flexDirection="column">
              {member.login
                ? <Text color={member.isOverLimit ? 'red' : undefined} bold wrap="truncate-end">{`${member.person} · @${member.login} · ${member.roles.join(', ')} · WIP ${member.wip}/${member.wipLimit}`}</Text>
                : <Text dimColor wrap="truncate-end">{`${member.person} · no forge login`}</Text>}
              {member.items.map(item => (
                <Text wrap="truncate-end">{`  ${item.kind === 'pr' ? 'PR ' : ''}#${item.number} ${item.title} · ${STATUS_LABEL[item.status]}${item.kind === 'issue' ? notReadySuffix(item.number) : ''}`}</Text>
              ))}
              {member.login && member.items.length === 0 && <Text dimColor>{'  No open item.'}</Text>}
            </Box>
          )),
        ],
      },
      {
        // Activity: the open milestones with their work package, the open pull requests, the open issues grouped by milestone.
        id: 'activity', label: 'Activity', count: p.forgeIssues.length + p.forgePulls.length,
        render: () => {
          const shown = isNotReadyOnly ? p.forgeIssues.filter(issue => notReady.has(issue.number)) : p.forgeIssues
          // Open issues of a milestone that is not open (closed, or past the one-page read): one group per title, after the open ones.
          const openTitles = new Set(p.milestones.map(m => m.title))
          const others = [...new Set(shown.map(issue => issue.milestone).filter(title => title && !openTitles.has(title)))]
          const today = new Date(state.refreshedAt).toISOString().slice(0, 10)
          const groups: [string, string][] = [
            ...p.milestones.map(m => [m.title, m.title] as [string, string]),
            ...others.map(title => [title, `${title} · closed`] as [string, string]),
            ['', 'No milestone'],
          ]
          const issueGroups = groups
            .map(([milestone, head]) => [head, shown.filter(issue => issue.milestone === milestone)] as const)
            .filter(([, list]) => list.length > 0)
          return [
            <Text bold>Milestones</Text>,
            ...(p.milestones.length === 0 ? [<Text dimColor>No open milestone.</Text>] : p.milestones.map(m => {
              const wp = getMilestonePackage(p.workPackages, m.title)
              return (
                <Box key={`milestone:${m.title}`} flexDirection="column">
                  <Text wrap="truncate-end">{`${m.title} · ${m.closed}/${m.open + m.closed}${m.due ? ` · due ${m.due}` : ''} · stalled ${m.stalled} · in review ${m.inReview}${m.due && m.due < today && m.open > 0 ? ' · overdue' : ''}`}</Text>
                  {wp
                    ? <Box flexDirection="row"><Text>{'  '}</Text><Button key={`milestone-wp:${m.title}`} plain onPress={() => show(`theme:${wp.id}`)}>{`${wp.id} ${wp.title}`}</Button></Box>
                    : <Text dimColor>{'  no work package'}</Text>}
                </Box>
              )
            })),
            <Text bold>Pull requests</Text>,
            ...(p.forgePulls.length === 0 ? [<Text dimColor>No open pull request.</Text>] : p.forgePulls.map(pull => (
              <Text wrap="truncate-end">{`  PR #${pull.number} ${pull.title}${pull.draft ? ' · draft' : pull.inReview ? ' · in review' : ''}`}</Text>
            ))),
            <Box flexDirection="row" columnGap={1}>
              <Text bold>Issues</Text>
              <Button key="filter:notready" variant={isNotReadyOnly ? 'primary' : 'secondary'} onPress={() => void update($, notReadyOnly, now => !now)}>Not ready only</Button>
            </Box>,
            ...(issueGroups.length === 0 ? [<Text dimColor>No open issue.</Text>] : issueGroups.map(([head, list]) => (
              <Box key={`issues:${head}`} flexDirection="column">
                <Text bold wrap="truncate-end">{head}</Text>
                {list.map(issue => <Text wrap="truncate-end">{`  #${issue.number} ${issue.title}${notReadySuffix(issue.number)}`}</Text>)}
              </Box>
            ))),
          ]
        },
      },
      {
        // Metrics: lead, review and merge time over 30 and 90 days, then one line per week of the 90 days.
        id: 'metrics', label: 'Metrics', count: p.flow?.windows[0]?.merge.count ?? 0,
        render: () => {
          if (!p.flow) return <Text dimColor>No forge data.</Text>
          const [w30, w90] = p.flow.windows
          const top = Math.max(1, ...w90.throughput.map(week => week.issues + week.pulls))
          const width = Math.min(top, METRICS_BAR)
          return [
            <Text dimColor>Days: median · p90 (count), 30 days | 90 days</Text>,
            ...FLOW_ROWS.map(([label, key]) => <Text wrap="truncate-end">{`${label}: ${getFlowCell(w30[key])} | ${getFlowCell(w90[key])}`}</Text>),
            <Text bold>Weekly throughput, 90 days</Text>,
            ...w90.throughput.map(week => (
              <Text mono wrap="truncate-end">{`${week.week} ${'▇'.repeat(Math.round((week.issues + week.pulls) * width / top)).padEnd(width)} ${week.issues} issues · ${week.pulls} PRs`}</Text>
            )),
          ]
        },
      },
      {
        // Board: one block per work package with a milestone, a line per column; the count is the open items in no work package.
        id: 'board', label: 'Board', count: lanes.at(-1)?.cards.length ?? 0,
        render: () => lanes.flatMap(lane => {
          const head = lane.wp
            ? `${lane.wp} ${lane.title} · ${lane.status || 'no status'}${lane.progress ? ` · ${lane.progress.closed}/${lane.progress.total}` : ''}${lane.reopened ? ` · reopened: ${lane.reopened} open` : ''}`
            : `Unplanned · ${lane.cards.length} open`
          const columns = BOARD_COLUMNS.flatMap(([column, label]) => {
            const list = lane.cards.filter(card => card.column === column)
            return list.length ? [<Text wrap="truncate-end">{`  ${label}: ${list.map(card => `${card.kind === 'pr' ? 'PR ' : ''}#${card.number} ${card.assignees.length ? card.assignees.map(login => `@${login}`).join(' ') : 'unassigned'}`).join(', ')}`}</Text>] : []
          })
          return [<Text bold color={lane.reopened ? 'warning' : undefined} wrap="truncate-end">{head}</Text>, ...(columns.length ? columns : [<Text dimColor>{'  No open item.'}</Text>])]
        }),
      },
      {
        id: 'documents', label: 'Documents', count: p.documents.length,
        render: () => p.documents.length === 0 ? <Text dimColor>None yet.</Text> : p.documents.map(doc => (
          <Button key={`doc:${doc.path}`} plain onPress={() => void openFile($, doc.path)}>
            {doc.folder ? `${doc.folder} · ${doc.title}` : `${doc.title} · ${doc.status}${doc.version ? ` v${doc.version}` : ''}`}
          </Button>
        )),
      },
      {
        id: 'wps', label: 'Work packages', count: p.workPackages.length,
        render: () => [
          <Text mono>{getProgressBar(p)}</Text>,
          ...(p.effort ? [<Text wrap="truncate-end">{getStageEffortLine(p.effort)}</Text>] : []),
          ...(p.workPackages.length === 0 ? [<Text dimColor>None yet.</Text>] : p.workPackages.map(wp => (
            <Box key={`wp:${wp.path}`} flexDirection="row" columnGap={1}>
              <Text color={WP_COLOR[wp.status] ?? 'white'} mono>{wp.status.padEnd(11)}</Text>
              <Button plain onPress={() => void openFile($, wp.path)}>{`${wp.id} ${wp.title}`}</Button>
              <Text dimColor>{[wp.stage === null ? '' : `stage ${wp.stage}`, wp.due && `due ${wp.due}`].filter(Boolean).join(' · ')}</Text>
              {wp.delivery && !themes.some(one => one.id === wp.id) && (
                <Button key={`theme:${wp.id}`} plain onPress={() => show(`theme:${wp.id}`)}>work theme</Button>
              )}
              {getWpEffortText(wp) && <Text dimColor>{getWpEffortText(wp)}</Text>}
            </Box>
          ))),
        ],
      },
      {
        id: 'iterations', label: 'Iterations', count: p.iterations.length,
        render: () => p.iterations.length === 0 ? <Text dimColor>No iteration.</Text> : p.iterations.slice().reverse().map(one => {
          const wps = p.iteration?.number === one.number ? `${p.iteration.done}/${p.iteration.planned}` : String(one.delivered.length)
          return (
            <Text dimColor={one.status !== 'open'} wrap="truncate-end">
              {[`#${one.number}`, one.goal, `${one.start || '—'} → ${one.end || '—'}`, `WPs ${wps}`, one.status, one.result].filter(Boolean).join(' · ')}
            </Text>
          )
        }),
      },
      {
        id: 'lessons', label: 'Lessons', count: openActions.length,
        render: () => [
          <Text dimColor={!p.lastRetro}>{p.lastRetro ? `Last retrospective ${p.lastRetro}` : 'No retrospective yet.'}</Text>,
          ...openActions.concat(p.actions.filter(one => one.status !== 'open')).map(one => (
            <Text dimColor={one.status !== 'open'} wrap="truncate-end">
              {[one.id, one.text, one.issue === null ? '' : `#${one.issue}`, one.status].filter(Boolean).join(' · ')}
            </Text>
          )),
          ...p.lessons.slice().reverse().sort((a, b) => b.date.localeCompare(a.date)).map(one => (
            <Text wrap="truncate-end">
              {[one.date, one.iteration === null ? '' : `iteration ${one.iteration}`, one.kind, one.text].filter(Boolean).join(' · ')}
            </Text>
          )),
        ],
      },
      {
        id: 'roadmap', label: 'Roadmap', count: placed.length,
        render: () => placed.length === 0 && p.roadmap.unplaced.length === 0
          ? <Text dimColor>No roadmap yet: run /pm-roadmap in the project's repo.</Text>
          : [
            ...placed.map(({ label, wp }) => (
              <Box flexDirection="row" columnGap={1}>
                <Text wrap="truncate-end">{`${label} · ${wp.id} ${wp.title} · ${wp.status}${wp.due ? ` · due ${wp.due}` : ''}`}</Text>
                <Button key={`move:${wp.id}`} plain onPress={() => void moveFromPane($, wp)}>move</Button>
              </Box>
            )),
            ...(p.roadmap.unplaced.length ? [<Text dimColor wrap="truncate-end">{`Not on the roadmap: ${p.roadmap.unplaced.join(', ')}`}</Text>] : []),
            ...(p.roadmap.unplaced.length ? [
              <Box flexDirection="row" columnGap={1}>
                {p.workPackages.filter(wp => p.roadmap.unplaced.includes(wp.id)).map(wp => (
                  <Button key={`place:${wp.id}`} plain onPress={() => void moveFromPane($, wp)}>{`place ${wp.id}`}</Button>
                ))}
              </Box>,
            ] : []),
          ],
      },
      {
        id: 'log', label: 'Daily log', count: log.filter(one => one.status === 'open').length,
        render: () => log.length === 0 ? <Text dimColor>No daily log yet: run /pm-log in the project's repo.</Text> : logDays.flatMap(day => [
          <Text bold>{day}</Text>,
          ...log.filter(one => one.date === day).map(one => (
            <Text color={one.isOverdue ? 'red' : undefined} dimColor={one.status === 'done'} wrap="truncate-end">
              {[one.id, one.kind, one.text, one.ref, one.register ? `→ ${one.register}` : '', one.issue === null ? '' : `#${one.issue}`, one.owner,
                one.due ? `due ${one.due}` : '', one.status].filter(Boolean).join(' · ')}
            </Text>
          )),
        ]),
      },
      {
        id: 'risks', label: 'Risks', count: openRisks.length,
        render: () => allRisks.length === 0 ? <Text dimColor>None.</Text> : allRisks.map(risk => (
          <Text color={risk.status === 'open' && risk.score >= 6 ? 'red' : undefined} dimColor={risk.status !== 'open'} wrap="truncate-end">
            {`${risk.id} [${risk.score}] ${risk.title}${risk.status === 'open' ? '' : ` · ${risk.status}`}`}
          </Text>
        )),
      },
      {
        id: 'issues', label: 'Issues', count: openIssues.length,
        render: () => allIssues.length === 0 ? <Text dimColor>None.</Text>
          : allIssues.map(issue => (
            <Text dimColor={issue.status !== 'open'} wrap="truncate-end">
              {`${issue.id} ${issue.priority} · ${issue.title}${issue.status === 'open' ? '' : ` · ${issue.status}`}`}
            </Text>
          )),
      },
      {
        id: 'approvals', label: 'Approvals', count: p.approvals.length,
        render: () => p.approvals.length === 0 ? <Text dimColor>None recorded.</Text>
          : p.approvals.map(one => <Text wrap="truncate-end">{`${one.date} ${one.decision} — ${one.by}`}</Text>),
      },
    ]
    const tab = chosenView.startsWith('tab:') ? tabs.find(one => `tab:${one.id}` === chosenView) : undefined

    /** Open blocker notes with WP id and short sha, high open risks, an overdue report. */
    const getAttention = () => {
      const blockers = getOpenBlockers(p).map(({ wp, sha, text }) => [wp, sha, text])
      const lines = [
        ...blockers.map(([wp, sha, text]) => <Text color="red" wrap="truncate-end">{`${wp} ${sha} ${text}`}</Text>),
        ...openRisks.filter(risk => risk.score >= 6).map(risk => <Text color="red" wrap="truncate-end">{`${risk.id} [${risk.score}] ${risk.title}`}</Text>),
        ...(p.nextReport.isOverdue ? [<Text color="red">{`highlight report overdue (${p.nextReport.due})`}</Text>] : []),
        ...(p.iteration?.isOverdue ? [<Text color="red">{`Iteration ${p.iteration.number} past its end (${p.iteration.end})`}</Text>] : []),
        ...openActions.map(one => <Text wrap="truncate-end">{`${one.id} ${one.text}${one.issue === null ? '' : ` #${one.issue}`}`}</Text>),
        ...log.filter(one => one.isOverdue).map(one => <Text color="red" wrap="truncate-end">{`${one.id} ${one.text}${one.owner ? ` · ${one.owner}` : ''} · due ${one.due}`}</Text>),
        ...getWipLines(p),
      ]
      return lines.length ? lines : [<Text dimColor>Nothing.</Text>]
    }

    const recap = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>{`Stage ${p.stage.current === null ? '—' : `${p.stage.current}${p.stage.name ? ` · ${p.stage.name}` : ''}`} · ${getStageSpan(p)}`}</Text>
          <Text mono>{`${getProgressBar(p)} · ${themes.length} active work themes`}</Text>
          {p.iteration && (
            <Text color={p.iteration.isOverdue ? 'red' : undefined} wrap="truncate-end">
              {`Iteration ${p.iteration.number} · ${p.iteration.done}/${p.iteration.planned} WPs · ends ${p.iteration.end || '—'} · ${p.iteration.goal}`}
            </Text>
          )}
          <Text color={p.openBlockers ? 'red' : undefined}>{`Blockers ${p.openBlockers}`}</Text>
          <Text color={p.nextReport.isOverdue ? 'red' : undefined}>{`Next report ${p.nextReport.due || '—'}${p.nextReport.isOverdue ? ' · overdue' : ''}`}</Text>
          {getNotReadyLine(p)}
        </Box>
        <Box flexDirection="column">
          <Text bold>Tolerances</Text>
          {p.tolerances.length === 0 && <Text dimColor>None set.</Text>}
          {p.tolerances.map(t => (
            <Box flexDirection="row" columnGap={1}>
              <Text color={LIGHT_COLOR[t.light]}>●</Text>
              <Text>{`${t.area}: ${t.used} / ${t.limit} ${t.unit}${t.isComputed ? ' · from work packages' : ''}`}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text bold>Needs attention</Text>
          {getAttention()}
        </Box>
        {p.unthemedNotes.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Notes without a work theme</Text>
            {p.unthemedNotes.map(note => getNoteLine(note, true))}
          </Box>
        )}
      </Box>
    )

    const getThemePanel = ({ id, title, status, delivery, path }: WorkPackage) => {
      const one = delivery!
      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">
            {[`${id} ${title}`.trim(), one.issue === null ? '' : `#${one.issue}`, one.milestone && `milestone ${one.milestone}`, one.ref || one.branch, one.base && `over ${one.base}`]
              .filter(Boolean).join(' · ')}
          </Text>
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>{status}</Text>
            {status === 'completed' && (
              <Button key={`archive:${id}`} plain onPress={() => void editFromPane($, path, `Archive ${id}`, text => setWpStatus(text, id, 'archived'))}>Archive</Button>
            )}
            {(status === 'in-progress' || status === 'authorized') && (
              <Button key={`complete:${id}`} plain onPress={() =>
                void editFromPane($, path, `Mark ${id} completed`, text => setWpStatus(text, id, 'completed'), 'A decision of the Project Board: apply only if the Board has taken it.')}>
                Mark completed
              </Button>
            )}
          </Box>
          {one.forge?.issue && (
            <Text wrap="truncate-end">{`#${one.forge.issue.number} · ${one.forge.issue.state} · ${one.forge.issue.title}`}</Text>
          )}
          {one.forge?.milestone && (
            <Text wrap="truncate-end">
              {[`${one.forge.milestone.title} ${one.forge.milestone.closed}/${one.forge.milestone.open + one.forge.milestone.closed}`, one.forge.milestone.due && `due ${one.forge.milestone.due}`].filter(Boolean).join(' · ')}
            </Text>
          )}
          {one.forge?.milestoneItems && (() => {
            const items = one.forge.milestoneItems
            const open = items.filter(item => item.state === 'open')
            const name = (item: (typeof items)[number]) => `${item.kind === 'pr' ? 'PR ' : ''}#${item.number}`
            return [
              <Text bold wrap="truncate-end">{`${items.length - open.length} of ${items.length} closed${open.length ? ` · still open: ${open.map(name).join(', ')}` : ' · nothing left open'}`}</Text>,
              ...items.map(item => (
                <Text color={ITEM_COLOR[item.state]} wrap="truncate-end">{`${name(item)} · ${item.state} · ${item.title}`}</Text>
              )),
            ]
          })()}
          {one.forge?.pulls.map(pull => (
            <Text color={PULL_COLOR[pull.state]} wrap="truncate-end">{`PR #${pull.number} · ${pull.state} · ${pull.title}`}</Text>
          ))}
          {one.forge?.isReadyToClose && <Text color="green">ready to close</Text>}
          <Text bold>Phases</Text>
          {one.phases.length === 0 && <Text dimColor>{one.ref ? 'No phased plan on the branch.' : one.branch ? 'Branch not read.' : 'No branch linked.'}</Text>}
          {one.objective && <Text wrap="wrap">{one.objective}</Text>}
          {one.phases.map(phase => (
            <Box key={`phase:${phase.number}`} flexDirection="column">
              <Text color={PHASE_COLOR[phase.state]} wrap="truncate-end">{`Phase ${phase.number}: ${phase.title} · ${phase.state}`}</Text>
              {phase.outcome && <Text dimColor wrap="wrap">{`  ${phase.outcome}`}</Text>}
            </Box>
          ))}
          <Text bold>Commits and notes</Text>
          {one.commits.length === 0 && <Text dimColor>None.</Text>}
          {one.commits.map(commit => (
            <Box key={`commit:${commit.sha}`} flexDirection="column">
              <Text mono wrap="truncate-end">{`${commit.short} ${commit.subject}`}</Text>
              {commit.notes.map(note => getNoteLine(note))}
            </Box>
          ))}
          {one.unlinkedNotes.length > 0 && (
            <Text dimColor>{one.ref ? 'Notes on commits not on the branch' : 'Branch not read'}</Text>
          )}
          {one.unlinkedNotes.map(note => getNoteLine(note, true))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {toolbar}
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Text color={LIGHT_COLOR[p.light]}>●</Text>
            <Text bold>{p.name}</Text>
            <Text dimColor>{[p.code, getStageLabel(p), p.status, `profile ${p.profile}`].filter(Boolean).join(' · ')}</Text>
          </Box>
          <Text dimColor wrap="truncate-start">{p.path}</Text>
          {p.errors.map(error => <Text color="red" wrap="truncate-end">{error}</Text>)}
          <Button key="session" plain onPress={() => void openSession($, p)}>Open session</Button>
        </Box>

        <Box flexDirection="column">
          <Text bold>Work themes</Text>
          {themes.length === 0 && (
            <Text dimColor wrap="truncate-end">No work package linked: run /pm-link in the project's repo to see phases, commits and pull requests.</Text>
          )}
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {themes.map(({ id, delivery }) => (
              <Button key={`theme:${id}`} variant={themeId === id ? 'primary' : 'secondary'} onPress={() => show(`theme:${id}`)}>
                {[id, getThemeProgress(delivery!)].filter(Boolean).join(' ')}
              </Button>
            ))}
          </Box>
        </Box>

        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Button key="tab:recap" variant={!tab && !theme ? 'primary' : 'secondary'} onPress={() => show('')}>Recap</Button>
          {tabs.map(one => (
            <Button key={`tab:${one.id}`} variant={tab === one ? 'primary' : 'secondary'} onPress={() => show(`tab:${one.id}`)}>
              {`${one.label} ${one.count}`}
            </Button>
          ))}
        </Box>

        {theme ? getThemePanel(theme) : tab ? <Box flexDirection="column">{tab.render()}</Box> : recap}
      </Box>
    )
  })
}
