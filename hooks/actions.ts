import type { EngineInterface } from 'claude-code'

import type { Project } from '../types'

const DEEP_LINK = 'claude://code/new'

/** The Claude Desktop link that opens a new session in the project's repo, asking where the project stands. */
export function getSessionLink(project: Project): string {
  const q =
    `Project ${project.name}\n` +
    `[p2kit] I opened project "${project.name}" from the project desk. Read .pm/project.yaml and the registers ` +
    'and tell me in a few lines where it stands: stage, tolerances, open high risks and issues, next report due. ' +
    'Change nothing; follow the repo\'s CLAUDE.md.'
  const params = new URLSearchParams({ q, folder: project.path })
  return `${DEEP_LINK}?${params.toString().replaceAll('+', '%20')}`
}

// The prompt of a package session: the skill, then the references the user picked on the page.
// Plain text, not a slash command: Claude Desktop turns the leading `/` of a linked prompt into `／`,
// so a link never runs a command; the session reads the prompt and invokes the skill itself.
export const PACKAGE_PROMPT = '[p2kit] Use the p2kit:pm-package skill with:'

/**
 * The Claude Desktop link that opens a new session in the project's repo asking for the pm-package skill on `<refs>`.
 * The prompt is the last parameter, so the browser page appends the picked references to the link with no refs:
 * `getPackageLink(p, refs)` equals `getPackageLink(p, []) + encodeURIComponent(' ' + refs.join(' '))`.
 */
export function getPackageLink(project: Project, refs: string[]): string {
  const params = new URLSearchParams({ folder: project.path, q: PACKAGE_PROMPT })
  const tail = refs.length ? encodeURIComponent(` ${refs.join(' ')}`) : ''
  return `${DEEP_LINK}?${params.toString().replaceAll('+', '%20')}${tail}`
}

/** Opens a new Desktop session in the project's repo; the log says why when it does not open. */
export async function openSession($: EngineInterface, project: Project): Promise<void> {
  const { exitCode, stderr } = await $.process.run(['open', getSessionLink(project)])
  if (exitCode !== 0) $.ui.log(`p2kit: the Claude Desktop link did not open: ${stderr}`)
}

/** Opens a file with the system's default app. */
export async function openFile($: EngineInterface, path: string): Promise<void> {
  const { exitCode, stderr } = await $.process.run(['open', path])
  if (exitCode !== 0) $.ui.log(`p2kit: ${path} did not open: ${stderr}`)
}
