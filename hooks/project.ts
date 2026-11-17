import type { EngineInterface } from 'claude-code'

import type { Approval, CommitNote, DailyEntry, Issue, Iteration, Lesson, Light, Product, Project, RetroAction, Retrospective, Risk, RoleLine, Tolerance, WorkPackage, WpDelivery, WpForge } from '../types'
import { FLOW_WINDOWS, getFirstReviewAt, toFlow } from './flow'
import { detectForge, getForgeJson, isReadyToClose, toMilestone, toPulls } from './forge'
import type { ForgeTarget, RestMilestone } from './forge'
import { toForgeIssues, toForgePulls, toMilestoneItems, toMilestoneProgress } from './milestones'
import type { RestMilestoneItem } from './milestones'
import { isNoteOf, LOG_FORMAT, parseCommits } from './notes'
import { findPlanPath, getPhaseSummary, parseObjective, parsePhaseOutcomes, parsePhases } from './stage'
import { readReadiness } from './readiness'
import { readTeam, toTeamItems, withItems } from './team'
import type { RestIssue, RestPull } from './team'
import { isDoc, parseFrontmatter, parseYaml } from './yaml'
import type { Doc, Value } from './yaml'

// The project registry, under the home folder.
export const REGISTRY_PATH = '.config/p2kit/projects.yaml'

const ROLE_LABEL: Record<string, string> = {
  executive: 'Executive',
  senior_user: 'Senior User',
  senior_supplier: 'Senior Supplier',
  project_manager: 'Project Manager',
  team_manager: 'Team Manager',
  assurance: 'Project Assurance',
  support: 'Project Support',
}

const LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3 }
// An open risk scoring this or more counts as high: high × medium and up.
const HIGH_RISK = 6
const DAY_MS = 24 * 60 * 60 * 1000
// git and the forge are cut off past this; a hung call would stall every later refresh.
const CALL_TIMEOUT_MS = 30 * 1000
// The forge state of a work package is read again only past this age, unless the refresh is forced.
const FORGE_TTL_MS = 5 * 60 * 1000
// Forgejo has no head filter: its pull requests are paged, most recently updated first, up to this many pages.
const FORGEJO_PULL_PAGES = 5
const FORGEJO_PAGE = 50
// The open issues and pull requests of a repo are paged up to this many pages each.
const TEAM_PAGES = 5
const GITHUB_PAGE = 100
// The closed issues and pull requests of a repo are read again only past this age, unless the refresh is forced; up to this many pages each.
const FLOW_TTL_MS = 60 * 60 * 1000
const FLOW_PAGES = 10
// The items of a work package's milestone are paged up to this many pages.
const MILESTONE_PAGES = 5
// The reviews of at most this many merged pulls are read per read of the closed lists, this many at a time.
const REVIEWS_PER_READ = 100
const REVIEW_BATCH = 10

// The raw text of a project's .pm/ files, as the loader found them; paths are absolute.
export type ProjectFiles = {
  path: string
  project?: string
  products: { path: string; text: string }[]
  workPackages: { path: string; text: string }[]
  risks?: string
  issues?: string
  // The plan read from each linked work package's branch; `path` and `text` are '' when the branch has none.
  wpPlans?: { wp: string; ref: string; path: string; text: string }[]
  // `git log` of each linked work package's branch over its base, in LOG_FORMAT.
  wpLogs?: { wp: string; text: string }[]
  commitNotes?: string
  iterations?: string
  lessons?: string
  dailyLog?: string
  gitErrors?: string[]
  // The files of the project.yaml `documents:` folders, with their title; `folder` is relative to the project.
  sharedDocs?: { folder: string; path: string; title: string }[]
  docErrors?: string[]
}

type WpLink = Pick<WpDelivery, 'issue' | 'milestone' | 'branch' | 'base'>
// What the loader and buildProject both read from a work package's frontmatter.
type WpFront = Omit<WorkPackage, 'delivery'> & { link: WpLink | null }

const CONTINUOUS_ERROR = 'stage.continuous: expected true or false'
const STAGES_ERROR = '.pm/project.yaml: stages: is no longer read — link the work packages with /pm-link (docs/pm-schema.md)'

const text = (value: Value | undefined): string => (value === null || value === undefined ? '' : String(value))
const num = (value: Value | undefined): number | null => (typeof value === 'number' ? value : null)
const list = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value])
const docs = (value: Value | undefined): Doc[] => list(value).filter(isDoc)
const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** The light of one tolerance: green under 75 % of the limit, amber under 100 %, red at or over it. */
export function getLight(limit: number, used: number): Light {
  if (limit <= 0) return used > 0 ? 'red' : 'green'
  const ratio = used / limit
  return ratio >= 1 ? 'red' : ratio >= 0.75 ? 'amber' : 'green'
}

const LIGHT_RANK: Record<Light, number> = { none: 0, green: 1, amber: 2, red: 3 }

/** The worst of the lights; `none` when there is none. */
export const getWorstLight = (lights: Light[]): Light =>
  lights.reduce<Light>((worst, one) => (LIGHT_RANK[one] > LIGHT_RANK[worst] ? one : worst), 'none')

