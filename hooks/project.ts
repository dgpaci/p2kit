import type { EngineInterface } from 'claude-code'

import type { Approval, CommitNote, Delivery, Issue, Light, Product, Project, Risk, RoleLine, StageDelivery, StageForge, Tolerance, WorkPackage } from '../types'
import { detectForge, getForgeJson, isReadyToClose, toMilestone, toPulls } from './forge'
import type { ForgeTarget } from './forge'
import { isNoteOf, LOG_FORMAT, parseCommits } from './notes'
import { findPlanPath, getPhaseSummary, parsePhases } from './stage'
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
// The forge state of a stage is read again only past this age, unless the refresh is forced.
const FORGE_TTL_MS = 5 * 60 * 1000
// Forgejo has no head filter: its pull requests are paged, most recently updated first, up to this many pages.
const FORGEJO_PULL_PAGES = 5
const FORGEJO_PAGE = 50

// The raw text of a project's .pm/ files, as the loader found them; paths are absolute.
export type ProjectFiles = {
  path: string
  project?: string
  products: { path: string; text: string }[]
  workPackages: { path: string; text: string }[]
  risks?: string
  issues?: string
  // The plan read from each linked stage's branch; `path` and `text` are '' when the branch has none.
  stagePlans?: { stage: number; ref: string; path: string; text: string }[]
  // `git log` of each linked stage's branch over its base, in LOG_FORMAT.
  stageLogs?: { stage: number; text: string }[]
  commitNotes?: string
  gitErrors?: string[]
}

type StageLink = Pick<StageDelivery, 'number' | 'name' | 'issue' | 'milestone' | 'branch' | 'base'>

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

