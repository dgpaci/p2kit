import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { openFile, openSession } from './actions'
import { getOpenBlockers, renderBoard } from './board'
import type { CommitNote, Light, Phase, PhaseState, Project, Pull, TeamMember, TeamStatus, WorkPackage, WpForge } from '../types'
import { getWorkThemes, isOpen, loadProjects } from './project'

const PANE = 'p2kit-desk'
const TITLE = 'Project desk'
// Local files only: cheap to read again.
const REFRESH_MS = 60 * 1000
// The browser board, under the home folder.
const BOARD_PATH = '.claude/p2kit/desk.html'

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const projects = atom({ plugin: 'p2kit', key: 'projects' } as const, [], { shape: 'projects-4' })
const selected = atom({ plugin: 'p2kit', key: 'selected' } as const, '', { shape: 'selected-1' })
// The chosen project's body: '' the recap, `tab:<id>`, `theme:<WP-id>`.
const view = atom({ plugin: 'p2kit', key: 'view' } as const, '', { shape: 'view-1' })
// The people the Team tab shows; none picked shows everyone.
const members = atom({ plugin: 'p2kit', key: 'members' } as const, [], { shape: 'members-1' })
const meta = atom(
  { plugin: 'p2kit', key: 'meta' } as const,
  { refreshedAt: 0, errors: [], isLoading: false },
  { shape: 'meta-1' },
)

const LIGHT_COLOR: Record<Light, string> = { green: 'green', amber: 'yellow', red: 'red', none: 'gray' }
const PHASE_COLOR: Record<PhaseState, string> = { done: 'green', 'in-progress': 'cyan', todo: 'gray', failed: 'red', blocked: 'yellow' }
const PULL_COLOR: Record<Pull['state'], string> = { open: 'cyan', merged: 'green', closed: 'gray' }
const STATUS_LABEL: Record<TeamStatus, string> = { review: 'review asked', inprogress: 'in progress', todo: 'to do', waiting: 'waiting for review', stalled: 'stalled' }
const WP_COLOR: Record<string, string> = { completed: 'green', 'in-progress': 'cyan', authorized: 'white', draft: 'gray', cancelled: 'gray' }

// The automatic refresh; a reload of the module starts a new one.
let timer: Timer | undefined

async function getBoardPath($: EngineInterface): Promise<string> {
  return `${await $.env.get('HOME')}/${BOARD_PATH}`
}

const getStageLabel = (project: Project): string =>
  project.stage.current === null ? 'no stage' : `stage ${project.stage.current}${project.stage.name ? ` ${project.stage.name}` : ''}`

/** The forge's word on a work package in one line: issue and state, milestone closed/total, pull requests. */
function getForgeLine(forge: WpForge): string {
  const open = forge.pulls.filter(pull => pull.state === 'open').length
  return [
    forge.issue ? `#${forge.issue.number} · ${forge.issue.state}` : '',
    forge.milestone ? `${forge.milestone.title} ${forge.milestone.closed}/${forge.milestone.open + forge.milestone.closed}` : '',
    forge.pulls.length ? `PRs ${forge.pulls.length}${open ? ` (${open} open)` : ''}` : '',
  ].filter(Boolean).join(' · ')
}

