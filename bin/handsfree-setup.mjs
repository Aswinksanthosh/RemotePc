#!/usr/bin/env node
// One-time setup for the "Clear sound" switch. Bluetooth-Sound-Setup.cmd runs this (as administrator).
import { hfSetupScript } from '../src/handsfree.mjs'
import { psArgs } from '../src/windows.mjs'
import { run } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'

const ui = createUi({ color: supportsColor() })
ui.title('Remote Start PC: set up the "Clear sound" switch')
if (process.platform !== 'win32') {
  ui.fail('This part works on Windows only.')
  process.exit(1)
}
try {
  const out = await run('powershell.exe', psArgs(hfSetupScript()), { timeout: 60_000 })
  if (!/ok\s*$/.test(out)) throw new Error('Windows did not confirm.')
  ui.blank()
  ui.say('  Done. The phone page now has a "Clear sound" switch in the Bluetooth card.')
  ui.say('  It only turns the earbuds\' Hands-Free (phone call) mode on or off. Nothing else.')
} catch (err) {
  ui.fail(`Could not set it up: ${err.message}`)
  process.exit(1)
}