/** The tolerances of project.yaml; the `effort` area takes the stage overrun as `used` when the work packages carry the figures. */
function getTolerances(value: Value | undefined, effort: Project['effort']): Tolerance[] {
  if (!isDoc(value)) return []
  return Object.entries(value).flatMap(([area, entry]) => {
    if (!isDoc(entry)) return []
    const limit = num(entry.limit)
    const isComputed = area === 'effort' && effort !== null
    const used = isComputed ? Math.max(0, effort.deviation) : num(entry.used) ?? 0
    if (limit === null) return []
    return [{ area, limit, used, unit: text(entry.unit), light: getLight(limit, used), isComputed }]
  })
}

function getRoles(value: Value | undefined): RoleLine[] {
  if (!isDoc(value)) return []
  return Object.entries(value).map(([role, people]) => ({
    role,
    label: ROLE_LABEL[role] ?? role,
    people: list(people).map(text).filter(Boolean),
  }))
}

const getScore = (probability: string, impact: string): number => (LEVEL[probability] ?? 0) * (LEVEL[impact] ?? 0)

/** Adds `days` to an ISO date; '' when the date does not parse. */
export function addDays(date: string, days: number): string {
  const time = Date.parse(date)
  return Number.isNaN(time) ? '' : new Date(time + days * DAY_MS).toISOString().slice(0, 10)
}

/** Hours rounded to two decimals, so sums of decimal figures print clean (2.2 + 1.1 = 3.3). */
const getRoundedHours = (hours: number): number => Math.round(hours * 100) / 100

/** Actual − estimate when completed or archived, the overrun only while open; null when cancelled or a figure is missing. */
function getDeviation(status: string, estimate: number | null, actual: number | null): number | null {
  if (estimate === null || actual === null || status === 'cancelled') return null
  const deviation = getRoundedHours(actual - estimate)
  return isDone({ status }) ? deviation : Math.max(0, deviation)
}

/** A work package file's frontmatter; `link` is null unless it names an issue, a milestone or a branch. Throws on bad YAML; a bad figure goes to `errors`. */
function readWpFront(file: { path: string; text: string }, errors: string[] = []): WpFront {
  const { data: front } = parseFrontmatter(file.text)
  const link = { issue: num(front.issue), milestone: text(front.milestone), branch: text(front.branch), base: text(front.base) }
  const id = text(front.id) || basename(file.path).replace(/\.md$/, '')
  const status = text(front.status) || 'draft'
  const hours = (key: 'estimate' | 'actual'): number | null => {
    if (front[key] !== undefined && front[key] !== null && typeof front[key] !== 'number') errors.push(`${id}: ${key} is not a number`)
    return num(front[key])
  }
  const estimate = hours('estimate')
  const actual = hours('actual')
  const horizon = text(front.horizon)
  if (horizon && !HORIZONS.includes(horizon)) errors.push(`${id}: horizon ${horizon} is not now, next or later`)
  if (front.rank !== undefined && front.rank !== null && typeof front.rank !== 'number') errors.push(`${id}: rank is not a number`)
  return {
    path: file.path,
    id,
    title: text(front.title),
    stage: num(front.stage),
    status,
    teamManager: text(front.team_manager),
    due: text(front.due),
    estimate,
    actual,
    deviation: getDeviation(status, estimate, actual),
    horizon: HORIZONS.includes(horizon) ? horizon : '',
    rank: num(front.rank),
    link: link.issue !== null || link.milestone || link.branch ? link : null,
  }
}

const HORIZONS = ['now', 'next', 'later']

/** The open work packages per horizon, by rank (none last) then id; the open ones with no horizon are unplaced, by id. A duplicate id counts once. */
function getRoadmap(workPackages: WorkPackage[]): Project['roadmap'] {
  const open = workPackages.filter(isOpen)
  const byRank = (a: WorkPackage, b: WorkPackage) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id)
  const ids = (horizon: string) => [...new Set(open.filter(wp => wp.horizon === horizon).sort(byRank).map(wp => wp.id))]
  return { now: ids('now'), next: ids('next'), later: ids('later'), unplaced: ids('') }
}

/** The effort sums over the work packages of the current stage, not cancelled, carrying both figures; null when there is none. */
function getStageEffort(current: number | null, workPackages: WorkPackage[]): Project['effort'] {
  const counted = workPackages.filter(wp => wp.stage === current && wp.status !== 'cancelled' && wp.estimate !== null && wp.actual !== null)
  if (current === null || counted.length === 0) return null
  const sum = (pick: (wp: WorkPackage) => number) => getRoundedHours(counted.reduce((total, wp) => total + pick(wp), 0))
  return { stage: current, estimate: sum(wp => wp.estimate!), actual: sum(wp => wp.actual!), deviation: sum(wp => wp.deviation!), counted: counted.length }
}

/** Delivered: `completed`, or `archived` once the Board has seen it. */
export const isDone = (wp: { status: string }): boolean => wp.status === 'completed' || wp.status === 'archived'

export const isOpen = (wp: { status: string }): boolean => !isDone(wp) && wp.status !== 'cancelled'

/** Still a work theme of the desk: open, or completed and not yet archived. */
export const isShown = (wp: { status: string }): boolean => wp.status !== 'archived' && wp.status !== 'cancelled'

/** Reads one register file: the list under `key`, or the error that stopped it. */
function readRegister(name: string, raw: string | undefined, key: string, errors: string[]): Doc[] {
  if (raw === undefined) return []
  try {
    const parsed = parseYaml(raw)
    return isDoc(parsed) ? docs(parsed[key]) : []
  } catch (error) {
    errors.push(`${name}: ${String(error)}`)
    return []
  }
}

