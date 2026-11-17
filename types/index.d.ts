export type Light = 'green' | 'amber' | 'red' | 'none'

// `isComputed` when `used` comes from the work packages (the `effort` area with stage figures), not from project.yaml.
export type Tolerance = { area: string; limit: number; used: number; unit: string; light: Light; isComputed: boolean }

export type RoleLine = { role: string; label: string; people: string[] }

// A Markdown product: brief, PID, stage plan, report.
// `folder` is '' for a product of .pm/, else the project.yaml `documents:` folder the file was found in, with its subfolder.
export type Product = { path: string; title: string; product: string; status: string; version: string; folder: string }

export type WorkPackage = {
  path: string
  id: string
  title: string
  stage: number | null
  status: string
  teamManager: string
  due: string
  // Hours from the frontmatter, null when absent or not a number. `deviation` is actual − estimate on a completed work package,
  // the overrun only (never below 0) on an open one, null when a figure is missing or the work package is cancelled.
  estimate: number | null
  actual: number | null
  deviation: number | null
  // Roadmap placement: `horizon` now | next | later, '' when absent or unknown; `rank` 1 = first, null when absent.
  horizon: string
  rank: number | null
  // Its work theme, when it links an issue, a milestone or a branch; null otherwise.
  delivery: WpDelivery | null
}

export type Risk = { id: string; title: string; probability: string; impact: string; status: string; owner: string; score: number }

export type Issue = { id: string; title: string; type: string; priority: string; status: string }

export type Approval = { decision: string; by: string; date: string; note: string }

// A timebox of the stage, from `.pm/registers/iterations.yaml`; `status` is 'open' or 'closed'.
export type Iteration = {
  number: number
  goal: string
  start: string
  end: string
  stage: number | null
  status: string
  workPackages: string[]
  delivered: string[]
  result: string
}

// The Lessons Log, `.pm/registers/lessons.yaml`: retrospectives held, lessons (`kind` 'keep' or 'change'), actions ('open' or 'done').
export type Retrospective = { date: string; iteration: number | null; stage: number | null }
export type Lesson = { id: string; date: string; iteration: number | null; kind: string; text: string }
export type RetroAction = { id: string; date: string; text: string; issue: number | null; status: string }

// One line of the Daily Log, `.pm/registers/daily-log.yaml` (/pm-log). `kind` is event | decision | action | problem | note;
// `source` forge | meeting | manual ('' when absent); `owner`, `due`, `ref`, `register` are '' when absent; `status` is 'open'
// or 'done' on an action, '' on any other kind; `isOverdue` when an open action is past its `due`.
export type DailyEntry = {
  id: string; date: string; kind: string; source: string; text: string; owner: string; due: string; status: string
  issue: number | null; register: string; ref: string; isOverdue: boolean
}

export type PhaseState = 'done' | 'in-progress' | 'todo' | 'failed' | 'blocked'

// One phase of the phased-workflow plan found on a work package's branch.
export type Phase = { number: number; title: string; state: PhaseState }

// A phase as the desk shows it: what it adds, its `> Done:` summary or else its `- Done:` criterion ('' when none).
export type PlanPhase = Phase & { outcome: string }

// A commit of a work package's branch, from local git.
export type Commit = { sha: string; short: string; date: string; subject: string }

// An internal note on a commit, from `.pm/registers/commit-notes.yaml`.
// `wp` is the work package it belongs to, '' when absent.
export type CommitNote = { sha: string; wp: string; kind: string; status: string; text: string; date: string }

// A pull request of a work package's branch.
export type Pull = { number: number; title: string; state: 'open' | 'merged' | 'closed'; url: string }

// A forge milestone: open and closed issues, due date as an ISO day or ''.
export type Milestone = { title: string; open: number; closed: number; due: string }
// An open milestone with its open items untouched for over 7 days and its open non-draft pulls waiting on a reviewer.
export type MilestoneProgress = Milestone & { stalled: number; inReview: number }
// An open issue of the repo; `createdAt` and `updatedAt` ISO days ('' when the forge gave no creation time), `milestone` its title or '', `missing` the readiness headings its body lacks.
export type ForgeIssue = { number: number; title: string; url: string; createdAt: string; updatedAt: string; milestone: string; missing: string[] }
// An open pull request of the repo; `inReview` when it is not a draft and waits on a requested reviewer.
export type ForgePull = { number: number; title: string; url: string; createdAt: string; updatedAt: string; milestone: string; draft: boolean; inReview: boolean }

// An issue or a pull request of a work package's milestone, any state.
export type MilestoneItem = { kind: 'issue' | 'pr'; number: number; title: string; url: string; state: 'open' | 'closed' | 'merged' }

