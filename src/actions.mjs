/**
 * What the phone buttons do on the PC. No free text ever reaches a command: every action is one of
 * a fixed list, and the only thing a button can carry is a NAME that this program looks up itself:
 * a game from Steam's own list, an app from the Start menu list, or a button from buttons.json.
 *
 * Windows only (the buttons say so on other systems). The PowerShell parts are passed as an
 * encoded command, so no quoting of the text can change what runs.
 */

import { AUDIO_LIST, BATTERY, BT_LIST, BT_NAMES, CLIP_GET, CLOSE_GAME, DRIVES, MODEL, MODES, SCREEN_OFF, SLEEP, START_NAMES, TOGGLE_DESKTOP, audioScript, btScript, cleanModel, clipSetScript, duration, keyScript, psArgs, startAppScript, volumeScript, windowsScript } from './ps-scripts.mjs'
import { memo, swr } from './cache.mjs'
import { createClipboard, createMedia, createWindows } from './pc-features.mjs'
import { WILDCARD, knownButtons, knownCustomApps, knownFavorites } from './known.mjs'
export { BT_LIST, BT_NAMES, CLIP_GET, CLIP_MAX, cleanModel, clipSetScript } from './ps-scripts.mjs'
export { knownButtons, knownCustomApps, knownFavorites } from './known.mjs'
import { MEDIA_COVER, MEDIA_INFO } from './media.mjs'
import { HF_STATE, hfCommand, hfSetupScript, TASK_OFF, TASK_ON } from './handsfree.mjs'
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
  parseRegApps,
  driveLibraryCandidates,
  scanGames,
  setMostRecent,
  steamIdFromAccountNumber,
} from './steam.mjs'

/** Apps offered on the page when they are installed: [label shown, name in the Start menu (* matches anything)]. */
export const APP_CANDIDATES = [
  ['Spotify', 'Spotify'],
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
  'restart_remote',
  'game_add',
  'game_remove',
  'favorite_set',
  'timer_set',
  'mode_saver',
  'mode_balanced',
  'mode_gaming',
  'window_focus',
  'window_close',
  'desktop_toggle',
  'volume_set',
  'mute_set',
  'bt_connect',
  'bt_disconnect',
  'handsfree_set',
  'audio_set',
  ...Object.keys(KEYS),
]

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

/**
 * Everything is injectable so it can be tested without Windows.
 * `files` says where the owner's own files are: { buttons, apps, games, switchLog }.
 */
