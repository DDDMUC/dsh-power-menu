'use strict'

/**
 * dsh-power-menu — detached handoff helper.
 *
 * Runs as Electron's Node mode (`ELECTRON_RUN_AS_NODE=1`) so it does not
 * depend on a system Node. It outlives the host because it is the only piece
 * that must survive the Electron main process being ended.
 *
 * Shutdown:
 *   1. wait for the browser to receive the HTTP acknowledgement;
 *   2. end ONLY the Electron main process (`taskkill /PID <main> /F`, no /T);
 *      the host's IPC channel then disconnects and the host runs its own
 *      graceful `application.shutdown`, flushing session logs;
 *   3. wait for the web port to be released (the host exits when done).
 *
 * Restart: the same, then wait for the port to free and relaunch the same
 * executable with a clean environment (ELECTRON_RUN_AS_NODE removed, or the
 * new instance would start without a window). Verify the new process stays
 * alive, retrying a couple of times; if it never comes up, show a message box.
 */

const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const MAIN_EXIT_TIMEOUT_MS = 15000
const PORT_FREE_TIMEOUT_MS = 30000
const HOST_EXIT_TIMEOUT_MS = 25000
const RELAUNCH_ATTEMPTS = 3
const RELAUNCH_VERIFY_MS = 2500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let LOG_PATH = ''

/** Append one diagnostic line; never throws. */
function note(line) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* no log is better than a failed action */
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Force-end one process. Returns whether taskkill reported success. */
function killPid(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Whether something is accepting connections on the loopback port. */
function listening(port) {
  return new Promise((resolve) => {
    let settled = false
    const probe = net.connect({ host: '127.0.0.1', port })
    const finish = (value) => {
      if (settled) return
      settled = true
      probe.destroy()
      resolve(value)
    }
    probe.on('connect', () => finish(true))
    probe.on('error', () => finish(false))
    probe.setTimeout(600, () => finish(false))
  })
}

async function waitFor(predicate, timeoutMs, stepMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await sleep(stepMs)
  }
  return await predicate()
}

