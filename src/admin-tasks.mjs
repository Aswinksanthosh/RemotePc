/**
 * Some PC switches (Clear sound, the NVIDIA GPU switch) need administrator rights in Windows. A one-time setup (Admin-Setup.cmd) creates
 * a scheduled task for each, running as the current user with the highest rights, and each task runs ONE FIXED command. The phone can
 * only start those tasks by name (schtasks /run); it can never send a command of its own.
 */

const b64 = (script) => Buffer.from(String(script), 'utf16le').toString('base64')

/** Run once as administrator: creates (or replaces) a task for each { name, command }. Prints ok. */
export const taskSetupScript = (tasks) => String.raw`$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($t in @(${tasks.map((t) => `@('${t.name}', '${b64(t.command)}')`).join(', ')})) {
  $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $t[1])
  $p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $t[0] -Action $a -Principal $p -Force | Out-Null
}
'ok'`

/** Deletes the tasks again. */
export const taskRemoveScript = (names) => String.raw`foreach ($n in @(${names.map((n) => `'${n}'`).join(', ')})) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }`