export function createActions({
  files,
  version = '',
  restart = () => {
    throw new Error('Restarting is not available here.')
  },
  update = async () => {
    throw new Error('Updating is not available here.')
  },
  updateInfo = () => ({ available: false, boot: '' }),
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

  // Which Windows questions failed lately (shown in Diagnostics): name -> { message, at }. A success clears the entry.
  const failures = new Map()
  const failed = (name, err) => {
    const message = String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 160)
    if (!failures.has(name)) console.log(`[remote] could not read ${name}: ${message}`)
    failures.set(name, { message, at: now() })
  }
  const track = (name, fn) => async () => {
    try {
      const v = await fn()
      failures.delete(name)
      return v
    } catch (err) {
      failed(name, err)
      throw err
    }
  }
  const clipboard = createClipboard({ ps, winOnly })
  const windowsFeature = createWindows({ ps, winOnly, now })
  const media = createMedia({ ps, track, now, platform })
  const steamPath = memo(10 * 60_000, async () => {
    if (platform !== 'win32') return ''
    const fromRegistry = regValue(await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']).catch(() => ''), 'SteamPath')
    const guesses = [fromRegistry, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean)
    return guesses.find((p) => exists(join(p, 'steam.exe'))) ?? ''
  }, now)

  // Where Steam games are found, from three independent places so one gap does not hide a game:
  //  1. the game files (appmanifest) in every library folder Steam lists, plus library folders found on the drives that it does not list;
  //  2. Steam's own list of installed apps in the registry (names included, whichever drive the game is on);
  //  3. the games the owner added by hand (games.json).
  const driveLetters = swr(10 * 60_000, track('drives', async () => (platform === 'win32' ? (await ps(DRIVES, { timeout: 15_000 })).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Za-z]:$/.test(l)) : [])), now)
  async function discoverGames() {
    const path = await steamPath()
    const otherDrives = platform === 'win32' ? driveLibraryCandidates((await driveLetters()) ?? [], exists) : []
    const scanned = path ? scanGames(path, { readText, readdir, extraLibraries: otherDrives }) : []
    const fromSteam = platform === 'win32' ? parseRegApps(await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam\\Apps', '/s']).catch(() => '')) : []
    const byId = new Map()
    for (const g of [...scanned, ...fromSteam]) if (!byId.has(g.appid)) byId.set(g.appid, g)
    const byName = new Map()
    for (const g of [...byId.values(), ...extraGames(files.games, readText)]) if (!byName.has(g.name.toLowerCase())) byName.set(g.name.toLowerCase(), g)
    const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return { list, files: scanned.length, steam: fromSteam.length, otherDrives, added: extraGames(files.games, readText).length }
  }
  const gameList = swr(60_000, track('games', async () => (await discoverGames()).list), now)

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

  const startNames = swr(5 * 60_000, track('Start menu apps', async () => (await ps(START_NAMES, { timeout: 20_000 })).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)), now)

  /** The apps this PC can open: built-in ones that are installed, and your own from apps.json. */
  async function appChoices() {
    const choices = new Map()
    if (platform === 'win32') {
      let names = []
      try {
        names = (await startNames()) ?? []
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


  // Paired Bluetooth devices and active playback devices, looked up from Windows and cached briefly.
  const listLines = (script, max) =>
    ps(script, { timeout: 15_000 }).then(
      // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
      (o) => o.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.length <= max && !/[\u0000-\u0008\u000a-\u001f]/.test(l)).slice(0, 20),
      () => [],
    )
  // The page shows which power mode was chosen last (Windows does not tell us the slider position simply).
  // Windows idle timers: turn the screen off after N minutes, go to sleep after N minutes (0 = never). Read and set with powercfg (a small
  // Windows program, no PowerShell). Set for both "plugged in" and "on battery", so the choice is simple.
  const TIMERS = {
    screen: { ac: 'monitor-timeout-ac', dc: 'monitor-timeout-dc', sub: 'SUB_VIDEO', setting: 'VIDEOIDLE', choices: [1, 2, 3, 5, 10, 15, 20, 30, 60, 0], text: (m) => (m ? `Screen turns off after ${m} minute${m === 1 ? '' : 's'}.` : 'Screen never turns off by itself.') },
    sleep: { ac: 'standby-timeout-ac', dc: 'standby-timeout-dc', sub: 'SUB_SLEEP', setting: 'STANDBYIDLE', choices: [5, 10, 15, 20, 30, 45, 60, 120, 0], text: (m) => (m ? `PC goes to sleep after ${m} minute${m === 1 ? '' : 's'}.` : 'PC never goes to sleep by itself.') },
  }
  async function readTimer(kind) {
    const t = TIMERS[kind]
    try {
      const out = await run('powercfg.exe', ['/query', 'SCHEME_CURRENT', t.sub, t.setting])
      // The last two numbers are the current setting "plugged in" and "on battery", in seconds (works in every language of Windows).
      const hex = [...out.matchAll(/0x[0-9a-f]{8}/gi)].map((m) => Number.parseInt(m[0], 16))
      return hex.length >= 2 ? Math.round(hex.at(-2) / 60) : null
    } catch {
      return null
    }
  }
  const timers = swr(30_000, track('sleep and screen timers', async () => (platform === 'win32' ? { screen: await readTimer('screen'), sleep: await readTimer('sleep') } : null)), now)
  async function setTimer(arg) {
    winOnly()
    const m = /^(screen|sleep):(\d{1,3})$/.exec(String(arg ?? ''))
    const t = m && TIMERS[m[1]]
    const minutes = m ? Number(m[2]) : -1
    if (!t || !t.choices.includes(minutes)) throw new Error('Pick one of the times in the list.')
    await run('powercfg.exe', ['/change', t.ac, String(minutes)])
    await run('powercfg.exe', ['/change', t.dc, String(minutes)])
    timers.set({ ...((await timers()) ?? {}), [m[1]]: minutes })
    return t.text(minutes)
  }

  // Games Steam's files do not show (a library on a drive Steam does not list, or a non-Steam shortcut): added by their Steam number into
  // games.json. The same file you could write by hand; the phone can only add or remove entries of this one fixed shape.
  const gamesFile = () => {
    if (!files.games) throw new Error('Games cannot be saved here.')
    return Object.fromEntries(extraGames(files.games, readText).map((g) => [g.name, g.appid]))
  }
  async function addGame(arg) {
    winOnly()
    const m = /^(\d{1,10})\|([\s\S]{1,80})$/.exec(String(arg ?? ''))
    // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
    const name = m ? m[2].replace(/[\u0000-\u001f]/g, '').trim() : ''
    if (!m || !name) throw new Error('Type the Steam number (digits only) and the name of the game.')
    const cur = gamesFile()
    for (const k of Object.keys(cur)) if (k.toLowerCase() === name.toLowerCase()) delete cur[k]
    if (Object.keys(cur).length >= 100) throw new Error('That is plenty of games: remove one first.')
    cur[name] = m[1]
    writeAtomic(files.games, `${JSON.stringify(cur, null, 2)}\n`)
    await gameList.fresh()
    return `${name} added. It is in the game list now.`
  }
  async function removeGame(arg) {
    winOnly()
    const name = String(arg ?? '').trim().toLowerCase()
    const cur = gamesFile()
    const key = Object.keys(cur).find((k) => k.toLowerCase() === name)
    if (!key) throw new Error('That game is not one you added.')
    delete cur[key]
    writeAtomic(files.games, `${JSON.stringify(cur, null, 2)}\n`)
    await gameList.fresh()
    return `${key} removed from the list.`
  }

  // Favourites (stars): a device or output can be starred only if it is in the list this PC shows right now. Saved in favorites.json.
  async function setFavorite(arg) {
    const m = /^(bt|out)\|([01])\|(.{1,80})$/s.exec(String(arg ?? ''))
    if (!m) throw new Error('Unknown favourite.')
    const [, kind, flag, rawName] = m
    const name = rawName.trim()
    const known = kind === 'bt' ? await listHeadphones() : await listOutputs()
    const real = known.find((n) => n.toLowerCase() === name.toLowerCase())
    const fav = knownFavorites(files.favorites, readText)
    if (flag === '1' && !real) throw new Error('That device is not in the list of this PC right now.')
    const without = fav[kind].filter((n) => n.toLowerCase() !== name.toLowerCase())
    if (flag === '1' && without.length >= 8) throw new Error('That is plenty of favourites: remove one first.')
    fav[kind] = flag === '1' ? [...without, real] : without
    if (!files.favorites) throw new Error('Favourites cannot be saved here.')
    writeAtomic(files.favorites, `${JSON.stringify(fav, null, 2)}\n`)
    return flag === '1' ? `${real} is a favourite now.` : `${name} is not a favourite any more.`
  }

  // The laptop's own battery, asked at most every 30 s (nothing on a PC that has none).
  const laptopBattery = swr(30_000, track('battery', async () => {
    if (platform !== 'win32') return null
    const m = /^(\d{1,3})\|(\d{1,2})$/.exec((await ps(BATTERY)).trim())
    return m && Number(m[1]) <= 100 ? { percent: Number(m[1]), onBattery: [1, 4, 5].includes(Number(m[2])) } : null
  }), now)

  const readMode = () => {
    try {
      const m = readText(files.mode).trim()
      return Object.hasOwn(MODES, m) ? m : ''
    } catch {
      return ''
    }
  }
  async function setMode(mode) {
    winOnly()
    const m = MODES[mode]
    try {
      await run('powercfg.exe', ['/overlaysetactive', m.overlay])
    } catch {
      try {
        await run('powercfg.exe', ['/setactive', m.plan])
      } catch {
        // "High performance" is hidden on some PCs; make a copy of it and use that.
        const copy = mode === 'gaming' ? /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(await run('powercfg.exe', ['/duplicatescheme', m.plan]).catch(() => ''))?.[1] : null
        if (!copy) throw new Error('Windows would not change the power mode on this PC.')
        await run('powercfg.exe', ['/setactive', copy])
      }
    }
    try {
      writeAtomic(files.mode, mode)
    } catch {
      // Only the highlight on the page is lost.
    }
    return `${m.name} power mode.`
  }

  // The sound level of the default speaker, read for the page's slider (cached a few seconds) and set from it.
  // Windows open on this PC. A window can only be switched to or closed if it was in the list this PC showed in the last 5 minutes.
  const parseVol = (out) => {
    const m = /vol:(\d+) mute:([01])/.exec(out)
    return m ? { level: Math.min(100, Number(m[1])), muted: m[2] === '1' } : null
  }
  // Reading the level compiles a small program, so it is slow: asked at most every 10 s, and the old answer is shown meanwhile.
  const volume = swr(10_000, () => (platform === 'win32' ? ps(volumeScript('get'), { timeout: 10_000 }).then((o) => (failures.delete('volume'), parseVol(o)), (e) => (failed('volume', e), null)) : null), now)
  const readVolume = () => volume()
  // Dragging the slider sends many levels in a row, and every change starts a slow Windows program. So at most ONE runs at a time, and
  // while it runs only the newest wanted level is remembered: the last position always wins and the PC is not flooded.
  let volumeRun = null
  let volumeWanted = null
  function setVolumeLevel(level) {
    volumeWanted = level
    volumeRun ??= (async () => {
      let v = null
      while (volumeWanted !== null) {
        const next = volumeWanted
        volumeWanted = null
        v = await changeVolume('set', next)
      }
      return v
    })().finally(() => {
      volumeRun = null
    })
    return volumeRun
  }
  async function changeVolume(op, level) {
    const v = await ps(volumeScript(op, level), { timeout: 10_000 }).then(parseVol, () => null)
    if (!v) throw new Error('Windows would not change the volume.')
    volume.set(v)
    return v
  }

  // Paired devices with their connection state. Cached for a few seconds only: a connection changes quickly and the page shows it.
  async function loadBluetooth() {
    let lines = await listLines(BT_LIST, 60)
    if (!lines.length) lines = (await listLines(BT_NAMES, 60)).map((n) => `${n}\tFalse`)
    const byName = new Map()
    for (const l of lines) {
      const [rawName, state, rawBattery] = l.split('\t')
      const name = (rawName ?? '').trim()
      if (!name || name.length > 40) continue
      const before = byName.get(name) ?? { connected: false, battery: null }
      const pct = Number.parseInt(String(rawBattery ?? '').trim(), 10)
      byName.set(name, { connected: before.connected || /^true$/i.test((state ?? '').trim()), battery: before.battery ?? (Number.isInteger(pct) && pct > 0 && pct <= 100 ? pct : null) })
    }
    return [...byName].map(([name, v]) => ({ name, connected: v.connected, battery: v.battery }))
  }
  // The check asks Windows about every paired device (slow): at most every 30 s, the old list is shown meanwhile. A connect or disconnect asks for a fresh one.
  const bluetooth = swr(30_000, track('Bluetooth', () => (platform === 'win32' ? loadBluetooth() : [])), now)
  const listBluetooth = async (fresh = false) => (await (fresh ? bluetooth.fresh() : bluetooth())) ?? []
  const listHeadphones = async () => (await listBluetooth()).map((d) => d.name)
  // "Clear sound": the Hands-Free devices of the earbuds. { found, cleared, ready } (ready = the one-time admin setup was done).
  const handsFree = swr(15_000, track('Clear sound state', async () => {
    if (platform !== 'win32') return null
    const out = (await ps(HF_STATE, { timeout: 15_000 })).trim().split(/\r?\n/).at(-1)
    const ready = await run('schtasks.exe', ['/query', '/tn', TASK_OFF]).then(() => true, () => false)
    return { found: out === 'enabled' || out === 'disabled', cleared: out === 'disabled', ready }
  }), now)
  const outputs = swr(30_000, track('sound outputs', () => (platform === 'win32' ? listLines(AUDIO_LIST, 80) : [])), now)
  const listOutputs = async () => (await outputs()) ?? []

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
      case 'restart_remote':
        return restart()
      case 'game_add':
        return addGame(arg)
      case 'game_remove':
        return removeGame(arg)
      case 'favorite_set':
        return setFavorite(arg)
      case 'timer_set':
        return setTimer(arg)
      case 'mode_saver':
      case 'mode_balanced':
      case 'mode_gaming':
        return setMode(action.slice(5))
      case 'window_focus':
      case 'window_close':
        return windowsFeature.act(action.slice(7), arg)
      case 'desktop_toggle':
        winOnly()
        await ps(TOGGLE_DESKTOP)
        return 'Show desktop.'
      case 'volume_set': {
        // The phone sends the level as text ("55"); anything but 1 to 3 digits from 0 to 100 is refused.
        const text = String(arg ?? '')
        const n = Number(text)
        if (!/^\d{1,3}$/.test(text) || n > 100) throw new Error('The volume is a whole number from 0 to 100.')
        const v = await setVolumeLevel(n)
        return `Volume ${v.level}%.`
      }
      case 'mute_set': {
        if (arg !== 'on' && arg !== 'off') throw new Error('Mute is on or off.')
        const v = await changeVolume(arg === 'on' ? 'mute' : 'unmute', 0)
        return v.muted ? 'Muted.' : `Sound on, volume ${v.level}%.`
      }
      case 'bt_connect':
      case 'bt_disconnect': {
        const connect = action === 'bt_connect'
        const name = (await listHeadphones()).find((n) => n.toLowerCase() === String(arg ?? '').toLowerCase().trim())
        if (!name) throw new Error('That device is not paired with this PC.')
        const out = (await ps(btScript(name, connect), { timeout: 30_000 })).trim().split(/\r?\n/).at(-1)
        if (out !== 'ok') throw new Error(out === 'notfound' ? 'Windows no longer lists that device.' : 'Windows refused (are the earphones in range and awake?).')
        // Windows needs a few seconds: look until the device really shows the new state (up to about 8 seconds), then say what is true.
        let now2 = false
        for (let i = 0; i < 8; i++) {
          await sleep(1000)
          const d = (await listBluetooth(true)).find((x) => x.name === name)
          if (d && d.connected === connect) {
            now2 = true
            break
          }
        }
        if (connect) return now2 ? `${name} is connected.` : `Asked Windows to connect ${name}, but it is not connected yet. Open its case or take it out; it must not be busy with another device.`
        return now2 ? `${name} is disconnected. It is free for your phone or another device now.` : `Asked Windows to disconnect ${name}; it still shows as connected.`
      }
      case 'handsfree_set': {
        if (arg !== 'on' && arg !== 'off') throw new Error('Clear sound is on or off.')
        const want = arg === 'on'
        const before = await handsFree.fresh()
        if (!before?.ready) throw new Error('Run Bluetooth-Sound-Setup once on this PC (it asks for administrator rights), then try again.')
        await run('schtasks.exe', ['/run', '/tn', want ? TASK_OFF : TASK_ON])
        let now2 = false
        for (let i = 0; i < 8; i++) {
          await sleep(1000)
          if ((await handsFree.fresh())?.cleared === want) {
            now2 = true
            break
          }
        }
        if (now2) return want ? 'Clear sound is on. Earbuds keep music quality; their own mic is not used.' : 'Clear sound is off. The earbuds mic works again (call quality).'
        return 'Asked Windows, but it did not change yet. Reconnect the earbuds and look again.'
      }
      case 'audio_set': {
        const name = (await listOutputs()).find((n) => n.toLowerCase() === String(arg ?? '').toLowerCase().trim())
        if (!name) throw new Error('That audio output is not available on this PC right now.')
        const out = (await ps(audioScript(name), { timeout: 30_000 })).trim().split(/\r?\n/).at(-1)
        if (out !== 'ok') throw new Error(out === 'notfound' ? 'Windows no longer lists that output.' : 'Windows refused to switch the audio output.')
        outputs.stale()
        return `Sound now plays on ${name}.`
      }
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
      const m = /^(\d{1,3})\|(\d{1,2})$/.exec((await ps(BATTERY)).trim())
      if (m && Number(m[1]) <= 100) parts.push(`Battery ${m[1]}% (${[1, 4, 5].includes(Number(m[2])) ? 'on battery' : 'plugged in'})`)
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
      // Everything the page shows is asked at the SAME time (each answer is cached and shared), so the page waits for the slowest one,
      // not for all of them in a row.
      let timer
      // One part failing never blanks the page: it just comes back empty and the rest is shown.
      const safe = (promise, empty) => Promise.resolve(promise).catch(() => empty)
      const [modelName, steam, games, art, vol, bt, outs, apps, tm, bat, hf] = await Promise.all([
        safe(Promise.race([model(), new Promise((r) => (timer = setTimeout(() => r(''), 1500)))]), ''),
        safe(steamInfo(), null),
        safe(gameList(), []),
        safe(artList(), []),
        safe(readVolume(), null),
        safe(listBluetooth(), []),
        safe(listOutputs(), []),
        safe(appChoices(), new Map()),
        safe(timers(), null),
        safe(laptopBattery(), null),
        safe(handsFree(), null),
      ])
      clearTimeout(timer)
      return {
        name: hostname(),
        model: modelName,
        version,
        update: updateInfo(),
        games: (games ?? []).map((g) => g.name),
        gameArt: art ?? [],
        buttons: Object.keys(buttons()),
        mode: readMode(),
        favorites: knownFavorites(files.favorites, readText),
        customGames: extraGames(files.games, readText).map((g) => ({ name: g.name, appid: g.appid })),
        timers: tm,
        timerChoices: platform === 'win32' ? { screen: TIMERS.screen.choices, sleep: TIMERS.sleep.choices } : null,
        volume: vol,
        headphones: (bt ?? []).map((d) => d.name),
        btConnected: (bt ?? []).filter((d) => d.connected).map((d) => d.name),
        handsFree: hf ?? null,
        btBattery: Object.fromEntries((bt ?? []).filter((d) => d.connected && d.battery).map((d) => [d.name, d.battery])),
        battery: bat,
        outputs: outs ?? [],
        apps: [...(apps ?? new Map()).values()].map((c) => c.label),
        steam: steam ? { user: steam.user, playing: steam.playing, id: steam.id, avatar: Boolean(steam.id && steam.path), accounts: steam.accounts.map(({ id, name }) => ({ id, name })) } : null,
      }
    },
    /** How many games each source found right now (for Diagnostics). */
    async gameSources() {
      if (platform !== 'win32') return null
      const d = await discoverGames()
      return { files: d.files, steam: d.steam, otherDrives: d.otherDrives, added: d.added, total: d.list.length }
    },
    /** The windows open on this PC (for the page's Windows list). */
    windows: windowsFeature.list,
    clipboardSet: clipboard.set,
    clipboardGet: clipboard.get,
    media: async () => (await media.now()) ?? null,
    cover: media.cover,
    /** Windows questions that failed lately, for Diagnostics: [{ what, message, seconds }]. */
    problems: () => [...failures].map(([what, f]) => ({ what, message: f.message, seconds: Math.round((now() - f.at) / 1000) })),
    /** How long each slow question to Windows takes right now (asked fresh, all at once, like the page does). For Diagnostics. */
    async timings() {
      if (platform !== 'win32') return []
      const time = async (name, fn) => {
        const t0 = performance.now()
        let ok = true
        try {
          await fn()
        } catch {
          ok = false
        }
        return { name, ms: Math.round(performance.now() - t0), ok }
      }
      return Promise.all([
        time('PowerShell start', () => ps('1')),
        time('volume', () => volume.fresh()),
        time('Bluetooth', () => bluetooth.fresh()),
        time('sound outputs', () => outputs.fresh()),
        time('Start menu apps', () => startNames.fresh()),
      ])
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
  clipboardGet: CLIP_GET,
  clipboardSet: clipSetScript('hello'),
  mediaInfo: MEDIA_INFO,
  mediaCover: MEDIA_COVER,
  handsFreeState: HF_STATE,
  handsFreeSetup: hfSetupScript(),
  handsFreeOff: hfCommand(true),
  handsFreeOn: hfCommand(false),
  keys: keyScript(175, 5),
  screenOff: SCREEN_OFF,
  sleep: SLEEP,
  closeGame: CLOSE_GAME,
  battery: BATTERY,
  startNames: START_NAMES,
  startApp: startAppScript("Some 'App'", false),
  drives: DRIVES,
  windowsList: windowsScript('list'),
  windowsFocus: windowsScript('focus', '123'),
  toggleDesktop: TOGGLE_DESKTOP,
  volumeGet: volumeScript('get'),
  volumeSet: volumeScript('set', 40),
  btList: BT_LIST,
  btNames: BT_NAMES,
  btConnect: btScript('Some Buds', true),
  audioList: AUDIO_LIST,
  audioSet: audioScript('Some Speakers'),
  model: MODEL,
}
