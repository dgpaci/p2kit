import type { EngineInterface } from 'claude-code'

// The helper's own report, under the home folder: `{ port, pid }`, written once it listens.
const INFO_PATH = '.claude/p2kit/desk-server.json'
// How long the helper may take to say it listens, and a health check to answer.
const START_MS = 5 * 1000
const HEALTH_MS = 2 * 1000

// The helper this module started; '' while none runs. A reload of the module kills it.
let started: Promise<string> | undefined

/** The helper script inside the plugin, whichever of the plugin folder or its `.claude-plugin` the engine names. */
async function getScriptPath($: EngineInterface): Promise<string> {
  const root = $.plugin.root.replace(/\/\.claude-plugin\/?$/, '')
  return `${root}/server/desk_server.py`
}

/** Races `promise` against `ms`, cancelling the sleep once the answer is in; undefined on time out. */
async function within<T>($: EngineInterface, ms: number, promise: Promise<T>): Promise<T | undefined> {
  const stop = new AbortController()
  const timeout = $.clock.sleep(ms, { signal: stop.signal }).then(() => undefined, () => undefined)
  return Promise.race([promise, timeout]).finally(() => stop.abort())
}

/** The URL of a helper already listening, another session's included; '' when none answers. */
async function findRunning($: EngineInterface): Promise<string> {
  const path = `${await $.env.get('HOME')}/${INFO_PATH}`
  if (!(await $.fs.exists(path))) return ''
  const info = JSON.parse(await $.fs.read(path)) as { port?: unknown }
  if (typeof info.port !== 'number') return ''
  const url = `http://127.0.0.1:${info.port}/`
  const res = await within($, HEALTH_MS, $.http.fetch(`${url}health`).catch(() => undefined))
  return res?.ok ? url : ''
}

/**
 * Starts the helper with python3 for the module's life and resolves its URL once it listens; '' when it cannot start.
 * Each `changed <path>` it prints after a write calls `onChange`, so the desk is read again at once.
 */
function spawnServer($: EngineInterface, home: string, script: string, onChange: () => void): Promise<string> {
  return new Promise(resolve => {
    void (async () => {
      let buffer = ''
      try {
        const child = $.process.spawn({ argv: ['python3', script, '--home', home] })
        for await (const { stream, text } of child) {
          if (stream === 'stderr') {
            $.ui.log(`p2kit desk helper: ${text.trimEnd()}`, { to: 'debug' })
            continue
          }
          buffer += text
          for (let cut = buffer.indexOf('\n'); cut >= 0; cut = buffer.indexOf('\n')) {
            const line = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 1)
            if (line.startsWith('listening ')) resolve(`http://127.0.0.1:${line.slice('listening '.length).trim()}/`)
            else if (line.startsWith('changed ')) onChange()
          }
        }
      } catch (error) {
        $.ui.log(`p2kit: the desk helper did not start (python3 missing?): ${String(error)}`, { to: 'debug' })
      }
      started = undefined
      resolve('')
    })()
  })
}

/**
 * The URL of the desk helper: one already running, else one started now; '' when python3 is missing or it does not
 * answer, and the browser desk then stays the read-only file.
 */
export async function getDeskServer($: EngineInterface, onChange: () => void): Promise<string> {
  const running = await findRunning($).catch(() => '')
  if (running) return running
  const home = await $.env.get('HOME')
  started ??= spawnServer($, home ?? '', await getScriptPath($), onChange)
  return (await within($, START_MS, started)) ?? ''
}