/** The iterations register, ascending number; an open entry or a work package unknown goes to `errors`. */
function readIterations(raw: string | undefined, workPackages: WorkPackage[], errors: string[]): Iteration[] {
  const iterations: Iteration[] = readRegister('iterations.yaml', raw, 'iterations', errors).map(one => ({
    number: num(one.number) ?? 0, goal: text(one.goal), start: text(one.start), end: text(one.end), stage: num(one.stage),
    status: text(one.status) || 'open', workPackages: list(one.work_packages).map(text), delivered: list(one.delivered).map(text),
    result: text(one.result),
  }))
  iterations.sort((a, b) => a.number - b.number)
  const open = iterations.filter(one => one.status === 'open')
  if (open.length > 1) errors.push(`iterations: more than one open (${open.map(one => one.number).join(', ')})`)
  for (const one of iterations) {
    for (const id of one.workPackages) if (!workPackages.some(wp => wp.id === id)) errors.push(`iterations: ${one.number}: unknown work package ${id}`)
  }
  return iterations
}

/** The Lessons Log, parsed once: a broken file is one error and three empty lists. */
function readLessons(raw: string | undefined, errors: string[]): Pick<Project, 'retrospectives' | 'lessons' | 'actions' | 'lastRetro'> {
  let data: Doc = {}
  try {
    const parsed = raw === undefined ? {} : parseYaml(raw)
    if (isDoc(parsed)) data = parsed
  } catch (error) {
    errors.push(`lessons.yaml: ${String(error)}`)
  }
  const retrospectives: Retrospective[] = docs(data.retrospectives).map(one => ({ date: text(one.date), iteration: num(one.iteration), stage: num(one.stage) }))
  const lessons: Lesson[] = docs(data.lessons).map(one => ({ id: text(one.id), date: text(one.date), iteration: num(one.iteration), kind: text(one.kind), text: text(one.text) }))
  const actions: RetroAction[] = docs(data.actions).map(one => ({
    id: text(one.id), date: text(one.date), text: text(one.text), issue: num(one.issue), status: text(one.status) || 'open',
  }))
  const lastRetro = retrospectives.map(one => one.date).reduce((last, date) => (date > last ? date : last), '')
  return { retrospectives, lessons, actions, lastRetro }
}

/** The Daily Log in file order, its latest date; an open action past its `due` is overdue on `today`. */
function readDailyLog(raw: string | undefined, today: string, errors: string[]): Pick<Project, 'dailyLog' | 'lastLog'> {
  const dailyLog: DailyEntry[] = readRegister('daily-log.yaml', raw, 'entries', errors).map(one => {
    const kind = text(one.kind)
    const status = kind === 'action' ? text(one.status) || 'open' : ''
    const due = text(one.due)
    return {
      id: text(one.id), date: text(one.date), kind, source: text(one.source), text: text(one.text), owner: text(one.owner), due, status,
      issue: num(one.issue), register: text(one.register), ref: text(one.ref), isOverdue: status === 'open' && Boolean(due) && due < today,
    }
  })
  return { dailyLog, lastLog: dailyLog.map(one => one.date).reduce((last, date) => (date > last ? date : last), '') }
}

/** The open iteration with the highest number, with its progress; null when none is open. */
function getCurrentIteration(iterations: Iteration[], workPackages: WorkPackage[], today: string): Project['iteration'] {
  const current = iterations.filter(one => one.status === 'open').pop()
  if (!current) return null
  const own = workPackages.filter(wp => current.workPackages.includes(wp.id) && wp.status !== 'cancelled')
  return {
    ...current, done: own.filter(isDone).length, planned: own.length,
    isOverdue: Boolean(current.end) && current.end < today,
  }
}