/** Best-effort message box for the "app did not come back" path. */
function alertUser(text) {
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(text)}, 'DeepSeek Harness') | Out-Null`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    try {
      const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return true
    } catch {
      /* try the next shell */
    }
  }
  return false
}

async function performShutdown(handoff) {
  note('shutdown: ending the Electron main process (the host will close gracefully)')
  const killed = killPid(handoff.mainPid)
  note(killed ? `shutdown: taskkill /PID ${handoff.mainPid} /F ok` : `shutdown: taskkill reported an error for pid ${handoff.mainPid}`)

  const mainGone = await waitFor(() => !alive(handoff.mainPid), MAIN_EXIT_TIMEOUT_MS, 200)
  note(mainGone ? 'shutdown: main process exited' : `shutdown: main process still alive after ${MAIN_EXIT_TIMEOUT_MS}ms`)

  if (Number.isInteger(handoff.port) && handoff.port > 0) {
    const portFree = await waitFor(async () => !(await listening(handoff.port)), HOST_EXIT_TIMEOUT_MS, 300)
    note(portFree ? `shutdown: port ${handoff.port} released` : `shutdown: port ${handoff.port} still held`)
  }

  if (alive(handoff.hostPid)) {
    note(`shutdown: host ${handoff.hostPid} is still alive; ending it`)
    killPid(handoff.hostPid)
  } else {
    note('shutdown: host exited on its own')
  }
  note('shutdown: complete')
}

async function performRestart(handoff) {
  note('restart: ending the Electron main process (the host will close gracefully)')
  const killed = killPid(handoff.mainPid)
  note(killed ? `restart: taskkill /PID ${handoff.mainPid} /F ok` : `restart: taskkill reported an error for pid ${handoff.mainPid}`)

  const mainGone = await waitFor(() => !alive(handoff.mainPid), MAIN_EXIT_TIMEOUT_MS, 200)
  note(mainGone ? 'restart: main process exited' : `restart: main process still alive after ${MAIN_EXIT_TIMEOUT_MS}ms`)

  let portFree = true
  if (Number.isInteger(handoff.port) && handoff.port > 0) {
    portFree = await waitFor(async () => !(await listening(handoff.port)), PORT_FREE_TIMEOUT_MS, 300)
    note(portFree ? `restart: port ${handoff.port} released` : `restart: port ${handoff.port} still held`)
    if (!portFree) {
      if (alive(handoff.hostPid)) {
        note(`restart: host ${handoff.hostPid} still holds the port; ending it as a last resort (session logs may be incomplete)`)
        killPid(handoff.hostPid)
        await sleep(1500)
      }
      portFree = await waitFor(async () => !(await listening(handoff.port)), 5000, 300)
    }
  }

  // Give the socket and the filesystem a moment to settle before relaunching.
  await sleep(portFree ? 800 : 1500)

  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (upper === 'ELECTRON_RUN_AS_NODE' || upper === 'DSH_DESKTOP_NODE_EXECUTABLE') delete env[key]
  }

  const exe = String(handoff.exe ?? '')
  if (exe === '') {
    note('restart: no executable in the handoff; aborting')
    alertUser('重启失败：交接信息里没有应用路径。请手动启动 DeepSeek Harness。')
    return
  }

  let childPid = null
  for (let attempt = 1; attempt <= RELAUNCH_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      note(`restart: attempt ${attempt}/${RELAUNCH_ATTEMPTS} in 1500ms`)
      await sleep(1500)
    }
    let child = null
    try {
      child = spawn(exe, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: path.dirname(exe),
        env,
      })
      child.on('error', (error) => note(`restart: spawn error: ${String(error?.message ?? error)}`))
      child.unref()
      note(`restart: relaunched ${exe} as pid ${String(child.pid)}`)
    } catch (error) {
      note(`restart: spawn threw: ${String(error?.stack ?? error)}`)
      continue
    }

    await sleep(RELAUNCH_VERIFY_MS)
    if (Number.isInteger(child.pid) && alive(child.pid)) {
      note(`restart: new process ${String(child.pid)} is alive after ${RELAUNCH_VERIFY_MS}ms`)
      childPid = child.pid
      break
    }
    note(`restart: new process is already gone (attempt ${attempt})`)
  }

  if (childPid === null) {
    note('restart: application did not come back')
    const shown = alertUser(`重启失败：DeepSeek Harness 没能自动打开。\n\n请手动启动应用。\n日志：${LOG_PATH}`)
    note(shown ? 'restart: failure notice dispatched' : 'restart: could not dispatch the failure notice')
    return
  }

  if (Number.isInteger(handoff.port) && handoff.port > 0) {
    // The desktop app binds a fresh random port on every launch (`--port 0`),
    // so waiting for the NEW instance to take the OLD port would always time
    // out; the alive check above is the meaningful readiness signal.
    note(`restart: old port ${handoff.port} is no longer relevant; the new instance picks its own port`)
  }
  note('restart: complete')
}

async function main() {
  const handoffPath = process.argv[2]
  if (typeof handoffPath !== 'string' || handoffPath === '') process.exit(1)

  let handoff
  try {
    handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'))
  } catch {
    process.exit(1)
  }

  LOG_PATH = typeof handoff.logPath === 'string' && handoff.logPath !== ''
    ? handoff.logPath
    : path.join(path.dirname(handoffPath), 'helper.log')

  note(`helper started: helper=${process.pid} host=${String(handoff.hostPid)} main=${String(handoff.mainPid)} mode=${String(handoff.mode)}`)

  try {
    if (!Number.isInteger(handoff.mainPid) || handoff.mainPid <= 1) {
      note('refusing: the handoff carries no usable main process id')
      return
    }
    await sleep(Number.isFinite(handoff.delayMs) && handoff.delayMs > 0 ? handoff.delayMs : 1200)
    if (handoff.mode === 'restart') await performRestart(handoff)
    else await performShutdown(handoff)
  } catch (error) {
    note(`helper failed: ${String(error?.stack ?? error)}`)
  } finally {
    try {
      fs.unlinkSync(handoffPath)
    } catch {
      /* already gone */
    }
  }
}

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 0
  })
}
