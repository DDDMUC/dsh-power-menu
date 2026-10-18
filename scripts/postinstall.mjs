#!/usr/bin/env node
/**
 * Post-install hook: make a fresh install usable without a second
 * "enable" step.
 *
 * DSH's plugin manager writes the package into `dependencies` but does not
 * always add it to `dsh.profile.bundles` (the Git/file install path can leave
 * that list untouched). Without the bundle entry the host half never loads,
 * so the client calls `/api/dsh-power-menu/*` and gets HTTP 404.
 *
 * This hook walks up from the installed package to the profile manifest and
 * appends the package name to `dsh.profile.bundles` when it is missing. It is
 * a no-op for link/workspace installs and for non-DSH directories.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const PLUGIN = 'dsh-power-menu'

async function findProfile(start) {
  let dir = resolve(start)
  for (let depth = 0; depth < 10; depth += 1) {
    const file = join(dir, 'package.json')
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(await readFile(file, 'utf8'))
        if (pkg?.dsh?.profile && typeof pkg.dsh.profile === 'object') {
          return { file, pkg }
        }
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const profile = await findProfile(process.cwd())
if (profile === null) process.exit(0)

const profileConfig = profile.pkg.dsh.profile
const bundles = Array.isArray(profileConfig.bundles) ? profileConfig.bundles : []
if (bundles.includes(PLUGIN)) process.exit(0)

profileConfig.bundles = [...bundles, PLUGIN]
try {
  await writeFile(profile.file, `${JSON.stringify(profile.pkg, null, 2)}\n`, 'utf8')
  console.log(`[${PLUGIN}] added to dsh.profile.bundles; restart DSH to load the host half.`)
} catch (error) {
  console.warn(`[${PLUGIN}] could not update dsh.profile.bundles automatically:`, error?.message ?? error)
  console.warn(`[${PLUGIN}] add "${PLUGIN}" to dsh.profile.bundles in the profile package.json, then restart DSH.`)
}
