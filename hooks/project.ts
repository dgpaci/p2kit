import type { EngineInterface } from 'claude-code'

import type { Approval, CommitNote, Issue, Light, Product, Project, Risk, RoleLine, Tolerance, WorkPackage, WpDelivery, WpForge } from '../types'
import { detectForge, getForgeJson, isReadyToClose, toMilestone, toPulls } from './forge'
import type { ForgeTarget, RestMilestone } from './forge'
import { toForgeIssues, toForgePulls, toMilestoneProgress } from './milestones'
import { isNoteOf, LOG_FORMAT, parseCommits } from './notes'
import { findPlanPath, getPhaseSummary, parsePhases } from './stage'
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
  gitErrors?: string[]
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

function getTolerances(value: Value | undefined): Tolerance[] {
  if (!isDoc(value)) return []
  return Object.entries(value).flatMap(([area, entry]) => {
    if (!isDoc(entry)) return []
    const limit = num(entry.limit)
    const used = num(entry.used) ?? 0
    if (limit === null) return []
    return [{ area, limit, used, unit: text(entry.unit), light: getLight(limit, used) }]
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

/** A work package file's frontmatter; `link` is null unless it names an issue, a milestone or a branch. Throws on bad YAML. */
function readWpFront(file: { path: string; text: string }): WpFront {
  const { data: front } = parseFrontmatter(file.text)
  const link = { issue: num(front.issue), milestone: text(front.milestone), branch: text(front.branch), base: text(front.base) }
  return {
    path: file.path,
    id: text(front.id) || basename(file.path).replace(/\.md$/, ''),
    title: text(front.title),
    stage: num(front.stage),
    status: text(front.status) || 'draft',
    teamManager: text(front.team_manager),
    due: text(front.due),
    link: link.issue !== null || link.milestone || link.branch ? link : null,
  }
}

export const isOpen = (wp: { status: string }): boolean => wp.status !== 'completed' && wp.status !== 'cancelled'

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
      })
    } catch (error) {
      errors.push(`${basename(file.path)}: ${String(error)}`)
    }
  }

  if (data.stages !== undefined) errors.push(STAGES_ERROR)

  const fronts: WpFront[] = []
  for (const file of files.workPackages) {
    try {
      const front = readWpFront(file)
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
    const { done, total, current, failed } = getPhaseSummary(phases)
    const delivery: WpDelivery = {
      ...link, ref: plan?.ref ?? '', planPath: plan?.path ?? '', phases,
      summary: { done, total, current: current ? `Phase ${current.number}: ${current.title}` : '', failed },
      commits, unlinkedNotes: ofWp.filter(note => !commits.some(commit => isNoteOf(note, commit))), forge: null,
    }
    return { ...wp, delivery }
  })
  workPackages.sort((a, b) => a.id.localeCompare(b.id))
  errors.push(...(files.gitErrors ?? []))

  const inStage = workPackages.filter(wp => wp.stage === stage.current && wp.status !== 'cancelled')
  const tolerances = getTolerances(data.tolerances)
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
    readiness,
    notReady: 0,
    tolerances,
    light: getWorstLight(tolerances.map(one => one.light)),
    progress: { done: inStage.filter(wp => wp.status === 'completed').length, total: inStage.length },
    highRisks: risks.filter(risk => risk.status === 'open' && risk.score >= HIGH_RISK).length,
    openIssues: issues.filter(issue => issue.status === 'open').length,
    nextReport: { due, isOverdue: Boolean(due) && due < today },
    documents,
    workPackages,
    risks,
    issues,
    approvals,
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
    if (!link?.branch || !isOpen(wp)) continue
    const ref = await resolveRef($, path, link.branch)
    if (!ref) {
      gitErrors.push(`${wp.id}: branch ${link.branch} not found`)
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
  const workPackages = await listMarkdown($, `${pm}/work-packages`)

  return {
    path,
    project: await readIfExists($, `${pm}/project.yaml`),
    ...(await readWpPlans($, path, workPackages)),
    products,
    workPackages,
    risks: await readIfExists($, `${pm}/registers/risks.yaml`),
    issues: await readIfExists($, `${pm}/registers/issues.yaml`),
    commitNotes: await readIfExists($, `${pm}/registers/commit-notes.yaml`),
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

/** The open linked work packages of the current stage: the ones the forge is read for. */
export const getWorkThemes = (project: Project): WorkPackage[] =>
  project.workPackages.filter(pkg => pkg.delivery && pkg.stage !== null && pkg.stage === project.stage.current && isOpen(pkg))

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
        return await addRepoState($, project, isForced, originTarget)
      } catch (error) {
        const empty = buildProject({ path, products: [], workPackages: [] }, today)
        return { ...empty, errors: [`cannot read ${path}: ${String(error)}`] }
      }
    }),
  )
  return { projects, errors: [] }
}