/** The desk's view of a project from the text of its files; `today` is an ISO date. */
export function buildProject(files: ProjectFiles, today: string): Project {
  const errors: string[] = []
  let data: Doc = {}
  if (files.project === undefined) errors.push('.pm/project.yaml not found')
  else {
    try {
      const parsed = parseYaml(files.project)
      if (isDoc(parsed)) data = parsed
      else errors.push('.pm/project.yaml: not a map')
    } catch (error) {
      errors.push(`.pm/project.yaml: ${String(error)}`)
    }
  }

  const stageDoc = isDoc(data.stage) ? data.stage : {}
  const stage = {
    current: num(stageDoc.current),
    name: text(stageDoc.name),
    start: text(stageDoc.start),
    plannedEnd: text(stageDoc.planned_end),
    isContinuous: stageDoc.continuous === true,
  }
  if (stageDoc.continuous !== undefined && typeof stageDoc.continuous !== 'boolean') errors.push(CONTINUOUS_ERROR)

  const documents: Product[] = []
  for (const file of files.products) {
    try {
      const { data: front } = parseFrontmatter(file.text)
      documents.push({
        path: file.path,
        title: text(front.title) || basename(file.path),
        product: text(front.product),
        status: text(front.status) || 'draft',
        version: text(front.version),
        folder: '',
      })
    } catch (error) {
      errors.push(`${basename(file.path)}: ${String(error)}`)
    }
  }

  for (const doc of files.sharedDocs ?? []) documents.push({ path: doc.path, title: doc.title, product: 'shared', status: '', version: '', folder: doc.folder })
  errors.push(...(files.docErrors ?? []))

  if (data.stages !== undefined) errors.push(STAGES_ERROR)

  const fronts: WpFront[] = []
  for (const file of files.workPackages) {
    try {
      const front = readWpFront(file, errors)
      const twin = fronts.find(one => one.id === front.id)
      if (twin) errors.push(`duplicate work package id ${front.id} (${basename(twin.path)}, ${basename(front.path)})`)
      fronts.push(front)
    } catch (error) {
      errors.push(`${basename(file.path)}: ${String(error)}`)
    }
  }

  const risks: Risk[] = readRegister('risks.yaml', files.risks, 'risks', errors).map(risk => {
    const probability = text(risk.probability)
    const impact = text(risk.impact)
    return {
      id: text(risk.id), title: text(risk.title), probability, impact,
      status: text(risk.status) || 'open', owner: text(risk.owner), score: getScore(probability, impact),
    }
  })
  const issues: Issue[] = readRegister('issues.yaml', files.issues, 'issues', errors).map(issue => ({
    id: text(issue.id), title: text(issue.title), type: text(issue.type),
    priority: text(issue.priority), status: text(issue.status) || 'open',
  }))
  const approvals: Approval[] = docs(data.approvals).map(one => ({
    decision: text(one.decision), by: text(one.by), date: text(one.date), note: text(one.note),
  }))

  const notes: CommitNote[] = readRegister('commit-notes.yaml', files.commitNotes, 'notes', errors).map(note => ({
    sha: text(note.sha), wp: text(note.wp), kind: text(note.kind),
    status: text(note.status) || 'open', text: text(note.text), date: text(note.date),
  }))

  const workPackages: WorkPackage[] = fronts.map(({ link, ...wp }) => {
    if (!link) return { ...wp, delivery: null }
    const plan = files.wpPlans?.find(one => one.wp === wp.id)
    const log = files.wpLogs?.find(one => one.wp === wp.id)
    const ofWp = notes.filter(note => note.wp === wp.id)
    const commits = parseCommits(log?.text ?? '').map(commit => ({ ...commit, notes: ofWp.filter(note => isNoteOf(note, commit)) }))
    const phases = parsePhases(plan?.text ?? '')
    const outcomes = parsePhaseOutcomes(plan?.text ?? '')
    const { done, total, current, failed } = getPhaseSummary(phases)
    const delivery: WpDelivery = {
      ...link, ref: plan?.ref ?? '', planPath: plan?.path ?? '', objective: parseObjective(plan?.text ?? ''),
      phases: phases.map(phase => ({ ...phase, outcome: outcomes[phase.number] ?? '' })),
      summary: { done, total, current: current ? `Phase ${current.number}: ${current.title}` : '', failed },
      commits, unlinkedNotes: ofWp.filter(note => !commits.some(commit => isNoteOf(note, commit))), forge: null,
    }
    return { ...wp, delivery }
  })
  workPackages.sort((a, b) => a.id.localeCompare(b.id))
  errors.push(...(files.gitErrors ?? []))

  const iterations = readIterations(files.iterations, workPackages, errors)
  const inStage = workPackages.filter(wp => wp.stage === stage.current && wp.status !== 'cancelled')
  const effort = getStageEffort(stage.current, workPackages)
  const tolerances = getTolerances(data.tolerances, effort)
  const reporting = isDoc(data.reporting) ? data.reporting : {}
  const every = num(reporting.highlight_every_days)
  const since = text(reporting.last_highlight) || stage.start
  const due = every && since ? addDays(since, every) : ''

  const roles = getRoles(data.roles)
  const team = readTeam(roles, data.team, errors)
  const readiness = readReadiness(data.readiness, errors)

  return {
    path: files.path,
    name: text(data.name) || basename(files.path),
    code: text(data.code),
    profile: text(data.profile) || 'light',
    status: text(data.status),
    stage,
    roles,
    team,
    milestones: [],
    forgeIssues: [],
    forgePulls: [],
    flow: null,
    readiness,
    notReady: 0,
    tolerances,
    light: getWorstLight(tolerances.map(one => one.light)),
    progress: { done: inStage.filter(isDone).length, total: inStage.length },
    effort,
    highRisks: risks.filter(risk => risk.status === 'open' && risk.score >= HIGH_RISK).length,
    openIssues: issues.filter(issue => issue.status === 'open').length,
    nextReport: { due, isOverdue: Boolean(due) && due < today },
    documents,
    workPackages,
    risks,
    issues,
    approvals,
    iterations,
    iteration: getCurrentIteration(iterations, workPackages, today),
    ...readLessons(files.lessons, errors),
    ...readDailyLog(files.dailyLog, today, errors),
    roadmap: getRoadmap(workPackages),
    openBlockers: notes.filter(note => note.kind === 'blocker' && note.status === 'open').length,
    unthemedNotes: notes.filter(note => !workPackages.some(pkg => pkg.delivery && pkg.id === note.wp)),
    errors,
  }
}

/** The project folders the registry names; `~` is the home folder. */
export function parseRegistry(raw: string, home: string): string[] {
  const parsed = parseYaml(raw)
  if (!isDoc(parsed)) return []
  return docs(parsed.projects)
    .map(entry => text(entry.path).replace(/^~(?=\/|$)/, home))
    .filter(Boolean)
}

async function readIfExists($: EngineInterface, path: string): Promise<string | undefined> {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
}