/** `▓▓░░░ 2/5`: completed work packages of the current stage. */
function getProgressBar({ done, total }: Project['progress']): string {
  const width = 10
  const filled = total ? Math.round((width * done) / total) : 0
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${done}/${total}`
}

const getWipText = (member: TeamMember): string => `WIP ${member.person} ${member.wip}/${member.wipLimit}`

/** Rewrites the browser board from the projects as they stand. */
async function writeBoard($: EngineInterface): Promise<void> {
  const state = await read($, meta)
  await $.fs.write(await getBoardPath($), renderBoard({ projects: await read($, projects), refreshedAt: state.refreshedAt, errors: state.errors }))
}

/** Opens the browser board, written afresh first. */
async function openBoard($: EngineInterface): Promise<void> {
  await writeBoard($)
  await openFile($, await getBoardPath($))
}

/** Reads every registered project again. */
async function reload($: EngineInterface, isForced = false): Promise<{ count: number; errors: string[] }> {
  if ((await read($, meta)).isLoading) return { count: (await read($, projects)).length, errors: [] }
  await update($, meta, now => ({ ...now, isLoading: true }))
  try {
    const found = await loadProjects($, isForced)
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
    const chosen = all.find(project => project.path === selectedPath)
    const select = (path: string) => {
      void update($, view, () => '')
      void update($, members, () => [])
      void update($, selected, () => path)
    }
    const show = (next: string) => void update($, view, () => next)
    const openTheme = (path: string, id: string) => {
      void update($, selected, () => path)
      void update($, view, () => `theme:${id}`)
      void update($, members, () => [])
    }
    const togglePerson = (person: string) =>
      void update($, members, now => (now.includes(person) ? now.filter(one => one !== person) : [...now, person]))
    /** One red line per person over the WIP limit. */
    const getWipLines = (project: Project) =>
      project.team.filter(member => member.isOverLimit).map(member => <Text color="red">{getWipText(member)}</Text>)
    /** One commit note: kind, status, text; red while an open blocker. */
    const getNoteLine = (note: CommitNote, withSha = false) => {
      const isOpenBlocker = note.kind === 'blocker' && note.status === 'open'
      return (
        <Text color={isOpenBlocker ? 'red' : undefined} dimColor={note.status === 'closed'} wrap="truncate-end">
          {`  ${withSha ? `${note.sha} ` : ''}${note.kind} · ${note.status} · ${note.text}`}
        </Text>
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
              <Text mono>{getProgressBar(project.progress)}</Text>
              <Text dimColor wrap="truncate-end">
                {`high risks ${project.highRisks} · open issues ${project.openIssues} · next report ${project.nextReport.due || '—'}`}
              </Text>
              {getWipLines(project)}
              {getWorkThemes(project).map(({ id, delivery }) => {
                const { summary, forge, phases } = delivery!
                return (
                  <Box key={`theme:${id}`} flexDirection="column">
                    <Box flexDirection="row" columnGap={1}>
                      {getPhaseBar(phases)}
                      <Text wrap="truncate-end">
                        {[id, summary.total ? `phases ${summary.done}/${summary.total}` : '', summary.current].filter(Boolean).join(' · ')}
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
    const openIssues = p.issues.filter(issue => issue.status === 'open')
    // Risks and issues list every entry, the open ones first; a closed one is dimmed.
    const allRisks = [...openRisks, ...p.risks.filter(risk => risk.status !== 'open')]
    const allIssues = [...openIssues, ...p.issues.filter(issue => issue.status !== 'open')]
    const themeId = chosenView.startsWith('theme:') ? chosenView.slice('theme:'.length) : ''
    const theme = p.workPackages.find(wp => wp.id === themeId && wp.delivery)

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
                <Text wrap="truncate-end">{`  ${item.kind === 'pr' ? 'PR ' : ''}#${item.number} ${item.title} · ${STATUS_LABEL[item.status]}`}</Text>
              ))}
              {member.login && member.items.length === 0 && <Text dimColor>{'  No open item.'}</Text>}
            </Box>
          )),
        ],
      },
      {
        id: 'documents', label: 'Documents', count: p.documents.length,
        render: () => p.documents.length === 0 ? <Text dimColor>None yet.</Text> : p.documents.map(doc => (
          <Button key={`doc:${doc.path}`} plain onPress={() => void openFile($, doc.path)}>
            {`${doc.title} · ${doc.status}${doc.version ? ` v${doc.version}` : ''}`}
          </Button>
        )),
      },
      {
        id: 'wps', label: 'Work packages', count: p.workPackages.length,
        render: () => [
          <Text mono>{getProgressBar(p.progress)}</Text>,
          ...(p.workPackages.length === 0 ? [<Text dimColor>None yet.</Text>] : p.workPackages.map(wp => (
            <Box key={`wp:${wp.path}`} flexDirection="row" columnGap={1}>
              <Text color={WP_COLOR[wp.status] ?? 'white'} mono>{wp.status.padEnd(11)}</Text>
              <Button plain onPress={() => void openFile($, wp.path)}>{`${wp.id} ${wp.title}`}</Button>
              <Text dimColor>{[wp.stage === null ? '' : `stage ${wp.stage}`, wp.due && `due ${wp.due}`].filter(Boolean).join(' · ')}</Text>
              {wp.delivery && !themes.some(one => one.id === wp.id) && (
                <Button key={`theme:${wp.id}`} plain onPress={() => show(`theme:${wp.id}`)}>work theme</Button>
              )}
            </Box>
          ))),
        ],
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
        ...getWipLines(p),
      ]
      return lines.length ? lines : [<Text dimColor>Nothing.</Text>]
    }

    const recap = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>{`Stage ${p.stage.current === null ? '—' : `${p.stage.current}${p.stage.name ? ` · ${p.stage.name}` : ''}`} · ${p.stage.start || '—'} → ${p.stage.plannedEnd || '—'}`}</Text>
          <Text mono>{`${getProgressBar(p.progress)} · ${themes.length} active work themes`}</Text>
          <Text color={p.openBlockers ? 'red' : undefined}>{`Blockers ${p.openBlockers}`}</Text>
          <Text color={p.nextReport.isOverdue ? 'red' : undefined}>{`Next report ${p.nextReport.due || '—'}${p.nextReport.isOverdue ? ' · overdue' : ''}`}</Text>
        </Box>
        <Box flexDirection="column">
          <Text bold>Tolerances</Text>
          {p.tolerances.length === 0 && <Text dimColor>None set.</Text>}
          {p.tolerances.map(t => (
            <Box flexDirection="row" columnGap={1}>
              <Text color={LIGHT_COLOR[t.light]}>●</Text>
              <Text>{`${t.area}: ${t.used} / ${t.limit} ${t.unit}`}</Text>
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

    const getThemePanel = ({ id, title, status, delivery }: WorkPackage) => {
      const one = delivery!
      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">
            {[`${id} ${title}`.trim(), one.issue === null ? '' : `#${one.issue}`, one.milestone && `milestone ${one.milestone}`, one.ref || one.branch, one.base && `over ${one.base}`]
              .filter(Boolean).join(' · ')}
          </Text>
          <Text dimColor>{status}</Text>
          {one.forge?.issue && (
            <Text wrap="truncate-end">{`#${one.forge.issue.number} · ${one.forge.issue.state} · ${one.forge.issue.title}`}</Text>
          )}
          {one.forge?.milestone && (
            <Text wrap="truncate-end">
              {[`${one.forge.milestone.title} ${one.forge.milestone.closed}/${one.forge.milestone.open + one.forge.milestone.closed}`, one.forge.milestone.due && `due ${one.forge.milestone.due}`].filter(Boolean).join(' · ')}
            </Text>
          )}
          {one.forge?.pulls.map(pull => (
            <Text color={PULL_COLOR[pull.state]} wrap="truncate-end">{`PR #${pull.number} · ${pull.state} · ${pull.title}`}</Text>
          ))}
          {one.forge?.isReadyToClose && <Text color="green">ready to close</Text>}
          <Text bold>Phases</Text>
          {one.phases.length === 0 && <Text dimColor>{one.ref ? 'No phased plan on the branch.' : 'No branch linked.'}</Text>}
          {one.phases.map(phase => (
            <Text color={PHASE_COLOR[phase.state]} wrap="truncate-end">{`Phase ${phase.number}: ${phase.title} · ${phase.state}`}</Text>
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
            <Text dimColor>{isOpen({ status }) ? 'Notes on commits not on the branch' : 'Branch not read: the work package is closed'}</Text>
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
                {`${id} ${delivery!.summary.done}/${delivery!.summary.total}`}
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
