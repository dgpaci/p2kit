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
}

export type Risk = { id: string; title: string; probability: string; impact: string; status: string; owner: string; score: number }

export type Issue = { id: string; title: string; type: string; priority: string; status: string }

export type Approval = { decision: string; by: string; date: string; note: string }

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
