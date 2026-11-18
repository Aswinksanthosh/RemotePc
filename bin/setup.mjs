#!/usr/bin/env node
// The installer. Install.cmd / install.ps1 call this once Node.js is there. Safe to run again.
//   node bin/setup.mjs [--source <folder with the program>] [--skip-tailscale]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { PROJECT_ROOT } from '../src/app.mjs'
import { appendLog } from '../src/fsutil.mjs'
import { dataPaths } from '../src/paths.mjs'
import { cleanupPairingPages, runSetup, showPairingOnScreen } from '../src/setup.mjs'
import { ask, downloadTo, openTarget, run, waitForEnter } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'

const args = process.argv.slice(2)
const argOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const paths = dataPaths()
const ui = createUi({ color: supportsColor(), log: (line) => appendLog(paths.installLog, `${new Date().toISOString()}  ${line}\n`) })

ui.title('Remote Start PC: setup')
ui.say('This takes a few minutes. You only do this once.')
cleanupPairingPages(tmpdir())

try {
  const result = await runSetup({
    source: resolve(argOf('--source') || PROJECT_ROOT),
    paths,
    ui,
    run: (file, a, opts) => run(file, a, { timeout: 120_000, ...opts }),
    spawnFn: spawn,
    exists: existsSync,
    open: openTarget,
    interfaces: networkInterfaces(),
    skipTailscale: args.includes('--skip-tailscale') || process.env.RSP_SKIP_TAILSCALE === '1',
    downloadTo,
    askLine: ask,
    showPairing: (pairing) => showPairingOnScreen(pairing, { ui, tmp: tmpdir(), open: openTarget, waitForKey: waitForEnter }),
  })
  ui.blank()
  if (result.ok) {
    ui.title('All done')
    ui.say('  Your phone now controls this PC.')
    ui.blank()
    ui.say(`  ${ui.paint('magenta bold', 'Where everything is')}`)
    ui.say(`  ${ui.paint('cyan', 'Program folder: ')}${paths.app}`)
    ui.say(`  ${ui.paint('cyan', 'Your files:     ')}${paths.home}   (settings, buttons.json, logs; updates never touch it)`)
    ui.say(`  ${ui.paint('cyan', 'Shortcuts:      ')}Desktop: "RemotePc Settings" and "Remote Start PC"; Start menu: RemortStartPc`)
    ui.blank()
    ui.say('  - To pair another phone later: double-click Pair-Phone (or search for it in the Start menu).')
    ui.say('  - If something does not work: double-click Fix-It.')
    ui.say('  - To also START the PC from your phone when it is off: see docs/START-FROM-OFF.md')
    process.exit(0)
  }
  ui.title('Not finished')
  ui.say('  Something above needs your attention. Fix it, then run Install.cmd again (it is safe to repeat).')
  ui.say('  Double-click Fix-It to see what is wrong.')
  process.exit(1)
} catch (err) {
  ui.fail(`Setup stopped: ${err.message}`)
  ui.say(`  Details are in ${paths.installLog}`)
  process.exit(1)
}
