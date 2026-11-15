/**
 * What the phone buttons do on the PC. No free text ever reaches a command: every action is one of
 * a fixed list, and the only thing a button can carry is a NAME that this program looks up itself:
 * a game from Steam's own list, an app from the Start menu list, or a button from buttons.json.
 *
 * Windows only (the buttons say so on other systems). The PowerShell parts are passed as an
 * encoded command, so no quoting of the text can change what runs.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { hostname as osHostname, uptime } from 'node:os'
import { join } from 'node:path'
import { appendLog as defaultAppendLog, writeAtomic as defaultWriteAtomic } from './fsutil.mjs'
import {
  extraGames,
  findGameArt,
  parseSteamAccounts,
  parseSteamLogin,
  parseSteamUsers,
  regValue,
  scanGames,
  setMostRecent,
  steamIdFromAccountNumber,
} from './steam.mjs'

/** Apps offered on the page when they are installed: [label shown, name in the Start menu (* matches anything)]. */
export const APP_CANDIDATES = [
  ['Discord', 'Discord'],
  ['Spotify', 'Spotify'],
  ['Epic Games', 'Epic Games Launcher'],
  ['Xbox', 'Xbox'],
  ['Claude', 'Claude'],
  ['Chrome', 'Google Chrome'],
  ['Brave', 'Brave'],
  ['Edge', 'Microsoft Edge'],
  ['Firefox', 'Firefox'],
  ['OBS Studio', 'OBS Studio'],
  ['VLC', 'VLC media player'],
  ['WhatsApp', 'WhatsApp*'],
  ['Telegram', 'Telegram*'],
  ['Zoom', 'Zoom*'],
  ['Teams', 'Microsoft Teams*'],
  ['Armoury Crate', 'Armoury Crate'],
  ['MyASUS', 'MyASUS'],
  ['ASUS GlideX', '*Glide*X*'],
]

/** Virtual key code and how many times to press it. */
const KEYS = {
  volume_up: [0xaf, 5],
  volume_down: [0xae, 5],
  mute: [0xad, 1],
  media_playpause: [0xb3, 1],
  media_next: [0xb0, 1],
  media_prev: [0xb1, 1],
}
const KEY_MESSAGES = {
  volume_up: 'Volume up.',
  volume_down: 'Volume down.',
  mute: 'Mute toggled.',
  media_playpause: 'Play / pause.',
  media_next: 'Next track.',
  media_prev: 'Previous track.',
}

export const ACTIONS = [
  'steam_open',
  'steam_bigpicture',
  'steam_game',
  'close_game',
  'steam_switch',
  'lock',
  'sleep',
  'restart',
  'shutdown',
  'shutdown_cancel',
  'screen_off',
  'app',
  'button',
  'status',
  'update',
  ...Object.keys(KEYS),
]

const WILDCARD = (pattern) => new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
const CONTROL = /[\u0000-\u001f]/

/** Buttons you defined yourself in buttons.json. Entries that look odd are ignored. */
export function knownButtons(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = {}
  try {
    for (const [name, v] of Object.entries(JSON.parse(readText(file)))) {
      const key = String(name).toLowerCase().trim()
      const command = typeof v === 'string' ? v.trim() : typeof v?.command === 'string' ? v.command.trim() : ''
      const cwd = typeof v?.cwd === 'string' ? v.cwd.trim() : ''
      if (!key || key.length > 40 || !command || command.length > 300 || CONTROL.test(command) || CONTROL.test(cwd) || CONTROL.test(key)) continue
      out[key] = { command, cwd }
    }
  } catch {
    // No file: no custom buttons.
  }
  return out
}

/** Apps you added yourself in apps.json: { "button name": "exact name in the Start menu" }. */
export function knownCustomApps(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = {}
  try {
    for (const [name, v] of Object.entries(JSON.parse(readText(file)))) {
      const label = String(name).trim()
      const target = typeof v === 'string' ? v.trim() : ''
      if (!label || label.length > 30 || !target || target.length > 60 || CONTROL.test(label + target)) continue
      out[label.toLowerCase()] = { label, match: target, exact: true }
    }
  } catch {
    // No file: only the built-in list.
  }
  return out
}

const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''

