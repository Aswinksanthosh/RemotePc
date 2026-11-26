/**
 * The NVIDIA GPU switch. A laptop with an NVIDIA GPU and an integrated GPU (Intel or AMD) can run on the integrated one alone: turning the
 * NVIDIA GPU off in Windows stops its driver, which is also a way around a driver bug (for example the reported heavy SSD log writes of
 * NVIDIA drivers 621.14 and 621.24, November 2026). Safety: it is only ever turned off while another working GPU exists, checked here AND
 * inside the administrator task itself, so a wrong tap can never leave the laptop with no picture. Games run slower (or not at all) while it is off.
 */

import { taskSetupScript } from './admin-tasks.mjs'

export const GPU_TASK_OFF = 'RemotePc-GPU-Off'
export const GPU_TASK_ON = 'RemotePc-GPU-On'

/** Driver versions reported (not confirmed by NVIDIA) to write a log file to the SSD all the time. */
export const REPORTED_BAD_DRIVERS = ['621.14', '621.24']

/** One line per display adapter (GPU, name, status) and the NVIDIA driver version (VER). */
export const GPU_STATE = String.raw`Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | ForEach-Object { 'GPU' + [char]9 + $_.FriendlyName + [char]9 + $_.Status }
$v = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1
if ($v) { 'VER' + [char]9 + $v.DriverVersion }`

const FIND = String.raw`$all = @(Get-PnpDevice -Class Display -ErrorAction SilentlyContinue)
$nv = @($all | Where-Object { $_.FriendlyName -match 'NVIDIA' })
$other = @($all | Where-Object { $_.FriendlyName -notmatch 'NVIDIA|Microsoft|Basic|Remote|Virtual' -and $_.Status -eq 'OK' })`

/** What each administrator task runs. Turning it OFF does nothing unless another working GPU exists. */
export const gpuCommand = (off) =>
  off
    ? `${FIND}\nif ($other.Count -gt 0) { $nv | ForEach-Object { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue } }`
    : `${FIND}\n$nv | ForEach-Object { Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }`

export const GPU_TASKS = [
  { name: GPU_TASK_OFF, command: gpuCommand(true) },
  { name: GPU_TASK_ON, command: gpuCommand(false) },
]
export const gpuSetupScript = () => taskSetupScript(GPU_TASKS)

/** "32.0.16.2124" -> "621.24" (the last digit of the third part and the whole fourth part, with a dot before the last two). */
export function nvidiaVersion(driverVersion) {
  const parts = String(driverVersion ?? '').trim().split('.')
  if (parts.length !== 4) return ''
  const digits = parts[2].slice(-1) + parts[3]
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)}.${digits.slice(3)}` : ''
}

/** { nvidia, on, otherOk, version } from GPU_STATE output. otherOk = another working GPU exists, so turning NVIDIA off is safe. */
export function parseGpu(text) {
  const devices = []
  let version = ''
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [kind, a, b] = line.split('\t')
    if (kind === 'GPU' && a) devices.push({ name: a.trim().slice(0, 80), status: String(b ?? '').trim() })
    if (kind === 'VER') version = nvidiaVersion(a)
  }
  const nv = devices.filter((d) => /nvidia/i.test(d.name))
  const others = devices.filter((d) => !/nvidia|microsoft|basic|remote|virtual/i.test(d.name))
  return { nvidia: nv.length > 0, on: nv.some((d) => d.status === 'OK'), otherOk: others.some((d) => d.status === 'OK'), version }
}
