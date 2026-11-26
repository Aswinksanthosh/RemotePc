#!/usr/bin/env node
// One-time setup for the switches that need administrator rights: "Clear sound" and the NVIDIA GPU switch. Admin-Setup.cmd runs this (as administrator).
import { taskSetupScript } from '../src/admin-tasks.mjs'
import { GPU_TASKS } from '../src/gpu.mjs'
import { HF_TASKS } from '../src/handsfree.mjs'
import { psArgs } from '../src/windows.mjs'
import { run } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'

const ui = createUi({ color: supportsColor() })
ui.title('Remote Start PC: set up the switches that need administrator rights')
if (process.platform !== 'win32') {
  ui.fail('This part works on Windows only.')
  process.exit(1)
}
try {
  const out = await run('powershell.exe', psArgs(taskSetupScript([...HF_TASKS, ...GPU_TASKS])), { timeout: 60_000 })
  if (!/ok\s*$/.test(out)) throw new Error('Windows did not confirm.')
  ui.blank()
  ui.say('  Done. The phone page can now use:')
  ui.say('    - "Clear sound" (Bluetooth card): the earbuds Hands-Free (phone call) mode on or off.')
  ui.say('    - "NVIDIA GPU" (Power mode card): the NVIDIA GPU on or off, only while another working GPU exists.')
  ui.say('  Each one only runs its own fixed command. Nothing else.')
} catch (err) {
  ui.fail(`Could not set it up: ${err.message}`)
  process.exit(1)
}