/** The Markdown files of a folder, absolute paths, sorted; none when it is missing. */
async function listMarkdown($: EngineInterface, folder: string): Promise<{ path: string; text: string }[]> {
  if (!(await $.fs.exists(folder))) return []
  const entries = (await $.fs.list(folder)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return Promise.all(entries.map(async entry => ({ path: `${folder}/${entry.name}`, text: await $.fs.read(`${folder}/${entry.name}`) })))
}

async function git($: EngineInterface, path: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const { exitCode, stdout } = await $.process.run(['git', '-C', path, ...args], { timeoutMs: CALL_TIMEOUT_MS })
  return { ok: exitCode === 0, stdout }
}

/** The first of `branch`, `origin/<branch>` that resolves locally; '' when neither does. */
async function resolveRef($: EngineInterface, path: string, branch: string): Promise<string> {
  for (const candidate of [branch, `origin/${branch}`]) {
    if ((await git($, path, ['rev-parse', '--verify', '--quiet', candidate])).ok) return candidate
  }
  return ''
}

/** Reads, from git only, the phased plan and the commits over its base on the branch of each open linked work package. Never fetches. */
async function readWpPlans($: EngineInterface, path: string, files: ProjectFiles['workPackages']): Promise<Pick<ProjectFiles, 'wpPlans' | 'wpLogs' | 'gitErrors'>> {
  const wpPlans: NonNullable<ProjectFiles['wpPlans']> = []
  const wpLogs: NonNullable<ProjectFiles['wpLogs']> = []
  const gitErrors: string[] = []
  for (const file of files) {
    let wp: WpFront
    try {
      wp = readWpFront(file)
    } catch {
      continue // buildProject reports the parse error.
    }
    const link = wp.link
    if (!link?.branch || !isShown(wp)) continue
    const ref = await resolveRef($, path, link.branch)
    if (!ref) {
      // A completed work package's branch is often deleted after the merge: not an error.
      if (isOpen(wp)) gitErrors.push(`${wp.id}: branch ${link.branch} not found`)
      continue
    }
    const tree = await git($, path, ['ls-tree', '-r', '--name-only', ref, '--', '.phased'])
    const planPath = tree.ok ? findPlanPath(tree.stdout.split('\n').filter(Boolean), link.issue) : undefined
    const plan = planPath ? await git($, path, ['show', `${ref}:${planPath}`]) : undefined
    wpPlans.push(planPath && plan?.ok ? { wp: wp.id, ref, path: planPath, text: plan.stdout } : { wp: wp.id, ref, path: '', text: '' })

    let base = ''
    if (link.base) base = await resolveRef($, path, link.base)
    else {
      const head = await git($, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      if (head.ok) base = head.stdout.trim()
    }
    if (!base) {
      gitErrors.push(`${wp.id}: base ${link.base || 'origin/HEAD'} not found`)
      continue
    }
    const log = await git($, path, ['log', '--date=short', `--format=${LOG_FORMAT}`, `${base}..${ref}`])
    if (log.ok) wpLogs.push({ wp: wp.id, text: log.stdout })
    else gitErrors.push(`${wp.id}: git log ${base}..${ref} failed`)
  }
  return { wpPlans, wpLogs, gitErrors }
}

// The files of a shared documents folder the desk lists; images and the rest stay out.
const SHARED_DOC = /\.(html?|md|pdf)$/i
const SHARED_DEPTH = 3
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»' }

/** The title a shared document shows: an HTML `<title>`, a Markdown `title:` or first `# ` heading, else the file name. */
export function getDocumentTitle(name: string, text: string): string {
  const html = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]
  const markdown = /^title:\s*['"]?(.+?)['"]?\s*$/m.exec(text)?.[1] ?? /^# (.+)$/m.exec(text)?.[1]
  const found = (name.toLowerCase().endsWith('.md') ? markdown : html)?.trim()
  if (!found) return name.replace(/\.[^.]+$/, '')
  return found.replace(/&(#\d+|[a-z]+);/gi, (entity, code: string) =>
    code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? entity)
}

/** The documents of the project.yaml `documents:` folders, subfolders included, sorted by folder then name. */
async function readSharedDocs($: EngineInterface, path: string, project: string | undefined): Promise<Pick<ProjectFiles, 'sharedDocs' | 'docErrors'>> {
  let folders: Value | undefined
  try {
    const data = project ? parseYaml(project) : undefined
    folders = isDoc(data) ? data.documents : undefined
  } catch {
    return {} // buildProject reports the parse error.
  }
  if (folders === undefined) return {}
  if (!Array.isArray(folders)) return { docErrors: ['.pm/project.yaml: documents: must be a list of folders'] }
  const sharedDocs: NonNullable<ProjectFiles['sharedDocs']> = []
  const docErrors: string[] = []
  const walk = async (folder: string, depth: number): Promise<void> => {
    const entries = await $.fs.list(`${path}/${folder}`)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    // The files of a folder come before its subfolders, so each folder's group is whole.
    for (const entry of entries.filter(one => one.kind === 'file' && SHARED_DOC.test(one.name))) {
      const text = entry.name.toLowerCase().endsWith('.pdf') ? '' : await $.fs.read(`${path}/${folder}/${entry.name}`)
      sharedDocs.push({ folder, path: `${path}/${folder}/${entry.name}`, title: getDocumentTitle(entry.name, text) })
    }
    if (depth < SHARED_DEPTH) for (const entry of entries.filter(one => one.kind === 'dir')) await walk(`${folder}/${entry.name}`, depth + 1)
  }
  for (const one of folders) {
    const folder = String(one).replace(/^\/+|\/+$/g, '')
    if (!(await $.fs.exists(`${path}/${folder}`))) docErrors.push(`documents: folder ${folder} not found`)
    else await walk(folder, 1)
  }
  return { sharedDocs, docErrors }
}

/** Reads the .pm/ folder of the project at `path`. */
export async function readProjectFiles($: EngineInterface, path: string): Promise<ProjectFiles> {
  const pm = `${path}/.pm`
  const products = await listMarkdown($, pm)
  if (await $.fs.exists(`${pm}/stages`)) {
    const stages = (await $.fs.list(`${pm}/stages`)).filter(entry => entry.kind === 'dir')
    stages.sort((a, b) => Number(a.name) - Number(b.name) || a.name.localeCompare(b.name))
    for (const stage of stages) products.push(...(await listMarkdown($, `${pm}/stages/${stage.name}`)))
  }
  products.push(...(await listMarkdown($, `${pm}/reports`)))
  products.push(...(await listMarkdown($, `${pm}/digests`)))
  products.push(...(await listMarkdown($, `${pm}/presentations`)))
  const workPackages = await listMarkdown($, `${pm}/work-packages`)
  const project = await readIfExists($, `${pm}/project.yaml`)

  return {
    path,
    project,
    ...(await readSharedDocs($, path, project)),
    ...(await readWpPlans($, path, workPackages)),
    products,
    workPackages,
    risks: await readIfExists($, `${pm}/registers/risks.yaml`),
    issues: await readIfExists($, `${pm}/registers/issues.yaml`),
    commitNotes: await readIfExists($, `${pm}/registers/commit-notes.yaml`),
    iterations: await readIfExists($, `${pm}/registers/iterations.yaml`),
    lessons: await readIfExists($, `${pm}/registers/lessons.yaml`),
    dailyLog: await readIfExists($, `${pm}/registers/daily-log.yaml`),
  }
}

type PullList = Parameters<typeof toPulls>[0]
// The Forgejo pull list of one project read, with the reason it stopped short, if it did.
type SharedPulls = { list: PullList; failure?: string }

/** Reads, GET only, the issue or milestone of a work package and the pull requests of its branch; failures go to `errors`. */
async function readWpForge(
  $: EngineInterface, target: ForgeTarget, id: string, link: WpDelivery, errors: string[], shared: { pulls?: Promise<SharedPulls> },
): Promise<WpForge> {
  const page = target.forge === 'github' ? 'per_page=100' : `limit=${FORGEJO_PAGE}`
  const get = async <T>(what: string, path: string): Promise<T | undefined> => {
    try {
      return (await getForgeJson($, target, `repos/${target.repo}/${path}`)) as T
    } catch (error) {
      errors.push(`${id}: ${target.forge} ${what}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  const forge: WpForge = { pulls: [], isReadyToClose: false }
  if (link.issue !== null) {
    const issue = await get<{ number: number; title: string; state: string }>('issue', `issues/${link.issue}`)
    if (issue) forge.issue = { number: issue.number, title: issue.title, state: issue.state }
  }
  if (link.milestone) {
    const list = await get<Parameters<typeof toMilestone>[0]>('milestones', `milestones?state=all&${page}`)
    if (list) forge.milestone = toMilestone(list, link.milestone)
    const found = list?.find(one => one.title === link.milestone)
    const ref = target.forge === 'github' ? found?.number : found?.id
    if (ref !== undefined) {
      // Every issue and pull request of the milestone, any state: the issues list carries both on either forge.
      const query = target.forge === 'github' ? `issues?milestone=${ref}&state=all&per_page=100` : `issues?state=all&milestones=${ref}&limit=${FORGEJO_PAGE}`
      const size = target.forge === 'github' ? 100 : FORGEJO_PAGE
      const items: RestMilestoneItem[] = []
      for (let n = 1; n <= MILESTONE_PAGES; n++) {
        const batch = await get<RestMilestoneItem[]>('milestone items', `${query}&page=${n}`)
        if (!batch) break
        items.push(...batch)
        if (batch.length < size) break
      }
      forge.milestoneItems = toMilestoneItems(items)
    }
  }
  if (link.branch && target.forge === 'github') {
    const owner = target.repo.split('/')[0]
    const list = await get<Parameters<typeof toPulls>[0]>('pulls', `pulls?state=all&head=${owner}:${encodeURIComponent(link.branch)}&${page}`)
    if (list) forge.pulls = toPulls(list, link.branch)
  } else if (link.branch) {
    // Forgejo has no head filter: the repo's pull list is paged once per read of the project and shared by its work packages.
    shared.pulls ??= (async () => {
      const list: PullList = []
      try {
        for (let n = 1; n <= FORGEJO_PULL_PAGES; n++) {
          const batch = (await getForgeJson($, target, `repos/${target.repo}/pulls?state=all&sort=recentupdate&limit=${FORGEJO_PAGE}&page=${n}`)) as PullList
          list.push(...batch)
          if (batch.length < FORGEJO_PAGE) break
        }
        return { list }
      } catch (error) {
        return { list, failure: error instanceof Error ? error.message : String(error) }
      }
    })()
    const { list, failure } = await shared.pulls
    // Every work package reading the shared list reports its failure, not only the first.
    if (failure) errors.push(`${id}: forgejo pulls: ${failure}`)
    forge.pulls = toPulls(list, link.branch)
  }
  forge.isReadyToClose = isReadyToClose(forge.pulls)
  return forge
}

// The last forge read per project work package link, so the 60 s refresh does not hit the forge every time.
const forgeCache = new Map<string, { at: number; forge: WpForge; errors: string[] }>()

/** The linked work packages of the current stage, open or completed but not archived: the ones the forge is read for. */
export const getWorkThemes = (project: Project): WorkPackage[] =>
  project.workPackages.filter(pkg => pkg.delivery && pkg.stage !== null && pkg.stage === project.stage.current && isShown(pkg))

// The forge of a project's origin, asked of git at most once per project read, and only when called.
type OriginTarget = () => Promise<ForgeTarget | undefined>

function getOriginTarget($: EngineInterface, path: string): OriginTarget {
  let target: Promise<ForgeTarget | undefined> | undefined
  return () => (target ??= git($, path, ['remote', 'get-url', 'origin']).then(origin => (origin.ok ? detectForge(origin.stdout.trim()) : undefined)))
}

/** The project with the forge state of its open linked work packages of the current stage attached; with none, nothing is read. */
async function addForgeState($: EngineInterface, project: Project, isForced: boolean, originTarget: OriginTarget): Promise<Project> {
  const themes = getWorkThemes(project)
  if (themes.length === 0) return project
  const target = await originTarget()
  if (!target) return project
  const now = await $.clock.now()
  const allErrors: string[] = []
  const forges = new Map<string, WpForge>()
  const shared: { pulls?: Promise<SharedPulls> } = {}
  for (const { id, delivery } of themes) {
    const key = [project.path, id, delivery.issue, delivery.milestone, delivery.branch].join('|')
    const cached = forgeCache.get(key)
    let { forge, errors } = cached && !isForced && now - cached.at < FORGE_TTL_MS ? cached : { forge: undefined, errors: [] as string[] }
    if (!forge) {
      forge = await readWpForge($, target, id, delivery!, errors, shared)
      forgeCache.set(key, { at: now, forge, errors })
    }
    forges.set(id, forge)
    allErrors.push(...errors)
  }
  const workPackages = project.workPackages.map(pkg => (pkg.delivery && forges.has(pkg.id) ? { ...pkg, delivery: { ...pkg.delivery, forge: forges.get(pkg.id)! } } : pkg))
  return { ...project, workPackages, errors: [...project.errors, ...allErrors] }
}

/** Reads, GET only, every page of an open list of the repo, up to TEAM_PAGES; failures go to `errors` and leave the list empty. */
async function readOpenList<T>($: EngineInterface, target: ForgeTarget, what: 'issues' | 'pulls', errors: string[]): Promise<T[]> {
  const size = target.forge === 'github' ? GITHUB_PAGE : FORGEJO_PAGE
  const query = target.forge === 'github' ? `per_page=${size}` : `${what === 'issues' ? 'type=issues&' : ''}limit=${size}`
  const list: T[] = []
  try {
    for (let n = 1; n <= TEAM_PAGES; n++) {
      const batch = (await getForgeJson($, target, `repos/${target.repo}/${what}?state=open&${query}&page=${n}`)) as T[]
      list.push(...batch)
      if (batch.length < size) break
    }
    return list
  } catch (error) {
    errors.push(`team: ${target.forge} ${what}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

// The last read of each project's repo: open issues, pull requests and milestones, shared by the team and the milestones.
const repoCache = new Map<string, { at: number; issues: RestIssue[]; pulls: RestPull[]; milestones: RestMilestone[]; errors: string[] }>()

/** Reads, GET only, the open milestones of the repo, one page; a failure goes to `errors` and leaves the list empty. */
async function readMilestones($: EngineInterface, target: ForgeTarget, errors: string[]): Promise<RestMilestone[]> {
  const query = target.forge === 'github' ? `per_page=${GITHUB_PAGE}` : `limit=${FORGEJO_PAGE}`
  try {
    return (await getForgeJson($, target, `repos/${target.repo}/milestones?state=open&${query}`)) as RestMilestone[]
  } catch (error) {
    errors.push(`milestones: ${target.forge} milestones: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

/** The project with its team items, milestones, open issues and open pull requests, from one read of its repo; a project whose origin is not a forge reads nothing. */
async function addRepoState($: EngineInterface, project: Project, isForced: boolean, originTarget: OriginTarget): Promise<Project> {
  const target = await originTarget()
  if (!target) return project
  const now = await $.clock.now()
  let read = repoCache.get(project.path)
  if (!read || isForced || now - read.at >= FORGE_TTL_MS) {
    const errors: string[] = []
    const [issues, pulls, milestones] = await Promise.all([
      readOpenList<RestIssue>($, target, 'issues', errors),
      readOpenList<RestPull>($, target, 'pulls', errors),
      readMilestones($, target, errors),
    ])
    read = { at: now, issues, pulls, milestones, errors }
    repoCache.set(project.path, read)
  }
  const { issues, pulls, milestones, errors } = read
  const team = project.team.map(member => (member.login ? withItems(member, toTeamItems(member.login, issues, pulls, now)) : member))
  const forgeIssues = toForgeIssues(issues, project.readiness)
  return {
    ...project,
    team,
    milestones: toMilestoneProgress(milestones, issues, pulls, now),
    forgeIssues,
    forgePulls: toForgePulls(pulls),
    notReady: forgeIssues.filter(issue => issue.missing.length > 0).length,
    errors: [...project.errors, ...errors],
  }
}

// The last read of each project's closed issues and pull requests; first reviews per `<repo>#<pull>`, kept for the module's life.
const flowCache = new Map<string, { at: number; issues: RestIssue[]; pulls: RestPull[]; errors: string[] }>()
const firstReviewCache = new Map<string, string | null>()

/** Reads, GET only, the closed issues and pulls of the last 90 days and the first reviews of the merged pulls not yet known. */
async function readFlow($: EngineInterface, target: ForgeTarget, now: number): Promise<{ issues: RestIssue[]; pulls: RestPull[]; errors: string[] }> {
  const errors: string[] = []
  const fail = (what: string, error: unknown) => {
    const line = `flow: ${target.forge} ${what}: ${error instanceof Error ? error.message : String(error)}`
    if (!errors.includes(line)) errors.push(line)
  }
  const from = now - FLOW_WINDOWS[FLOW_WINDOWS.length - 1] * DAY_MS
  const size = target.forge === 'github' ? GITHUB_PAGE : FORGEJO_PAGE
  const since = new Date(from).toISOString()
  const query = target.forge === 'github'
    ? { issues: `issues?state=closed&since=${since}&per_page=${size}`, pulls: `pulls?state=closed&sort=updated&direction=desc&per_page=${size}` }
    : { issues: `issues?state=closed&type=issues&since=${since}&limit=${size}`, pulls: `pulls?state=closed&sort=recentupdate&limit=${size}` }
  const readPages = async <T extends { updated_at: string }>(what: 'issues' | 'pulls'): Promise<T[]> => {
    const list: T[] = []
    try {
      for (let n = 1; n <= FLOW_PAGES; n++) {
        const batch = (await getForgeJson($, target, `repos/${target.repo}/${query[what]}&page=${n}`)) as T[]
        list.push(...batch)
        if (batch.length < size) break
        if (what === 'pulls' && Date.parse(batch[batch.length - 1].updated_at) < from) break
      }
    } catch (error) {
      fail(what, error)
    }
    return list
  }
  const [issues, pulls] = await Promise.all([readPages<RestIssue>('issues'), readPages<RestPull>('pulls')])
  const unknown = pulls
    .filter(pull => pull.merged_at && Date.parse(pull.merged_at) > from && !firstReviewCache.has(`${target.repo}#${pull.number}`))
    .sort((a, b) => b.merged_at!.localeCompare(a.merged_at!))
    .slice(0, REVIEWS_PER_READ)
  for (let n = 0; n < unknown.length; n += REVIEW_BATCH) {
    await Promise.all(unknown.slice(n, n + REVIEW_BATCH).map(async pull => {
      try {
        const reviews = await getForgeJson($, target, `repos/${target.repo}/pulls/${pull.number}/reviews${target.forge === 'github' ? `?per_page=${GITHUB_PAGE}` : ''}`)
        firstReviewCache.set(`${target.repo}#${pull.number}`, getFirstReviewAt(reviews as Parameters<typeof getFirstReviewAt>[0], pull.user?.login ?? ''))
      } catch (error) {
        fail('reviews', error)
      }
    }))
  }
  return { issues, pulls, errors }
}

/** The project with the flow of its last 90 days; a project whose origin is not a forge reads nothing and keeps flow null. */
async function addFlow($: EngineInterface, project: Project, isForced: boolean, originTarget: OriginTarget): Promise<Project> {
  const target = await originTarget()
  if (!target) return project
  const now = await $.clock.now()
  let read = flowCache.get(project.path)
  if (!read || isForced || now - read.at >= FLOW_TTL_MS) {
    read = { at: now, ...(await readFlow($, target, now)) }
    flowCache.set(project.path, read)
  }
  const firstReviews: Record<number, string> = {}
  for (const pull of read.pulls) {
    const at = firstReviewCache.get(`${target.repo}#${pull.number}`)
    if (at) firstReviews[pull.number] = at
  }
  return { ...project, flow: toFlow(read.issues, read.pulls, firstReviews, now), errors: [...project.errors, ...read.errors] }
}

/** Every registered project, read afresh; registry problems come back as errors. */
export async function loadProjects($: EngineInterface, isForced = false): Promise<{ projects: Project[]; errors: string[] }> {
  const home = (await $.env.get('HOME')) ?? ''
  const registry = `${home}/${REGISTRY_PATH}`
  if (!(await $.fs.exists(registry))) return { projects: [], errors: [] }
  let paths: string[]
  try {
    paths = parseRegistry(await $.fs.read(registry), home)
  } catch (error) {
    return { projects: [], errors: [`~/${REGISTRY_PATH}: ${String(error)}`] }
  }
  const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const projects = await Promise.all(
    paths.map(async path => {
      try {
        const originTarget = getOriginTarget($, path)
        const project = await addForgeState($, buildProject(await readProjectFiles($, path), today), isForced, originTarget)
        // The open and the closed items are read side by side; the flow's own errors follow the repo's.
        const [repo, flowed] = await Promise.all([addRepoState($, project, isForced, originTarget), addFlow($, project, isForced, originTarget)])
        return { ...repo, flow: flowed.flow, errors: [...repo.errors, ...flowed.errors.slice(project.errors.length)] }
      } catch (error) {
        const empty = buildProject({ path, products: [], workPackages: [] }, today)
        return { ...empty, errors: [`cannot read ${path}: ${String(error)}`] }
      }
    }),
  )
  return { projects, errors: [] }
}
