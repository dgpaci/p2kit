import type { EngineInterface } from 'claude-code'

import type { Approval, Issue, Light, Product, Project, Risk, RoleLine, Tolerance, WorkPackage } from '../types'
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

// The raw text of a project's .pm/ files, as the loader found them; paths are absolute.
export type ProjectFiles = {
  path: string
  project?: string
  products: { path: string; text: string }[]
  workPackages: { path: string; text: string }[]
  risks?: string
  issues?: string
}

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

  return {
    path,
    project: await readIfExists($, `${pm}/project.yaml`),
    products,
    workPackages: await listMarkdown($, `${pm}/work-packages`),
    risks: await readIfExists($, `${pm}/registers/risks.yaml`),
    issues: await readIfExists($, `${pm}/registers/issues.yaml`),
  }
}

/** Every registered project, read afresh; registry problems come back as errors. */
export async function loadProjects($: EngineInterface): Promise<{ projects: Project[]; errors: string[] }> {
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
        return buildProject(await readProjectFiles($, path), today)
      } catch (error) {
        const empty = buildProject({ path, products: [], workPackages: [] }, today)
        return { ...empty, errors: [`cannot read ${path}: ${String(error)}`] }
      }
    }),
  )
  return { projects, errors: [] }
}
