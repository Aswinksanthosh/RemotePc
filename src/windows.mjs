/**
 * The Windows-specific parts of installing: the hidden launcher, the scheduled task, the firewall
 * rule, Start-menu shortcuts, Tailscale. Every outside command goes through an injected `run`,
 * so the logic can be tested on any computer. PowerShell is passed as an encoded command, so no
 * quoting of a path can change what runs.
 */

import { FIREWALL_RULE, TASK_NAME } from './paths.mjs'

export const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64')
export const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]

// -- the launcher ----------------------------------------------------------------------

/**
 * The hidden launcher the scheduled task runs. It starts the remote and starts it again when it
 * stops: right away after an update (exit code 75), after a few seconds after a crash, never when
 * another copy was already running (exit code 0).
 */
export function launcherScript({ nodePath, entry, home }) {
  return `# Started hidden at every sign-in by the scheduled task "${TASK_NAME}". Do not edit: Install.cmd rewrites it.
$node = ${psQuote(nodePath)}
$entry = ${psQuote(entry)}
Set-Location -LiteralPath ${psQuote(home)}
while ($true) {
  if (-not (Test-Path -LiteralPath $node)) {
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found) { $node = $found.Source } else { Start-Sleep -Seconds 30; continue }
  }
  & $node $entry
  $code = $LASTEXITCODE
  if ($code -eq 0) { break }
  if ($code -ne 75) { Start-Sleep -Seconds 5 }
}
`
}

// -- the scheduled task ----------------------------------------------------------------

/**
 * Registers the task that starts the launcher at every sign-in, also when Windows starts in Xbox
 * full-screen mode. If the task cannot be made (no administrator rights), a Startup-folder shortcut
 * is made instead; that one only starts after the normal desktop has loaded.
 */
export const registerTaskScript = (launcher) => String.raw`$name = ${psQuote(TASK_NAME)}
$launcher = ${psQuote(launcher)}
$psArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$me = $env:USERDOMAIN + '\' + $env:USERNAME
$link = Join-Path ([Environment]::GetFolderPath('Startup')) ($name + '.lnk')
try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  if (Test-Path $link) { Remove-Item $link -Force }
  'task'
} catch {
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($link)
  $s.TargetPath = 'powershell.exe'
  $s.Arguments = $psArgs
  $s.WindowStyle = 7
  $s.Description = 'Remote Start PC'
  $s.Save()
  'startup-folder'
}`

export const removeTaskScript = String.raw`$name = ${psQuote(TASK_NAME)}
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
$link = Join-Path ([Environment]::GetFolderPath('Startup')) ($name + '.lnk')
if (Test-Path $link) { Remove-Item $link -Force }
$dir = Join-Path ([Environment]::GetFolderPath('Programs')) 'RemortStartPc'
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
'removed'`

/** Stops a running copy (the launcher and the node program), so files can be replaced. Prints how many were stopped. */
export const stopRemoteScript = String.raw`$n = 0
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and (($_.Name -eq 'node.exe' -and $_.CommandLine -match 'remortstartpc.*remote\.mjs') -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'remortstartpc.*start\.ps1')) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
$n`

// -- Start menu shortcuts ---------------------------------------------------------------

export const SHORTCUTS = ['Pair-Phone', 'Set-PIN', 'Fix-It', 'Update', 'Uninstall', 'Wake-on-LAN-Setup']

export const shortcutsScript = (appDir) => String.raw`$app = ${psQuote(appDir)}
$dir = Join-Path ([Environment]::GetFolderPath('Programs')) 'RemortStartPc'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ws = New-Object -ComObject WScript.Shell
foreach ($n in @(${SHORTCUTS.map(psQuote).join(', ')})) {
  $s = $ws.CreateShortcut((Join-Path $dir ($n + '.lnk')))
  $s.TargetPath = Join-Path $app ($n + '.cmd')
  $s.WorkingDirectory = $env:USERPROFILE
  $s.Save()
}
'ok'`

// -- the firewall -----------------------------------------------------------------------

/** Arguments for netsh: allow the phone page port, but only from the networks the settings allow. */
export function firewallArgs(config) {
  const remote = [config.allow.includes('lan') ? 'LocalSubnet' : '', config.allow.includes('tailscale') ? '100.64.0.0/10' : '', '127.0.0.1']
    .filter(Boolean)
    .join(',')
  return ['advfirewall', 'firewall', 'add', 'rule', `name=${FIREWALL_RULE}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${config.port}`, `remoteip=${remote}`, 'profile=any']
}
export const firewallDeleteArgs = ['advfirewall', 'firewall', 'delete', 'rule', `name=${FIREWALL_RULE}`]

export async function configureFirewall({ run, config }) {
  await run('netsh.exe', firewallDeleteArgs).catch(() => {})
  await run('netsh.exe', firewallArgs(config))
}

// -- Tailscale --------------------------------------------------------------------------

export function findTailscale(exists, env = process.env) {
  const candidates = [
    `${env.ProgramFiles ?? 'C:\\Program Files'}\\Tailscale\\tailscale.exe`,
    `${env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Tailscale\\tailscale.exe`,
  ]
  return candidates.find((p) => exists(p)) ?? ''
}

/** { state: 'Running' | 'NeedsLogin' | 'Stopped' | 'Starting' | 'unknown', ip } from `tailscale status --json`. */
export async function tailscaleStatus({ run, exe }) {
  try {
    const j = JSON.parse(await run(exe, ['status', '--json'], { timeout: 10_000 }))
    const ips = [...(j.Self?.TailscaleIPs ?? []), ...(j.TailscaleIPs ?? [])]
    return { state: typeof j.BackendState === 'string' ? j.BackendState : 'unknown', ip: ips.find((a) => /^100\./.test(a)) ?? '' }
  } catch {
    return { state: 'unknown', ip: '' }
  }
}

const LOGIN_URL = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/

/**
 * Runs `tailscale up`, opens the sign-in page it prints, and waits until Tailscale is connected.
 * Returns true when connected, false on timeout (5 minutes) or failure.
 */
export async function loginTailscale({ spawnFn, run, exe, open, ui, sleep, timeoutMs = 5 * 60_000, pollMs = 3000 }) {
  let opened = false
  const child = spawnFn(exe, ['up'], { windowsHide: true })
  const watch = (chunk) => {
    const url = LOGIN_URL.exec(String(chunk))?.[0]
    if (url && !opened) {
      opened = true
      ui.info('A sign-in page opens in your browser. Sign in with Google, using the SAME account as on your phone.')
      ui.info(`If it does not open, go to: ${url}`)
      open(url)
    }
  }
  child.stdout?.on?.('data', watch)
  child.stderr?.on?.('data', watch)
  let exited = false
  child.once?.('exit', () => {
    exited = true
  })
  child.once?.('error', () => {
    exited = true
  })
  const until = Date.now() + timeoutMs
  try {
    while (Date.now() < until) {
      if ((await tailscaleStatus({ run, exe })).state === 'Running') return true
      if (exited && opened === false && (await tailscaleStatus({ run, exe })).state !== 'Running') {
        // `tailscale up` ended without a sign-in link and without connecting: give it one more look, then stop waiting.
        await sleep(pollMs)
        return (await tailscaleStatus({ run, exe })).state === 'Running'
      }
      await sleep(pollMs)
    }
    return false
  } finally {
    try {
      child.kill?.()
    } catch {
      // Already gone.
    }
  }
}
