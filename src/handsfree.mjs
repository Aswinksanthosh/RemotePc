/**
 * "Clear sound" for Bluetooth earbuds. When a program turns the mic on, Windows switches earbuds to the Hands-Free profile
 * (phone-call quality). Turning the Hands-Free devices off keeps the music profile, so the sound stays clear (the earbuds' own mic is
 * then unavailable). Windows only lets an administrator do that, so a one-time setup (Admin-Setup.cmd) creates two
 * scheduled tasks with a FIXED command each; the phone can only start those two tasks, never anything else.
 */

import { taskSetupScript } from './admin-tasks.mjs'

export const TASK_ON = 'RemotePc-HandsFree-On'
export const TASK_OFF = 'RemotePc-HandsFree-Off'

/** The Hands-Free devices of paired Bluetooth devices (profile ids 111E and 111F). */
const FIND = String.raw`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^BTHENUM\\\{0000111[ef]-' -or $_.FriendlyName -like '*Hands-Free*' }`

/** Prints none, enabled or disabled. */
export const HF_STATE = String.raw`$d = @(${FIND})
if ($d.Count -eq 0) { 'none' } elseif (@($d | Where-Object { $_.Status -eq 'OK' }).Count -gt 0) { 'enabled' } else { 'disabled' }`

/** What each task runs (as administrator). "clear" = Hands-Free off. */
export const hfCommand = (clear) =>
  String.raw`${FIND} | ForEach-Object { ${clear ? 'Disable-PnpDevice' : 'Enable-PnpDevice'} -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }`

/** The two tasks (see admin-tasks.mjs). */
export const HF_TASKS = [
  { name: TASK_OFF, command: hfCommand(true) },
  { name: TASK_ON, command: hfCommand(false) },
]
export const hfSetupScript = () => taskSetupScript(HF_TASKS)
