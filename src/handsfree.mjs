/**
 * "Clear sound" for Bluetooth earbuds. When a program turns the mic on, Windows switches earbuds to the Hands-Free profile
 * (phone-call quality). Turning the Hands-Free devices off keeps the music profile, so the sound stays clear (the earbuds' own mic is
 * then unavailable). Windows only lets an administrator do that, so a one-time setup (Admin-Setup.cmd) creates two
 * scheduled tasks with a FIXED command each; the phone can only start those two tasks, never anything else.
 */

import { taskSetupScript } from './admin-tasks.mjs'

export const TASK_ON = 'RemotePc-HandsFree-On'
export const TASK_OFF = 'RemotePc-HandsFree-Off'

/** The Hands-Free devices of paired Bluetooth devices (profile ids 111E and 111F, or "Hands-Free" in the name), in any device class. */
const FIND = String.raw`Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHHFENUM)\\' -and ($_.InstanceId -match '\{0000111[ef]-' -or $_.FriendlyName -match 'Hands-?free') }`

/** One line per Hands-Free device: HFD, name, status, Windows problem code (22 = turned off). */
export const HF_STATE = String.raw`${FIND} | ForEach-Object { 'HFD' + [char]9 + $_.FriendlyName + [char]9 + $_.Status + [char]9 + $_.ConfigManagerErrorCode }`

/** [{ name, status, code }] from HF_STATE output. */
export function parseHandsFree(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [kind, name, status, code] = line.split('\t')
    if (kind === 'HFD' && name) out.push({ name: name.trim().slice(0, 80), status: String(status ?? '').trim(), code: Number(code) || 0 })
  }
  return out
}

/** Clear sound is "on" when every Hands-Free device is turned off (Windows problem code 22). */
export const handsFreeCleared = (devices) => devices.length > 0 && devices.every((d) => d.code === 22)

/** What each task runs (as administrator). "clear" = Hands-Free off. */
export const hfCommand = (clear) =>
  String.raw`${FIND} | ForEach-Object { ${clear ? 'Disable-PnpDevice' : 'Enable-PnpDevice'} -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }`

/** The two tasks (see admin-tasks.mjs). */
export const HF_TASKS = [
  { name: TASK_OFF, command: hfCommand(true) },
  { name: TASK_ON, command: hfCommand(false) },
]
export const hfSetupScript = () => taskSetupScript(HF_TASKS)
