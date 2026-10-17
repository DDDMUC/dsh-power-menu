/**
 * dsh-power-menu — host half.
 *
 * Adds three loopback-only HTTP routes used by the client-side power menu:
 *
 *   POST /api/dsh-power-menu/shutdown  — quit the whole desktop app
 *   POST /api/dsh-power-menu/restart   — quit, then relaunch the app
 *   GET  /api/dsh-power-menu/health    — whether this is the desktop build
 *
 * The host process is a child of the Electron main process in the desktop
 * build, so it cannot call app.quit() / app.relaunch() itself. The actual
 * handoff is performed by a detached helper (lib/helper.cjs) which kills only
 * the Electron main process (no /T). Killing the main closes the IPC channel;
 * the host then runs its own graceful `application.shutdown` and flushes the
 * session logs. For a restart the helper waits for the port to be released
 * and relaunches the same executable with a clean environment.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-power-menu'
export const inject = ['webServer']

const BASE = '/api/dsh-power-menu'
const HELPER = fileURLToPath(new URL('./helper.cjs', import.meta.url))
const STATE_DIR = join(homedir(), '.dsh', 'dsh-power-menu')
const LOG_PATH = join(STATE_DIR, 'power-menu.log')

/** At-most-once latch: restart and shutdown both end this process. */
let pending = null

function note(line) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    /* diagnostics must never break the action */
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/** Whether this host is the desktop build's child (Electron main as parent). */
function desktopTarget() {
  if (process.env.ELECTRON_RUN_AS_NODE !== '1') return null
  const mainPid = process.ppid
  if (!Number.isInteger(mainPid) || mainPid <= 1) return null
  const exe = process.execPath
  if (typeof exe !== 'string' || exe === '') return null
  return { mainPid, exe, hostPid: process.pid }
}

function resolvePort(ctx) {
  try {
    const port = ctx.webServer?.port
    if (Number.isInteger(port) && port > 0) return port
  } catch {
    /* fall through */
  }
  try {
    const address = ctx.webServer?.server?.address?.()
    if (address !== null && typeof address === 'object' && Number.isInteger(address.port) && address.port > 0) {
      return address.port
    }
  } catch {
    /* fall through */
  }
  return null
}

/**
 * Destructive routes are fenced the same way DSH fences its own API:
 * loopback socket, loopback Host header, no cross-site fetch, and an Origin
 * that (when present) equals this server.
 */
function trusted(req) {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const { host, origin, 'sec-fetch-site': secFetchSite } = req.headers
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname
  if (hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== '[::1]' && hostname !== 'localhost') return false
  if (secFetchSite === 'cross-site') return false
  if (origin === undefined) return true
  if (typeof origin !== 'string' || origin === 'null') return false
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Write the handoff file and start the detached helper.
 * @param {'shutdown'|'restart'} mode
 * @param {object} ctx
 */
function schedule(mode, ctx) {
  if (pending !== null) {
    return { ok: false, status: 409, error: `power transition already in progress: ${pending}` }
  }
  const target = desktopTarget()
  if (target === null) {
    return {
      ok: false,
      status: 409,
      error: '仅支持 DeepSeek Harness 桌面版（当前是 dsh web，请用终端里的进程管理方式）',
    }
  }
  if (!existsSync(HELPER)) return { ok: false, status: 500, error: `helper missing: ${HELPER}` }

  pending = mode
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 23)
    const handoffPath = join(STATE_DIR, `handoff-${mode}-${stamp}.json`)
    const logPath = join(STATE_DIR, `helper-${mode}-${stamp}.log`)
    const handoff = {
      mode,
      mainPid: target.mainPid,
      hostPid: target.hostPid,
      exe: target.exe,
      port: resolvePort(ctx),
      delayMs: 1200,
      logPath,
      handoffPath,
      startedAt: new Date().toISOString(),
    }
    writeFileSync(handoffPath, JSON.stringify(handoff, null, 2), 'utf8')
    note(`${mode}: scheduled main=${String(target.mainPid)} host=${String(target.hostPid)} exe=${target.exe} port=${String(handoff.port)} log=${logPath}`)

    const helper = spawn(process.execPath, [HELPER, handoffPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: dirname(HELPER),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    helper.on('error', (error) => {
      note(`${mode}: helper spawn error: ${String(error?.message ?? error)}`)
      pending = null
    })
    helper.unref()
    note(`${mode}: helper pid=${String(helper.pid)}`)
    return { ok: true, status: 202, mode }
  } catch (error) {
    pending = null
    const message = error instanceof Error ? error.message : String(error)
    note(`${mode}: failed to schedule: ${message}`)
    return { ok: false, status: 500, error: message }
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    handler: (req, res) => {
      let sub = '/'
      try {
        sub = new URL(req.url ?? '/', 'http://x').pathname.slice(BASE.length).replace(/\/+$/u, '') || '/'
      } catch {
        /* keep '/' */
      }

      if (sub === '/health') {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' })
        json(res, 200, {
          ok: true,
          desktop: desktopTarget() !== null,
          pending,
        })
        return
      }

      if (sub !== '/shutdown' && sub !== '/restart') {
        return json(res, 404, { ok: false, error: `no dsh-power-menu endpoint ${sub}` })
      }
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' })
      if (!trusted(req)) return json(res, 403, { ok: false, error: 'forbidden: untrusted power request' })

      const result = schedule(sub === '/restart' ? 'restart' : 'shutdown', ctx)
      if (!result.ok) return json(res, result.status ?? 500, result)
      json(res, result.status ?? 202, result)
    },
  }), 'dsh-power-menu: /api/dsh-power-menu routes')
}
