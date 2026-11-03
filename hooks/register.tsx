import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { openFile, openSession } from './actions'
import { renderBoard } from './board'
import type { Light, Project } from '../types'
import { loadProjects } from './project'

const PANE = 'p2kit-desk'
const TITLE = 'Project desk'
// Local files only: cheap to read again.
const REFRESH_MS = 60 * 1000
// The browser board, under the home folder.
const BOARD_PATH = '.claude/p2kit/desk.html'

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const projects = atom({ plugin: 'p2kit', key: 'projects' } as const, [], { shape: 'projects-1' })
const selected = atom({ plugin: 'p2kit', key: 'selected' } as const, '', { shape: 'selected-1' })
const meta = atom(
  { plugin: 'p2kit', key: 'meta' } as const,
  { refreshedAt: 0, errors: [], isLoading: false },
  { shape: 'meta-1' },
)

const LIGHT_COLOR: Record<Light, string> = { green: 'green', amber: 'yellow', red: 'red', none: 'gray' }
const WP_COLOR: Record<string, string> = { completed: 'green', 'in-progress': 'cyan', authorized: 'white', draft: 'gray', cancelled: 'gray' }

// The automatic refresh; a reload of the module starts a new one.
let timer: Timer | undefined

async function getBoardPath($: EngineInterface): Promise<string> {
  return `${await $.env.get('HOME')}/${BOARD_PATH}`
}

const getStageLabel = (project: Project): string =>
  project.stage.current === null ? 'no stage' : `stage ${project.stage.current}${project.stage.name ? ` ${project.stage.name}` : ''}`

/** `▓▓░░░ 2/5`: completed work packages of the current stage. */
function getProgressBar({ done, total }: Project['progress']): string {
  const width = 10
  const filled = total ? Math.round((width * done) / total) : 0
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${done}/${total}`
}

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
async function reload($: EngineInterface): Promise<{ count: number; errors: string[] }> {
  if ((await read($, meta)).isLoading) return { count: (await read($, projects)).length, errors: [] }
  await update($, meta, now => ({ ...now, isLoading: true }))
  try {
    const found = await loadProjects($)
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
    const { count, errors } = await reload($)

    return { text: [`${count} registered projects.`, ...errors].join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, projects)
    const state = await read($, meta)
    const selectedPath = await read($, selected)
    const chosen = all.find(project => project.path === selectedPath)
    const select = (path: string) => void update($, selected, () => path)

    const toolbar = (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Box flexDirection="row" columnGap={1}>
          {chosen && <Button key="back" variant="secondary" onPress={() => select('')}>← All projects</Button>}
          <Button key="refresh" variant="secondary" onPress={() => void reload($)}>{state.isLoading ? 'Refreshing…' : 'Refresh'}</Button>
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
                <Text bold>{project.name}</Text>
                <Text dimColor>{[project.code, getStageLabel(project), project.status].filter(Boolean).join(' · ')}</Text>
              </Box>
              <Text mono>{getProgressBar(project.progress)}</Text>
              <Text dimColor wrap="truncate-end">
                {`high risks ${project.highRisks} · open issues ${project.openIssues} · next report ${project.nextReport.due || '—'}`}
              </Text>
              {project.nextReport.isOverdue && <Text color="red">highlight report overdue</Text>}
              {project.errors.length > 0 && <Text color="red" wrap="truncate-end">{`⚠ ${project.errors[0]}`}</Text>}
              <Box flexDirection="row" columnGap={2}>
                <Button key={`open:${project.path}`} plain onPress={() => select(project.path)}>Details</Button>
                <Button key={`session:${project.path}`} plain onPress={() => void openSession($, project)}>Open session</Button>
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    const p = chosen
    const openRisks = p.risks.filter(risk => risk.status === 'open').sort((a, b) => b.score - a.score)
    const openIssues = p.issues.filter(issue => issue.status === 'open')

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
          <Text bold>Roles</Text>
          {p.roles.map(role => <Text wrap="truncate-end">{`${role.label}: ${role.people.join(', ') || '—'}`}</Text>)}
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
          <Text bold>Documents</Text>
          {p.documents.length === 0 && <Text dimColor>None yet.</Text>}
          {p.documents.map(doc => (
            <Button key={`doc:${doc.path}`} plain onPress={() => void openFile($, doc.path)}>
              {`${doc.title} · ${doc.status}${doc.version ? ` v${doc.version}` : ''}`}
            </Button>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>{`Work packages · ${getProgressBar(p.progress)}`}</Text>
          {p.workPackages.length === 0 && <Text dimColor>None yet.</Text>}
          {p.workPackages.map(wp => (
            <Box key={`wp:${wp.path}`} flexDirection="row" columnGap={1}>
              <Text color={WP_COLOR[wp.status] ?? 'white'} mono>{wp.status.padEnd(11)}</Text>
              <Button plain onPress={() => void openFile($, wp.path)}>{`${wp.id} ${wp.title}`}</Button>
              <Text dimColor>{[wp.stage === null ? '' : `stage ${wp.stage}`, wp.due && `due ${wp.due}`].filter(Boolean).join(' · ')}</Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>{`Risks · ${openRisks.length} open`}</Text>
          {openRisks.map(risk => (
            <Text color={risk.score >= 6 ? 'red' : undefined} wrap="truncate-end">
              {`${risk.id} [${risk.score}] ${risk.title}`}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>{`Issues · ${openIssues.length} open`}</Text>
          {openIssues.map(issue => <Text wrap="truncate-end">{`${issue.id} ${issue.priority} · ${issue.title}`}</Text>)}
        </Box>

        <Box flexDirection="column">
          <Text bold>Board approvals</Text>
          {p.approvals.length === 0 && <Text dimColor>None recorded.</Text>}
          {p.approvals.map(one => <Text wrap="truncate-end">{`${one.date} ${one.decision} — ${one.by}`}</Text>)}
        </Box>
      </Box>
    )
  })
}
