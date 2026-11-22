/**
 * "Clear sound" for Bluetooth earbuds. When a program turns the mic on, Windows switches earbuds to the Hands-Free profile
 * (phone-call quality). Turning the Hands-Free devices off keeps the music profile, so the sound stays clear (the earbuds' own mic is
 * then unavailable). Windows only lets an administrator do that, so a one-time setup (Bluetooth-Sound-Setup.cmd) creates two
 * scheduled tasks with a FIXED command each; the phone can only start those two tasks, never anything else.
 */

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

const b64 = (s) => Buffer.from(s, 'utf16le').toString('base64')

/** Run once as administrator: creates the two tasks for the current user. */
export const hfSetupScript = () => String.raw`$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($t in @(@('${TASK_OFF}', '${b64(hfCommand(true))}'), @('${TASK_ON}', '${b64(hfCommand(false))}'))) {
  $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $t[1])
  $p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $t[0] -Action $a -Principal $p -Force | Out-Null
}
'ok'`

/** Run once as administrator to remove them again (Uninstall uses it). */
export const hfRemoveScript = String.raw`foreach ($n in @('${TASK_ON}', '${TASK_OFF}')) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }`
