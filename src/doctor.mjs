/**
 * Fix-It: checks every piece the remote depends on and says, in plain words, what is wrong and
 * what to do. Each check returns { name, level: 'ok' | 'warn' | 'bad', detail, fix }.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.mjs'
import { listAddresses } from './net.mjs'
import { createAuth } from './auth.mjs'
import { createPin } from './pin.mjs'
import { scanGames } from './steam.mjs'
import { regValue } from './steam.mjs'
import { FIREWALL_RULE, TASK_NAME, limiterDir } from './paths.mjs'
import { findTailscale, tailscaleStatus } from './windows.mjs'

export async function runDoctor({
  paths,
  run,
  fetchFn = globalThis.fetch,
  exists = existsSync,
  platform = process.platform,
  interfaces,
  nodeVersion = process.versions.node,
  readText = (f) => readFileSync(f, 'utf8'),
  env = process.env,
}) {
  const out = []
  const add = (name, level, detail, fix = '') => out.push({ name, level, detail, fix })
  const windows = platform === 'win32'

  add('Windows', windows ? 'ok' : 'warn', windows ? 'Windows' : `This is ${platform}: only the "start other PCs" part works here.`)

  const major = Number(nodeVersion.split('.')[0])
  add('Node.js', major >= 20 ? 'ok' : 'bad', `version ${nodeVersion}`, major >= 20 ? '' : 'Install Node.js 20 or newer (run Install.cmd again, it does it for you).')

  const installed = exists(join(paths.app, 'bin', 'remote.mjs'))
  add('Program files', installed ? 'ok' : 'bad', installed ? paths.app : 'The program is not installed.', installed ? '' : 'Double-click Install.cmd.')
  const config = loadConfig(paths.config)
  add('Settings', exists(paths.config) ? 'ok' : 'warn', `port ${config.port}, allowed: ${config.allow.join(', ')}`, exists(paths.config) ? '' : 'Run Install.cmd to create the settings.')

  let up = false
  try {
    const res = await fetchFn(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(3000) })
    up = res.ok && (await res.json()).app === 'remortstartpc'
  } catch {
    up = false
  }
  add('Remote running', up ? 'ok' : 'bad', up ? `answering on port ${config.port}` : 'nothing answers on this PC', up ? '' : 'Run Install.cmd again: it starts the remote. If that does not help, the last lines of the log are shown below.')

  if (windows) {
    const hasTask = await run('schtasks.exe', ['/query', '/tn', TASK_NAME]).then(() => true, () => false)
    add('Starts at sign-in', hasTask ? 'ok' : 'warn', hasTask ? `scheduled task "${TASK_NAME}"` : 'no scheduled task', hasTask ? '' : 'Run Install.cmd as administrator to create it. Until then it only runs if you start it by hand.')

    const rule = await run('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`]).then((o) => /Rule Name/i.test(o), () => false)
    add('Windows Firewall', rule ? 'ok' : 'bad', rule ? 'the phone page is allowed' : 'no rule for the phone page', rule ? '' : 'Run Install.cmd and answer Yes to the administrator question.')

    const ps = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output ok'], { timeout: 20_000 }).then((o) => o.trim() === 'ok', () => false)
    add('PowerShell', ps ? 'ok' : 'bad', ps ? 'works' : 'could not run', ps ? '' : 'The buttons need PowerShell. Check that Windows PowerShell is not disabled.')
  }

  const exe = windows ? findTailscale(exists, env) : ''
  if (!windows) add('Tailscale', 'warn', 'not checked on this system')
  else if (!exe) add('Tailscale', config.allow.includes('lan') ? 'warn' : 'bad', 'not installed', 'Run Install.cmd: it installs Tailscale. Or install it from tailscale.com/download.')
  else {
    const st = await tailscaleStatus({ run, exe })
    add('Tailscale', st.state === 'Running' ? 'ok' : 'bad', st.state === 'Running' ? `connected (${st.ip || 'address unknown'})` : `state: ${st.state}`, st.state === 'Running' ? '' : 'Open Tailscale from the tray and sign in / turn it on.')
  }

  const addrs = listAddresses(interfaces)
  const usable = (config.allow.includes('tailscale') && addrs.tailscale.length > 0) || (config.allow.includes('lan') && addrs.lan.length > 0)
  add('Network address', usable ? 'ok' : 'bad', usable ? [...addrs.tailscale, ...addrs.lan].join(', ') : 'no address the phone could use', usable ? '' : 'Connect to Wi-Fi, and turn Tailscale on.')

  const phones = createAuth({ file: paths.phones }).list()
  add('Paired phones', phones.length ? 'ok' : 'warn', phones.length ? phones.map((p) => p.label).join(', ') : 'none yet', phones.length ? '' : 'Double-click Pair-Phone and scan the code with your phone.')

  const hasPin = createPin({ file: paths.pin }).isSet()
  add('PIN', hasPin ? 'ok' : 'warn', hasPin ? 'set' : 'no PIN is set (a paired phone opens the remote without asking)', hasPin ? '' : 'Double-click Set-PIN to add one.')

  if (windows && config.limiterOn) {
    let ok = false
    try {
      const st = JSON.parse(readText(join(limiterDir(env), 'limiter-status.json')))
      ok = Date.now() - Date.parse(st.at) < 30_000
    } catch {
      ok = false
    }
    add('Temperature limiter', ok ? 'ok' : 'bad', ok ? 'running' : 'is switched on but not running', ok ? '' : 'Run Install.cmd again (it needs administrator rights to set the limiter up).')
  }

  if (windows) {
    try {
      const steam = regValue(await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']), 'SteamPath')
      const games = steam ? scanGames(steam, { readText, readdir: readdirSync }) : []
      add('Steam', steam ? 'ok' : 'warn', steam ? `${games.length} installed game${games.length === 1 ? '' : 's'} found` : 'Steam not found (the Steam buttons stay empty)')
    } catch {
      add('Steam', 'warn', 'Steam not found (the Steam buttons stay empty)')
    }
  }

  let log = ''
  try {
    log = readText(paths.log).trim().split(/\r?\n/).slice(-10).join('\n')
  } catch {
    // No log yet.
  }
  return { results: out, log, problems: out.filter((r) => r.level === 'bad').length, up }
}