// What the forge says about a work package: its issue or milestone with every item in it, the pull requests of its branch.
export type WpForge = {
  issue?: { number: number; title: string; state: string }
  milestone?: Milestone
  milestoneItems?: MilestoneItem[]
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
  // The plan's `## Objective`, '' when none.
  objective: string
  phases: PlanPhase[]
  // `current` is 'Phase N: title', '' when every phase is done.
  summary: { done: number; total: number; current: string; failed: number }
  // The commits of the branch over its base, newest first, each with its notes.
  commits: (Commit & { notes: CommitNote[] })[]
  // Notes of this work package matching no listed commit, e.g. after a squash merge.
  unlinkedNotes: CommitNote[]
  // Read by loadProjects for the open work packages of the current stage; null otherwise or when there is no forge.
  forge: WpForge | null
}

// The status of an open issue or pull request from one team member's point of view.
export type TeamStatus = 'review' | 'inprogress' | 'todo' | 'waiting' | 'stalled'
// `updatedAt` is an ISO day.
export type TeamItem = { kind: 'issue' | 'pr'; number: number; title: string; status: TeamStatus; url: string; updatedAt: string }
// One person of the roles; `login` is '' when team.people gives none. WIP counts every item but `review`.
export type TeamMember = { person: string; login: string; roles: string[]; items: TeamItem[]; wip: number; wipLimit: number; isOverLimit: boolean }

// Median and nearest-rank p90 in days, one decimal; null when count is 0.
export type FlowStat = { count: number; median: number | null; p90: number | null }
// One window of the last `days` days: lead time (issue opened -> closed), first review and merge time (pull opened -> first review,
// -> merged), and the issues closed and pulls merged per UTC ISO week, `week` its Monday, oldest first.
export type FlowWindow = { days: number; leadTime: FlowStat; firstReview: FlowStat; merge: FlowStat; throughput: { week: string; issues: number; pulls: number }[] }
// An issue closed or a pull merged; `closedAt` an ISO day, `milestone` its title or ''.
export type ClosedItem = { number: number; title: string; url: string; closedAt: string; milestone: string }
// The 30- then 90-day windows, and the issues closed and pulls merged in the 90 days, most recently closed first.
export type Flow = { windows: FlowWindow[]; closedIssues: ClosedItem[]; mergedPulls: ClosedItem[] }

export type Project = {
  path: string
  name: string
  code: string
  profile: string
  status: string
  // A continuous stage has no end: the desk shows open and completed work packages instead of a percentage.
  stage: { current: number | null; name: string; start: string; plannedEnd: string; isContinuous: boolean }
  roles: RoleLine[]
  // The people of the roles, once each; their items are read by loadProjects from the forge.
  team: TeamMember[]
  // The repo's open milestones, issues and pull requests, read by loadProjects from the forge.
  milestones: MilestoneProgress[]
  forgeIssues: ForgeIssue[]
  forgePulls: ForgePull[]
  // Flow metrics of the last 90 days, read by loadProjects from the forge; null when the origin is not a forge.
  flow: Flow | null
  // The readiness headings in force (project.yaml `readiness.headings` or the default) and the open issues lacking one.
  readiness: string[]
  notReady: number
  tolerances: Tolerance[]
  light: Light
  // Work packages of the current stage: completed over not cancelled.
  progress: { done: number; total: number }
  // Hours over the work packages of the current stage, not cancelled, carrying both figures; null when there is none.
  effort: { stage: number; estimate: number; actual: number; deviation: number; counted: number } | null
  highRisks: number
  openIssues: number
  nextReport: { due: string; isOverdue: boolean }
  documents: Product[]
  workPackages: WorkPackage[]
  risks: Risk[]
  issues: Issue[]
  approvals: Approval[]
  // Every iteration, ascending number; the open one (the highest when several) with its completed and not cancelled work packages.
  iterations: Iteration[]
  iteration: (Iteration & { done: number; planned: number; isOverdue: boolean }) | null
  // The Lessons Log in file order; `lastRetro` the latest retrospective date, '' when none.
  retrospectives: Retrospective[]
  lessons: Lesson[]
  actions: RetroAction[]
  lastRetro: string
  // The Daily Log in file order; `lastLog` its latest date, '' when none.
  dailyLog: DailyEntry[]
  lastLog: string
  // Ids of the open work packages (neither completed nor cancelled) per horizon, by rank then id (no rank last); `unplaced` by id.
  roadmap: { now: string[]; next: string[]; later: string[]; unplaced: string[] }
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
    // `view` is that project's body: '' the recap, `tab:<id>`, `theme:<WP-id>`.
    // `members` are the people the Team tab shows; empty shows everyone. `notReadyOnly` keeps the not-ready issues in the Activity tab.
    p2kit: { projects: Shaped<Project[]>; selected: Shaped<string>; view: Shaped<string>; members: Shaped<string[]>; notReadyOnly: Shaped<boolean>; meta: Shaped<Meta> }
  }
}
