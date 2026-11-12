export type Light = 'green' | 'amber' | 'red' | 'none'

export type Tolerance = { area: string; limit: number; used: number; unit: string; light: Light }

export type RoleLine = { role: string; label: string; people: string[] }

// A Markdown product: brief, PID, stage plan, report.
export type Product = { path: string; title: string; product: string; status: string; version: string }

export type WorkPackage = {
  path: string
  id: string
  title: string
  stage: number | null
  status: string
  teamManager: string
  due: string
  // Its work theme, when it links an issue, a milestone or a branch; null otherwise.
  delivery: WpDelivery | null
}

export type Risk = { id: string; title: string; probability: string; impact: string; status: string; owner: string; score: number }

export type Issue = { id: string; title: string; type: string; priority: string; status: string }

export type Approval = { decision: string; by: string; date: string; note: string }

export type PhaseState = 'done' | 'in-progress' | 'todo' | 'failed' | 'blocked'

// One phase of the phased-workflow plan found on a work package's branch.
export type Phase = { number: number; title: string; state: PhaseState }

// A commit of a work package's branch, from local git.
export type Commit = { sha: string; short: string; date: string; subject: string }

// An internal note on a commit, from `.pm/registers/commit-notes.yaml`.
// `wp` is the work package it belongs to, '' when absent.
export type CommitNote = { sha: string; wp: string; kind: string; status: string; text: string; date: string }

// A pull request of a work package's branch.
export type Pull = { number: number; title: string; state: 'open' | 'merged' | 'closed'; url: string }

// A forge milestone: open and closed issues, due date as an ISO day or ''.
export type Milestone = { title: string; open: number; closed: number; due: string }

// What the forge says about a work package: its issue or milestone, the pull requests of its branch.
export type WpForge = {
  issue?: { number: number; title: string; state: string }
  milestone?: Milestone
  pulls: Pull[]
  isReadyToClose: boolean
}

// A work package linked to an issue, a milestone or a branch; `ref` and `planPath` are '' when not found.
export type WpDelivery = {
  issue: number | null
  milestone: string
  branch: string
  base: string
  ref: string
  planPath: string
  phases: Phase[]
  // `current` is 'Phase N: title', '' when every phase is done.
  summary: { done: number; total: number; current: string; failed: number }
  // The commits of the branch over its base, newest first, each with its notes.
  commits: (Commit & { notes: CommitNote[] })[]
  // Notes of this work package matching no listed commit, e.g. after a squash merge.
  unlinkedNotes: CommitNote[]
  // Read by loadProjects for the open work packages of the current stage; null otherwise or when there is no forge.
  forge: WpForge | null
}

export type Project = {
  path: string
  name: string
  code: string
  profile: string
  status: string
  stage: { current: number | null; name: string; start: string; plannedEnd: string }
  roles: RoleLine[]
  tolerances: Tolerance[]
  light: Light
  // Work packages of the current stage: completed over not cancelled.
  progress: { done: number; total: number }
  highRisks: number
  openIssues: number
  nextReport: { due: string; isOverdue: boolean }
  documents: Product[]
  workPackages: WorkPackage[]
  risks: Risk[]
  issues: Issue[]
  approvals: Approval[]
  // Open blocker notes over the whole commit-notes register.
  openBlockers: number
  // Notes naming no linked work package: counted, so shown too.
  unthemedNotes: CommitNote[]
  // What could not be read; a project with errors is still listed.
  errors: string[]
}

// The last read of the registry: when it ended, what went wrong, whether one is running.
export type Meta = { refreshedAt: number; errors: string[]; isLoading: boolean }

declare module 'claude-code' {
  interface PluginState {
    // `selected` is the path of the project the pane drills into; '' shows the overview.
    p2kit: { projects: Shaped<Project[]>; selected: Shaped<string>; meta: Shaped<Meta> }
  }
}
