import type { BoardInput } from './board'

/** The desk as JSON, read by /pm-digest and /pm-report: the projects as the desk holds them, with when they were read. */
export function toSnapshot(input: BoardInput): string {
  return JSON.stringify({ version: 1, refreshedAt: new Date(input.refreshedAt).toISOString(), errors: input.errors, projects: input.projects }, null, 2)
}
