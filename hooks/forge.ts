import type { EngineInterface } from 'claude-code'

import type { Milestone, Pull } from '../types'

// Where forgejo-cli (`fj`) keeps its tokens, under the home folder.
const KEYS = 'Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const TIMEOUT_MS = 30 * 1000

export type ForgeTarget = { forge: 'github' | 'forgejo'; host: string; repo: string }

/** The forge of a remote URL: github.com is GitHub, any other host Forgejo; undefined when the URL is not a repo URL. */
export function detectForge(url: string): ForgeTarget | undefined {
  const match =
    /^[\w.-]+@([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) ??
    /^(?:ssh|https?):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
  if (!match) return undefined
  const host = match[1].toLowerCase()
  return { forge: host === 'github.com' ? 'github' : 'forgejo', host, repo: `${match[2]}/${match[3]}` }
}

type RestPull = { number: number; title: string; state: string; merged_at?: string | null; html_url: string; head?: { ref?: string } }

/** The pull requests whose head is `branch`, merged told apart from closed. */
export function toPulls(list: RestPull[], branch: string): Pull[] {
  return list
    .filter(pull => pull.head?.ref === branch)
    .map(pull => ({
      number: pull.number,
      title: pull.title,
      state: pull.merged_at ? 'merged' : pull.state === 'open' ? 'open' : 'closed',
      url: pull.html_url,
    }))
}

type RestMilestone = { title: string; open_issues: number; closed_issues: number; due_on?: string | null }

/** The milestone titled `title`, with its due date as an ISO day ('' when none). */
export function toMilestone(list: RestMilestone[], title: string): Milestone | undefined {
  const found = list.find(one => one.title === title)
  return found && { title: found.title, open: found.open_issues, closed: found.closed_issues, due: found.due_on ? found.due_on.slice(0, 10) : '' }
}

/** Ready to close: at least one pull request merged and none open. */
export const isReadyToClose = (pulls: Pull[]): boolean =>
  pulls.some(pull => pull.state === 'merged') && !pulls.some(pull => pull.state === 'open')

/** One GET on the forge's REST API; `path` is relative to the API root (`repos/<repo>/…`). Throws a one-line reason. */
export async function getForgeJson($: EngineInterface, target: ForgeTarget, path: string): Promise<unknown> {
  if (target.forge === 'github') {
    const { exitCode, stdout, stderr } = await $.process.run(['gh', 'api', path], { timeoutMs: TIMEOUT_MS })
    if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh exited ${exitCode}`)
    return JSON.parse(stdout)
  }
  const keysPath = `${await $.env.get('HOME')}/${KEYS}`
  const keys = (await $.fs.exists(keysPath)) ? JSON.parse(await $.fs.read(keysPath)) : undefined
  const token: unknown = keys?.hosts?.[target.host]?.token
  if (typeof token !== 'string' || !token) throw new Error(`no fj token for ${target.host}`)
  // http.fetch takes no timeout: race it against a sleep that is cancelled once the answer is in.
  const stop = new AbortController()
  const timeout = $.clock.sleep(TIMEOUT_MS, { signal: stop.signal }).then(() => { throw new Error(`no answer in ${TIMEOUT_MS / 1000} s`) })
  timeout.catch(() => undefined)
  const res = await Promise.race([
    $.http.fetch(`https://${target.host}/api/v1/${path}`, { headers: { Authorization: `token ${token}`, Accept: 'application/json' } }),
    timeout,
  ]).finally(() => stop.abort())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return JSON.parse(res.text)
}
