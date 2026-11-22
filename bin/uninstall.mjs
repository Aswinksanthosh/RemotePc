#!/usr/bin/env node
// Removes the automatic start, the firewall rule and the shortcuts. Uninstall.cmd runs this.
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dataPaths } from '../src/paths.mjs'
import { ask, run } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'
import { limiterDir } from '../src/paths.mjs'
import { removeOldLimiter } from '../src/setup.mjs'
import { TASK_OFF, TASK_ON } from '../src/handsfree.mjs'
import { firewallDeleteArgs, psArgs, removeTaskScript, stopRemoteScript } from '../src/windows.mjs'

const paths = dataPaths()
const ui = createUi({ color: supportsColor() })
ui.title('Remote Start PC: uninstall')
if (process.platform === 'win32') {
  await run('powershell.exe', psArgs(stopRemoteScript)).catch(() => {})
  // An old temperature limiter (removed from the program) is cleaned up too: speed restored, task and folder deleted.
  await removeOldLimiter({ run, ps: (script) => run('powershell.exe', psArgs(script)), dir: limiterDir(), ui })
  await run('powershell.exe', psArgs(removeTaskScript)).then(() => ui.ok('Automatic start and shortcuts removed.'), (e) => ui.warn(`Could not remove the automatic start: ${e.message}`))
  // The two "Clear sound" tasks (only exist after Bluetooth-Sound-Setup).
  for (const task of [TASK_ON, TASK_OFF]) await run('schtasks.exe', ['/delete', '/tn', task, '/f']).catch(() => {})
  await run('netsh.exe', firewallDeleteArgs).then(() => ui.ok('Firewall rule removed.'), () => ui.warn('No firewall rule to remove (or administrator rights are needed).'))
}
// The PIN is always removed (owner decision): a reinstall never brings an old PIN back, even when the rest is kept.
try {
  rmSync(paths.pin, { force: true })
  ui.ok('The PIN was removed.')
} catch {
  ui.warn('Could not remove the PIN file: ' + paths.pin)
}
const answer = (await ask(`\n  Also delete the program and your settings and paired phones in ${paths.home}? Type yes to delete, or press Enter to keep them: `)).toLowerCase()
if (answer === 'yes' || answer === 'y') {
  // This program runs from inside that folder, so a separate helper deletes it a few seconds after we exit.
  const child = spawn('cmd.exe', ['/c', `ping -n 4 127.0.0.1 >nul & rmdir /s /q "${paths.home}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
  child.unref()
  ui.ok('The folder is being deleted (a few seconds).')
} else ui.ok('Kept. You can delete that folder yourself any time.')
ui.say('  Node.js and Tailscale were left installed. Remove them in Windows Settings > Apps if you do not need them.')