export function runCommand(file, args, { timeout = 15_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    // The callback also receives a failure to start, so nothing is left unhandled.
    execFile(file, args, { windowsHide: true, timeout, cwd, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error(firstLine(stderr) || firstLine(err.message))) : resolve(String(stdout)),
    )
  })
}

/** Opens a program or a protocol address (steam://, discord://) detached, with no shell parsing of our own. */
export function runLaunch(target) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', () => reject(new Error('That program could not be started.')))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64')
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

const keyScript = (vk, times) =>
  String.raw`Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'
1..${times} | ForEach-Object { [W.K]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); [W.K]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero) }`

const SCREEN_OFF = String.raw`Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int h, int m, int w, int l);'
[W.M]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null`

// Real sleep (not hibernate), whatever the "Fast startup" setting is.
const SLEEP = String.raw`Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)`

// Games are found through WMI (it can still read the path of games guarded by an anti-cheat, which Get-Process cannot).
// Lines starting with "!" are programs that were still running two seconds later.
const CLOSE_GAME = String.raw`$g = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*\steamapps\common\*' })
$g | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object -Unique
$g | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($g.Count) {
  Start-Sleep -Seconds 2
  $g | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | ForEach-Object { '!' + [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object -Unique
}`

const BATTERY = String.raw`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b) { "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" }`

const START_NAMES = String.raw`Get-StartApps | ForEach-Object { $_.Name }`

const startAppScript = (name, exact) => String.raw`$n = ${psQuote(name)}
$a = Get-StartApps | Where-Object { ${exact ? '$_.Name -eq $n' : '$_.Name -like $n'} } | Select-Object -First 1
if ($a) { Start-Process explorer.exe ("shell:AppsFolder\" + $a.AppID); $a.Name }`

const MODEL = String.raw`Get-CimInstance Win32_ComputerSystem | ForEach-Object { "$($_.Manufacturer)|$($_.Model)" }`

/** "ROG Strix G614JV_G614JV" -> "ROG Strix G614JV". Only a name to show, never used for anything else. */
export function cleanModel(text) {
  const model = String(text ?? '').trim().split(/\r?\n/).at(-1)?.split('|').slice(1).join('|') ?? ''
  return model.replace(/_.*$/, '').replace(/[^\w .+-]/g, '').trim().slice(0, 40)
}