/** The stages `project.yaml` links to an issue or a milestone. */
function getStageLinks(value: Value | undefined): StageLink[] {
  return docs(value).map(one => ({
    number: num(one.number), name: text(one.name), issue: num(one.issue),
    milestone: text(one.milestone), branch: text(one.branch), base: text(one.base),
  }))
}

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
  }

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

  const workPackages: WorkPackage[] = []
  for (const file of files.workPackages) {
    try {
      const { data: front } = parseFrontmatter(file.text)
      workPackages.push({
        path: file.path,
        id: text(front.id) || basename(file.path).replace(/\.md$/, ''),
        title: text(front.title),
        stage: num(front.stage),
        status: text(front.status) || 'draft',
        teamManager: text(front.team_manager),
        due: text(front.due),
      })
    } catch (error) {
      errors.push(`${basename(file.path)}: ${String(error)}`)
    }
  }
  workPackages.sort((a, b) => a.id.localeCompare(b.id))

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
    sha: text(note.sha), stage: num(note.stage), kind: text(note.kind),
    status: text(note.status) || 'open', text: text(note.text), date: text(note.date),
  }))

  const links = getStageLinks(data.stages)
  const stages: StageDelivery[] = links.map(link => {
    const plan = files.stagePlans?.find(one => one.stage === link.number)
    const log = files.stageLogs?.find(one => one.stage === link.number)
    const ofStage = link.number === null ? [] : notes.filter(note => note.stage === link.number)
    const commits = parseCommits(log?.text ?? '').map(commit => ({ ...commit, notes: ofStage.filter(note => isNoteOf(note, commit)) }))
    return {
      ...link, ref: plan?.ref ?? '', planPath: plan?.path ?? '', phases: parsePhases(plan?.text ?? ''),
      commits, unlinkedNotes: ofStage.filter(note => !commits.some(commit => isNoteOf(note, commit))), forge: null,
    }
  })
  stages.sort((a, b) => Number(b.number === stage.current) - Number(a.number === stage.current))
  errors.push(...(files.gitErrors ?? []))
  const linked = stages.find(one => one.number === stage.current)
  let delivery: Delivery | null = null
  if (linked && stage.current !== null) {
    const { done, total, current, failed } = getPhaseSummary(linked.phases)
    delivery = { stage: stage.current, done, total, current: current ? `Phase ${current.number}: ${current.title}` : '', failed }
  }

  const inStage = workPackages.filter(wp => wp.stage === stage.current && wp.status !== 'cancelled')
  const tolerances = getTolerances(data.tolerances)
  const reporting = isDoc(data.reporting) ? data.reporting : {}
  const every = num(reporting.highlight_every_days)
  const since = text(reporting.last_highlight) || stage.start
  const due = every && since ? addDays(since, every) : ''

  return {
    path: files.path,
    name: text(data.name) || basename(files.path),
    code: text(data.code),
    profile: text(data.profile) || 'light',
    status: text(data.status),
    stage,
    roles: getRoles(data.roles),
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
    stages,
    delivery,
    openBlockers: notes.filter(note => note.kind === 'blocker' && note.status === 'open').length,
    unstagedNotes: notes.filter(note => !links.some(link => link.number !== null && link.number === note.stage)),
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

/** Reads, from git only, the phased plan and the commits over its base on the branch of each linked stage. Never fetches. */
async function readStagePlans($: EngineInterface, path: string, links: StageLink[]): Promise<Pick<ProjectFiles, 'stagePlans' | 'stageLogs' | 'gitErrors'>> {
  const stagePlans: NonNullable<ProjectFiles['stagePlans']> = []
  const stageLogs: NonNullable<ProjectFiles['stageLogs']> = []
  const gitErrors: string[] = []
  for (const link of links) {
    if (!link.branch || link.number === null) continue
    const ref = await resolveRef($, path, link.branch)
    if (!ref) {
      gitErrors.push(`stage ${link.number}: branch ${link.branch} not found`)
      continue
    }
    const tree = await git($, path, ['ls-tree', '-r', '--name-only', ref, '--', '.phased'])
    const planPath = tree.ok ? findPlanPath(tree.stdout.split('\n').filter(Boolean), link.issue) : undefined
    const plan = planPath ? await git($, path, ['show', `${ref}:${planPath}`]) : undefined
    stagePlans.push(planPath && plan?.ok ? { stage: link.number, ref, path: planPath, text: plan.stdout } : { stage: link.number, ref, path: '', text: '' })

    let base = ''
    if (link.base) base = await resolveRef($, path, link.base)
    else {
      const head = await git($, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      if (head.ok) base = head.stdout.trim()
    }
    if (!base) {
      gitErrors.push(`stage ${link.number}: base ${link.base || 'origin/HEAD'} not found`)
      continue
    }
    const log = await git($, path, ['log', '--date=short', `--format=${LOG_FORMAT}`, `${base}..${ref}`])
    if (log.ok) stageLogs.push({ stage: link.number, text: log.stdout })
    else gitErrors.push(`stage ${link.number}: git log ${base}..${ref} failed`)
  }
  return { stagePlans, stageLogs, gitErrors }
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
  const project = await readIfExists($, `${pm}/project.yaml`)
  let links: StageLink[] = []
  try {
    const parsed = project === undefined ? undefined : parseYaml(project)
    if (isDoc(parsed)) links = getStageLinks(parsed.stages)
  } catch {
    // buildProject reports the parse error.
  }

  return {
    path,
    project,
    ...(await readStagePlans($, path, links)),
    products,
    workPackages: await listMarkdown($, `${pm}/work-packages`),
    risks: await readIfExists($, `${pm}/registers/risks.yaml`),
    issues: await readIfExists($, `${pm}/registers/issues.yaml`),
    commitNotes: await readIfExists($, `${pm}/registers/commit-notes.yaml`),
  }
}

/** Reads, GET only, the issue or milestone of a stage and the pull requests of its branch; failures go to `errors`. */
async function readStageForge($: EngineInterface, target: ForgeTarget, stage: StageDelivery, errors: string[]): Promise<StageForge> {
  const page = target.forge === 'github' ? 'per_page=100' : `limit=${FORGEJO_PAGE}`
  const get = async <T>(what: string, path: string): Promise<T | undefined> => {
    try {
      return (await getForgeJson($, target, `repos/${target.repo}/${path}`)) as T
    } catch (error) {
      errors.push(`stage ${stage.number}: ${target.forge} ${what}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  const forge: StageForge = { pulls: [], isReadyToClose: false }
  if (stage.issue !== null) {
    const issue = await get<{ number: number; title: string; state: string }>('issue', `issues/${stage.issue}`)
    if (issue) forge.issue = { number: issue.number, title: issue.title, state: issue.state }
  }
  if (stage.milestone) {
    const list = await get<Parameters<typeof toMilestone>[0]>('milestones', `milestones?state=all&${page}`)
    if (list) forge.milestone = toMilestone(list, stage.milestone)
  }
  if (stage.branch && target.forge === 'github') {
    const owner = target.repo.split('/')[0]
    const list = await get<Parameters<typeof toPulls>[0]>('pulls', `pulls?state=all&head=${owner}:${encodeURIComponent(stage.branch)}&${page}`)
    if (list) forge.pulls = toPulls(list, stage.branch)
  } else if (stage.branch) {
    for (let n = 1; n <= FORGEJO_PULL_PAGES; n++) {
      const list = await get<Parameters<typeof toPulls>[0]>('pulls', `pulls?state=all&sort=recentupdate&limit=${FORGEJO_PAGE}&page=${n}`)
      if (!list) break
      forge.pulls.push(...toPulls(list, stage.branch))
      if (list.length < FORGEJO_PAGE) break
    }
  }
  forge.isReadyToClose = isReadyToClose(forge.pulls)
  return forge
}

// The last forge read per project stage link, so the 60 s refresh does not hit the forge every time.
const forgeCache = new Map<string, { at: number; forge: StageForge; errors: string[] }>()

/** The project with the forge state of its current stage attached; a project with no linked current stage reads nothing. */
async function addForgeState($: EngineInterface, project: Project, isForced: boolean): Promise<Project> {
  const current = project.stages.find(one => one.number !== null && one.number === project.stage.current)
  if (!current || (current.issue === null && !current.milestone && !current.branch)) return project
  const origin = await git($, project.path, ['remote', 'get-url', 'origin'])
  const target = origin.ok ? detectForge(origin.stdout.trim()) : undefined
  if (!target) return project
  const key = [project.path, current.number, current.issue, current.milestone, current.branch].join('|')
  const now = await $.clock.now()
  const cached = forgeCache.get(key)
  let { forge, errors } = cached && !isForced && now - cached.at < FORGE_TTL_MS ? cached : { forge: undefined, errors: [] as string[] }
  if (!forge) {
    forge = await readStageForge($, target, current, errors)
    forgeCache.set(key, { at: now, forge, errors })
  }
  return { ...project, stages: project.stages.map(one => (one === current ? { ...one, forge } : one)), errors: [...project.errors, ...errors] }
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
        return await addForgeState($, buildProject(await readProjectFiles($, path), today), isForced)
      } catch (error) {
        const empty = buildProject({ path, products: [], workPackages: [] }, today)
        return { ...empty, errors: [`cannot read ${path}: ${String(error)}`] }
      }
    }),
  )
  return { projects, errors: [] }
}
