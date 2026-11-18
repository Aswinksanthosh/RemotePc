#!/usr/bin/env node
// Pairs another phone: shows a new QR code. Pair-Phone.cmd runs this.
//   node bin/pair.mjs [phone name]
import { existsSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { loadConfig, saveConfig } from '../src/config.mjs'
import { dataPaths } from '../src/paths.mjs'
import { cleanupPairingPages, newPairing, showPairingOnScreen } from '../src/setup.mjs'
import { openTarget, waitForEnter } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'

const paths = dataPaths()
const ui = createUi({ color: supportsColor() })
cleanupPairingPages(tmpdir())

if (!existsSync(paths.config)) {
  if (process.platform === 'win32') {
    ui.fail('Remote Start PC is not installed on this PC yet. Double-click Install.cmd first.')
    process.exit(1)
  }
  // A helper (for example a Raspberry Pi) has no installer: the settings start with the safe defaults.
  saveConfig(paths.config, {})
}
const config = loadConfig(paths.config)
try {
  const res = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(2500) })
  if (!res.ok) throw new Error('not running')
} catch {
  ui.warn('The remote is not running right now. The code still works once it is: double-click Fix-It if it does not.')
}

try {
  const pairing = newPairing({ paths, config, interfaces: networkInterfaces(), label: process.argv.slice(2).join(' ').trim() })
  ui.title('Pair a phone')
  await showPairingOnScreen(pairing, { ui, tmp: tmpdir(), open: openTarget, waitForKey: waitForEnter })
  ui.say('  Done. To see or forget paired phones, open the Paired phones section on the phone page.')
} catch (err) {
  ui.fail(err.message)
  process.exit(1)
}