const duration = (seconds) => {
  const m = Math.floor(seconds / 60)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

const memo = (ttl, fn, now = Date.now) => {
  let at = -Infinity
  let value
  return async () => {
    if (now() - at < ttl) return value
    value = await fn()
    at = now()
    return value
  }
}

/**
 * Everything is injectable so it can be tested without Windows.
 * `files` says where the owner's own files are: { buttons, apps, games, switchLog }.
 */
export function createActions({
  files,
  version = '',
  update = async () => {
    throw new Error('Updating is not available here.')
  },
  launch = runLaunch,
  run = runCommand,
  spawnFn = spawn,
  readText = (f) => readFileSync(f, 'utf8'),
  readBytes = (f) => readFileSync(f),
  readdir,
  stat = statSync,
  exists = existsSync,
  writeAtomic = defaultWriteAtomic,
  appendLog = defaultAppendLog,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform = process.platform,
  uptimeFn = uptime,
  hostname = osHostname,
  now = Date.now,
}) {
  const winOnly = () => {
    if (platform !== 'win32') throw new Error('This button works on Windows only.')
  }
  const ps = (script, opts) => {
    winOnly()
    return run('powershell.exe', psArgs(script), opts)
  }

  // -- Steam -------------------------------------------------------------------------

  const steamPath = memo(10 * 60_000, async () => {
    if (platform !== 'win32') return ''
    const fromRegistry = regValue(await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']).catch(() => ''), 'SteamPath')
    const guesses = [fromRegistry, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean)
    return guesses.find((p) => exists(join(p, 'steam.exe'))) ?? ''
  }, now)

  const gameList = memo(60_000, async () => {
    const path = await steamPath()
    const scanned = path ? scanGames(path, { readText, readdir }) : []
    const byName = new Map()
    for (const g of [...scanned, ...extraGames(files.games, readText)]) if (!byName.has(g.name.toLowerCase())) byName.set(g.name.toLowerCase(), g)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, now)

  const findGame = async (arg) => {
    const wanted = String(arg ?? '').trim().toLowerCase()
    const list = await gameList()
    return list.find((g) => g.name.toLowerCase() === wanted) ?? null
  }

  const steamInfo = memo(8_000, async () => {
    const path = await steamPath()
    if (!path) return null
    try {
      const key = 'HKCU\\Software\\Valve\\Steam'
      const vdf = readText(join(path, 'config', 'loginusers.vdf'))
      const login = parseSteamLogin(vdf)
      let user = login.name
      let id = login.id
      try {
        const active = Number.parseInt(regValue(await run('reg.exe', ['query', `${key}\\ActiveProcess`, '/v', 'ActiveUser']), 'ActiveUser'), 16)
        const real = steamIdFromAccountNumber(active)
        const found = real ? parseSteamUsers(vdf).find((u) => u.id === real) : null
        if (found) {
          user = found.name
          id = found.id
        }
      } catch {
        // Steam is not signed in, or the value is missing: the flag in the file is the best guess.
      }
      let playing = ''
      try {
        const running = Number.parseInt(regValue(await run('reg.exe', ['query', key, '/v', 'RunningAppID']), 'RunningAppID'), 16)
        if (running > 0) playing = (await gameList()).find((g) => Number(g.appid) === running)?.name ?? `app ${running}`
      } catch {
        // Not running a game, or the value is missing.
      }
      return { user, playing, id, path, accounts: parseSteamAccounts(vdf) }
    } catch {
      return { user: '', playing: '', id: '', path, accounts: [] }
    }
  }, now)

  const note = (text) => {
    try {
      appendLog(files.switchLog, `${new Date().toISOString()}  ${text}\n`)
    } catch {
      // The log is only a help; never let it stop the switch.
    }
  }
  const steamRunning = async () => /steam\.exe/i.test(await run('tasklist.exe', ['/FI', 'IMAGENAME eq steam.exe', '/NH']).catch(() => ''))
  let switching = Promise.resolve()

  // The steps, one by one, in the background. Each one is written to the log so a stop can be found.
  async function runSwitch(steam, target) {
    const exe = join(steam.path, 'steam.exe')
    const vdfFile = join(steam.path, 'config', 'loginusers.vdf')
    note(`switching to ${target.name}; steam folder ${steam.path}`)
    if (await steamRunning()) {
      note('steam is running: asking it to close')
      await run(exe, ['-shutdown'], { timeout: 10_000 }).catch((err) => note(`-shutdown said: ${err.message}`))
      let waited = 0
      while (waited < 40 && (await steamRunning())) {
        await sleep(1000)
        waited++
      }
      if (await steamRunning()) {
        note('steam did not close in 40 s: forcing it')
        await run('taskkill.exe', ['/IM', 'steam.exe', '/F']).catch((err) => note(`taskkill said: ${err.message}`))
        await sleep(1500)
      }
      note(`steam closed after about ${waited} s`)
    } else {
      note('steam was not running')
    }
    const before = readText(vdfFile)
    writeAtomic(`${vdfFile}.rsp-backup`, before)
    writeAtomic(vdfFile, setMostRecent(before, target.id))
    note('loginusers.vdf updated (backup saved next to it)')
    const key = 'HKCU\\Software\\Valve\\Steam'
    await run('reg.exe', ['add', key, '/v', 'AutoLoginUser', '/t', 'REG_SZ', '/d', target.account, '/f'])
    await run('reg.exe', ['add', key, '/v', 'RememberPassword', '/t', 'REG_DWORD', '/d', '1', '/f'])
    note('registry set: AutoLoginUser and RememberPassword')
    await sleep(2000)
    const child = spawnFn(exe, [], { detached: true, stdio: 'ignore' })
    child.once('error', (err) => note(`could not start steam: ${err.message}`))
    child.unref?.()
    note('steam started: done')
  }

  async function switchSteam(id) {
    winOnly()
    const steam = await steamInfo()
    const wanted = String(id ?? '').trim()
    const target = /^\d{17}$/.test(wanted) ? steam?.accounts?.find((a) => a.id === wanted) : null
    note(`switch requested; signed in now: ${steam?.user || 'nobody'}; remembered accounts: ${steam?.accounts?.length ?? 0}`)
    if (!target) {
      note('refused: that is not an account this PC stays signed in to')
      throw new Error('That is not an account this PC stays signed in to.')
    }
    if (target.id === steam.id) return `${target.name} is already signed in.`
    // Answer at once; the steps run in the background and write their progress to the log.
    switching = runSwitch(steam, target).catch((err) => note(`STOPPED: ${err.message}`))
    return `Switching Steam to ${target.name}. Steam closes and starts again: about 30 seconds. If nothing changes, see steam-switch.log in the .remortstartpc folder.`
  }

  // -- apps ---------------------------------------------------------------------------

  const startNames = memo(5 * 60_000, async () => (await ps(START_NAMES, { timeout: 20_000 })).split(/\r?\n/).map((l) => l.trim()).filter(Boolean), now)

  /** The apps this PC can open: built-in ones that are installed, and your own from apps.json. */
  async function appChoices() {
    const choices = new Map()
    if (platform === 'win32') {
      let names = []
      try {
        names = await startNames()
      } catch {
        // The Start menu could not be read: only your own apps are offered.
      }
      for (const [label, match] of APP_CANDIDATES) {
        const re = WILDCARD(match)
        if (names.some((n) => re.test(n))) choices.set(label.toLowerCase(), { label, match, exact: false })
      }
    }
    for (const [key, c] of Object.entries(knownCustomApps(files.apps, readText))) choices.set(key, c)
    return choices
  }

  const buttons = () => knownButtons(files.buttons, readText)

  // -- the actions --------------------------------------------------------------------

  async function perform(action, arg) {
    if (KEYS[action]) {
      const [vk, times] = KEYS[action]
      await ps(keyScript(vk, times))
      return KEY_MESSAGES[action]
    }
    switch (action) {
      case 'steam_open':
        winOnly()
        await launch('steam://open/main')
        return 'Opening Steam.'
      case 'steam_bigpicture':
        winOnly()
        await launch('steam://open/bigpicture')
        return 'Opening Big Picture.'
      case 'steam_game': {
        winOnly()
        const game = await findGame(arg)
        if (!game) throw new Error('That game is not in the list of this PC.')
        await launch(`steam://rungameid/${game.appid}`)
        return `Starting ${game.name}. It can take a minute to reach the menu.`
      }
      case 'close_game': {
        const lines = (await ps(CLOSE_GAME, { timeout: 20_000 })).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        const stuck = lines.filter((l) => l.startsWith('!')).map((l) => l.slice(1))
        const closed = lines.filter((l) => !l.startsWith('!') && !stuck.includes(l))
        if (!lines.length) return 'No Steam game is running.'
        const parts = []
        if (closed.length) parts.push(`Closed: ${closed.join(', ')}.`)
        if (stuck.length) parts.push(`Could not close: ${stuck.join(', ')} (protected or still saving). Close it in the game.`)
        return parts.join(' ')
      }
      case 'steam_switch':
        return switchSteam(arg)
      case 'lock':
        winOnly()
        await run('rundll32.exe', ['user32.dll,LockWorkStation'])
        return 'Locked.'
      case 'sleep':
        await ps(SLEEP)
        return 'Going to sleep. A sleeping PC cannot be reached: wake it with its power button, or see docs/START-FROM-OFF.md.'
      case 'restart':
        winOnly()
        await run('shutdown.exe', ['/r', '/t', '10', '/c', 'Restart from the phone'])
        return 'Restarting in 10 seconds. It comes back by itself and this page reconnects. To stop it, press Cancel turn off.'
      case 'shutdown':
        winOnly()
        await run('shutdown.exe', ['/s', '/t', '15', '/c', 'Turned off from the phone'])
        return 'Turning off in 15 seconds. To stop it, press Cancel turn off now.'
      case 'shutdown_cancel':
        winOnly()
        await run('shutdown.exe', ['/a']).catch(() => {
          throw new Error('There is no turn off or restart waiting to be cancelled.')
        })
        return 'Cancelled. The PC stays on.'
      case 'screen_off':
        await ps(SCREEN_OFF)
        return 'Screen off. Moving the mouse turns it back on.'
      case 'status':
        return statusText()
      case 'update':
        return update()
      case 'app': {
        winOnly()
        const choice = (await appChoices()).get(String(arg ?? '').toLowerCase().trim())
        if (!choice) throw new Error('Unknown app.')
        const opened = (await ps(startAppScript(choice.match, choice.exact))).trim().split(/\r?\n/)[0]
        if (!opened) throw new Error(`${choice.label} was not found in the Start menu of this PC.`)
        return `Opening ${opened}.`
      }
      case 'button':
        return runButton(arg)
      default:
        throw new Error('Unknown action.')
    }
  }

  async function statusText() {
    const parts = []
    try {
      const out = await run('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'])
      const [t, u, used, total] = out.trim().split(/\r?\n/)[0].split(/\s*,\s*/).map(Number)
      if ([t, u, used, total].every(Number.isFinite)) parts.push(`GPU ${t} °C, ${u}% busy, ${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB`)
    } catch {
      // No NVIDIA tool: skip the GPU part.
    }
    try {
      const out = (await ps(BATTERY)).trim()
      const [pct, st] = out.split('|').map(Number)
      if (Number.isFinite(pct)) parts.push(`Battery ${pct}% (${[1, 4, 5].includes(st) ? 'on battery' : 'plugged in'})`)
    } catch {
      // No battery information.
    }
    parts.push(`Up ${duration(uptimeFn())}`)
    return parts.join(' · ')
  }

  function runButton(name) {
    const key = String(name ?? '').toLowerCase().trim()
    const all = buttons()
    const button = Object.hasOwn(all, key) ? all[key] : null
    if (!button) throw new Error('That button is not in buttons.json on this PC.')
    winOnly()
    if (button.cwd && !exists(button.cwd)) throw new Error('The folder for that button does not exist.')
    return new Promise((resolve, reject) => {
      const child = spawnFn('cmd.exe', ['/d', '/s', '/c', `"${button.command}"`], {
        cwd: button.cwd || undefined,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      child.once('error', () => reject(new Error('That command could not be started.')))
      child.once('spawn', () => {
        child.unref()
        resolve(`Started: ${key}.`)
      })
    })
  }

  // -- pictures -----------------------------------------------------------------------

  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const typeOf = (file) => TYPES[String(file).split('.').pop().toLowerCase()]

  async function gameArtFile(name) {
    const game = await findGame(name)
    const path = await steamPath()
    return game && path ? findGameArt(path, game.appid, { readdir, stat }) : null
  }

  // Which games have a picture changes rarely, so it is looked up at most every five minutes.
  const artList = memo(5 * 60_000, async () => {
    const names = []
    for (const g of await gameList()) if (await gameArtFile(g.name)) names.push(g.name)
    return names
  }, now)

  const model = memo(24 * 60 * 60_000, async () => (platform === 'win32' ? ps(MODEL).then(cleanModel, () => '') : ''), now)

  return {
    run: perform,
    /** Resolves when the background Steam switch has finished (used by tests). */
    settled: () => switching,
    async info() {
      let timer
      const modelName = await Promise.race([model(), new Promise((r) => (timer = setTimeout(() => r(''), 1500)))])
      clearTimeout(timer)
      const steam = await steamInfo()
      const games = await gameList()
      return {
        name: hostname(),
        model: modelName,
        version,
        games: games.map((g) => g.name),
        gameArt: await artList(),
        buttons: Object.keys(buttons()),
        apps: [...(await appChoices()).values()].map((c) => c.label),
        steam: steam ? { user: steam.user, playing: steam.playing, id: steam.id, avatar: Boolean(steam.id && steam.path), accounts: steam.accounts.map(({ id, name }) => ({ id, name })) } : null,
      }
    },
    async avatar() {
      const steam = await steamInfo()
      if (!steam?.id || !steam.path) return null
      for (const ext of ['png', 'jpg']) {
        const file = join(steam.path, 'config', 'avatarcache', `${steam.id}.${ext}`)
        try {
          if (exists(file) && stat(file).size <= 1024 * 1024) return { type: TYPES[ext], bytes: readBytes(file) }
        } catch {
          // Unreadable: try the next one.
        }
      }
      return null
    },
    async gameArt(name) {
      const file = await gameArtFile(name)
      return file && typeOf(file) ? { type: typeOf(file), bytes: readBytes(file) } : null
    },
  }
}

/** The PowerShell snippets, so a Windows machine can check that every one of them parses (test/powershell.test.mjs). */
export const POWERSHELL_SNIPPETS = {
  keys: keyScript(175, 5),
  screenOff: SCREEN_OFF,
  sleep: SLEEP,
  closeGame: CLOSE_GAME,
  battery: BATTERY,
  startNames: START_NAMES,
  startApp: startAppScript("Some 'App'", false),
  model: MODEL,
}
