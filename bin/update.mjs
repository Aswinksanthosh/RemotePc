#!/usr/bin/env node
// Updates to the newest version from GitHub, then restarts the remote. Update.cmd runs this.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from '../src/app.mjs'
import { dataPaths, TASK_NAME } from '../src/paths.mjs'
import { run } from '../src/system.mjs'
import { stopRemoteScript, psArgs } from '../src/windows.mjs'
import { installUpdate, repoSlug } from '../src/updater.mjs'
import { createUi } from '../src/ui.mjs'

const paths = dataPaths()
const ui = createUi()
ui.title('Remote Start PC: update')
let pkg = {}
try {
  pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))
} catch {
  // Unknown project: the updater explains.
}
try {
  const r = await installUpdate({ repo: repoSlug(pkg), paths, force: process.argv.includes('--force') })
  if (!r.installed) {
    ui.ok(r.message)
    process.exit(0)
  }
  ui.ok(`Updated${r.sha ? ` to ${r.sha.slice(0, 7)}` : ''}.`)
  if (process.platform === 'win32') {
    await run('powershell.exe', psArgs(stopRemoteScript)).catch(() => {})
    await run('schtasks.exe', ['/run', '/tn', TASK_NAME]).catch(() => ui.warn('Could not restart it automatically: sign out and in again, or restart the PC.'))
    ui.ok('The remote was restarted. Reload the page on your phone in a few seconds.')
  }
} catch (err) {
  ui.fail(err.message)
  process.exit(1)
}
