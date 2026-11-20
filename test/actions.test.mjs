import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIONS, APP_CANDIDATES, cleanModel, createActions, knownButtons, knownCustomApps } from '../src/actions.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const decode = (args) => Buffer.from(args.at(-1), 'base64').toString('utf16le')

const VDF = `"users"\n{\n"76561198000000001"\n{\n"AccountName" "alpha_login"\n"PersonaName" "Alpha"\n"RememberPassword" "1"\n"MostRecent" "1"\n}\n"76561198000000002"\n{\n"AccountName" "beta_login"\n"PersonaName" "Beta"\n"RememberPassword" "1"\n"MostRecent" "0"\n}\n}`
const manifest = (id, name) => `"AppState" { "appid" "${id}" "name" "${name}" }`

function lab(t, { platform = 'win32', ps = {}, extra = {} } = {}) {
  const home = tempDir(t)
  const steam = join(tempDir(t), 'Steam')
  writeTree(steam, {
    'steam.exe': '',
    'config/loginusers.vdf': VDF,
    'steamapps/appmanifest_730.acf': manifest(730, 'Counter-Strike 2'),
    'steamapps/appmanifest_1145360.acf': manifest(1145360, 'Hades'),
    'appcache/librarycache/730_header.jpg': 'JPEGDATA',
    'config/avatarcache/76561198000000001.png': 'PNGDATA',
  })
  const files = { buttons: join(home, 'buttons.json'), apps: join(home, 'apps.json'), games: join(home, 'games.json'), switchLog: join(home, 'switch.log') }
  const calls = []
  const launched = []
  const spawned = []
  let steamRunning = true
  const run = async (file, args) => {
    calls.push([file, ...args])
    if (file === 'reg.exe' && args[0] === 'query') {
      if (args.includes('SteamPath')) return `    SteamPath    REG_SZ    ${steam}\n`
      if (args.includes('ActiveUser')) return '    ActiveUser    REG_DWORD    0x1\n'
      if (args.includes('RunningAppID')) return '    RunningAppID    REG_DWORD    0x2da\n'
    }
    if (file === 'tasklist.exe') return steamRunning ? 'steam.exe  1234 Console 1 90,000 K' : 'INFO: No tasks are running'
    if (file.endsWith('steam.exe') && args[0] === '-shutdown') {
      steamRunning = false
      return ''
    }
    if (file === 'powershell.exe') {
      const script = decode(args)
      for (const [needle, answer] of Object.entries(ps)) if (script.includes(needle)) return typeof answer === 'function' ? answer(script) : answer
      if (script.includes('Get-StartApps | ForEach-Object')) return 'Discord\nSpotify\nSome Other App\n'
      if (script.includes('Win32_ComputerSystem')) return 'ASUSTeK COMPUTER INC.|ROG Strix G16_G614JV\n'
      return ''
    }
    return ''
  }
  const actions = createActions({
    files,
    version: '0.1.0',
    run,
    launch: async (x) => launched.push(x),
    spawnFn: (...a) => {
      spawned.push(a)
      return { once: (ev, cb) => (ev === 'spawn' ? setImmediate(cb) : undefined), unref() {} }
    },
    sleep: async () => {},
    platform,
    readdir: readdirSync,
    uptimeFn: () => 3 * 3600 + 120,
    hostname: () => 'TEST-PC',
    update: async () => 'Updated.',
    ...extra,
  })
  return { actions, calls, launched, spawned, files, steam, home }
}

test('Steam and games: only games from the PC list can be started', async (t) => {
  const { actions, launched } = lab(t)
  assert.equal(await actions.run('steam_open'), 'Opening Steam.')
  assert.equal(await actions.run('steam_bigpicture'), 'Opening Big Picture.')
  assert.match(await actions.run('steam_game', 'Hades'), /Starting Hades/)
  assert.match(await actions.run('steam_game', 'counter-strike 2'), /Starting Counter-Strike 2/)
  assert.deepEqual(launched, ['steam://open/main', 'steam://open/bigpicture', 'steam://rungameid/1145360', 'steam://rungameid/730'])
  for (const bad of ['Unknown game', '730', '730 & calc', '../x', '', undefined]) await assert.rejects(actions.run('steam_game', bad), /not in the list/, String(bad))
  assert.equal(launched.length, 4)
})

test('starting a game switches the PC to Performance mode first, and a failure never stops the game', async (t) => {
  const { actions, calls, launched } = lab(t)
  assert.match(await actions.run('steam_game', 'Hades'), /Starting Hades in Performance mode/)
  assert.ok(calls.some((c) => c[0] === 'powercfg.exe' && c[1] === '/overlaysetactive' && c[2] === 'OVERLAY_SCHEME_MAX'), 'performance mode was set')
  assert.deepEqual(launched, ['steam://rungameid/1145360'])
})

test('games.json adds games Steam does not list', async (t) => {
  const { actions, launched, files } = lab(t)
  writeFileSync(files.games, JSON.stringify({ 'My Emulator': 999 }))
  await actions.run('steam_game', 'my emulator')
  assert.deepEqual(launched, ['steam://rungameid/999'])
})

test('close game reports what closed and what refused', async (t) => {
  const a = lab(t, { ps: { steamapps: 'PUBG\nlauncher\n!launcher\n' } })
  assert.equal(await a.actions.run('close_game'), 'Closed: PUBG. Could not close: launcher (protected or still saving). Close it in the game.')
  const b = lab(t, { ps: { steamapps: '' } })
  assert.equal(await b.actions.run('close_game'), 'No Steam game is running.')
})

test('power buttons run the right Windows commands', async (t) => {
  const { actions, calls } = lab(t)
  await actions.run('lock')
  await actions.run('restart')
  await actions.run('shutdown')
  await actions.run('shutdown_cancel')
  assert.deepEqual(calls[0], ['rundll32.exe', 'user32.dll,LockWorkStation'])
  assert.deepEqual(calls[1].slice(0, 4), ['shutdown.exe', '/r', '/t', '10'])
  assert.deepEqual(calls[2].slice(0, 4), ['shutdown.exe', '/s', '/t', '15'])
  assert.deepEqual(calls[3], ['shutdown.exe', '/a'])
  await actions.run('sleep')
  assert.match(decode(calls.at(-1)), /SetSuspendState/)
  await actions.run('screen_off')
  assert.match(decode(calls.at(-1)), /0xF170/)
})

test('cancel with nothing waiting gives a plain error', async (t) => {
  const { actions } = lab(t, { extra: { run: async (file) => { if (file === 'shutdown.exe') throw new Error('x'); return '' } } })
  await assert.rejects(actions.run('shutdown_cancel'), /no turn off or restart waiting/)
})

test('media keys press the right key the right number of times', async (t) => {
  const { actions, calls } = lab(t)
  assert.equal(await actions.run('volume_up'), 'Volume up.')
  assert.match(decode(calls.at(-1)), /1\.\.5 .*keybd_event\(175,/s)
  await actions.run('mute')
  assert.match(decode(calls.at(-1)), /1\.\.1 .*keybd_event\(173,/s)
})

test('everything refuses cleanly on a system that is not Windows', async (t) => {
  const { actions } = lab(t, { platform: 'linux' })
  for (const a of ['steam_open', 'lock', 'restart', 'shutdown', 'sleep', 'screen_off', 'volume_up', 'close_game', 'app']) {
    await assert.rejects(actions.run(a, 'x'), /Windows only/, a)
  }
  const info = await actions.info()
  assert.equal(info.steam, null)
  assert.deepEqual(info.games, [])
})

test('an unknown action is refused, and the allow-list is what the page can ask for', async (t) => {
  const { actions } = lab(t)
  await assert.rejects(actions.run('format_c'), /Unknown action/)
  assert.ok(ACTIONS.includes('shutdown') && !ACTIONS.includes('wake') && !ACTIONS.includes('run'))
})

test('apps: only installed apps from the list, plus your own', async (t) => {
  const { actions, calls, files } = lab(t)
  writeFileSync(files.apps, JSON.stringify({ 'My Editor': 'Visual Studio Code', '': 'x', long: 'y'.repeat(100) }))
  const info = await actions.info()
  assert.deepEqual(info.apps, ['Spotify', 'My Editor'])
  const ps = (script) => (script.includes('Start-Process explorer.exe') ? 'Spotify' : '')
  const lab2 = lab(t, { ps: { 'Start-Process explorer.exe': ps } })
  assert.match(await lab2.actions.run('app', 'spotify'), /Opening Spotify/)
  assert.match(decode(lab2.calls.at(-1)), /\$_\.Name -like \$n/)
  await assert.rejects(lab2.actions.run('app', 'powershell'), /Unknown app/)
  await assert.rejects(lab2.actions.run('app', "x'; calc; '"), /Unknown app/)
  assert.ok(calls.length > 0)
})

test('app names with quotes cannot change the script', async (t) => {
  const { actions, calls, files } = lab(t, { ps: { 'Start-Process explorer.exe': '' } })
  writeFileSync(files.apps, JSON.stringify({ evil: "x'; Remove-Item C:\\ -Recurse; '" }))
  await assert.rejects(actions.run('app', 'evil'), /not found in the Start menu/)
  const script = decode(calls.at(-1))
  assert.ok(script.includes("$n = 'x''; Remove-Item C:\\ -Recurse; '''"), script)
})

test('your own buttons run by name only', async (t) => {
  const { actions, spawned, files } = lab(t)
  writeFileSync(files.buttons, JSON.stringify({ 'My Tests': { command: 'npm test', cwd: '' }, 'bad\nname': { command: 'x' }, nocmd: {}, sneaky: { command: 'a\r\nb' } }))
  assert.deepEqual(Object.keys(knownButtons(files.buttons)), ['my tests'])
  assert.equal(await actions.run('button', 'MY TESTS'), 'Started: my tests.')
  assert.deepEqual(spawned[0].slice(0, 2), ['cmd.exe', ['/d', '/s', '/c', '"npm test"']])
  await assert.rejects(actions.run('button', 'format c:'), /not in buttons.json/)
  assert.equal(spawned.length, 1)
})

test('custom apps file ignores odd entries', (t) => {
  const { files } = lab(t)
  writeFileSync(files.apps, JSON.stringify({ ok: 'App', 'a\u0001b': 'x', big: 'z'.repeat(70) }))
  assert.deepEqual(Object.keys(knownCustomApps(files.apps)), ['ok'])
  assert.deepEqual(knownCustomApps(join(files.apps, 'missing')), {})
})

test('switching Steam account follows the steps, in the background, and logs them', async (t) => {
  const { actions, calls, spawned, files, steam } = lab(t)
  const msg = await actions.run('steam_switch', '76561198000000002')
  assert.match(msg, /Switching Steam to Beta/)
  await actions.settled()
  const flat = calls.map((c) => c.join(' '))
  assert.ok(flat.some((c) => c.endsWith('-shutdown')))
  assert.ok(flat.some((c) => /reg\.exe add .*AutoLoginUser.* \/d beta_login/.test(c)))
  assert.ok(flat.some((c) => /RememberPassword/.test(c)))
  assert.match(readFileSync(join(steam, 'config', 'loginusers.vdf'), 'utf8'), /"76561198000000002"\s*\{[^}]*"MostRecent"\s+"1"/)
  assert.ok(readFileSync(join(steam, 'config', 'loginusers.vdf.rsp-backup'), 'utf8').includes('alpha_login'))
  assert.equal(spawned.length, 1)
  assert.match(readFileSync(files.switchLog, 'utf8'), /steam started: done/)
})

test('switching is refused for an account the PC does not stay signed in to, or the current one', async (t) => {
  const { actions, spawned } = lab(t)
  await assert.rejects(actions.run('steam_switch', '76561198999999999'), /not an account/)
  await assert.rejects(actions.run('steam_switch', 'alpha_login'), /not an account/)
  assert.match(await actions.run('steam_switch', '76561198000000001'), /already signed in/)
  assert.equal(spawned.length, 0)
})

test('info gives the page everything: name, model, games, steam, apps, buttons', async (t) => {
  const { actions, files } = lab(t)
  writeFileSync(files.buttons, JSON.stringify({ build: 'npm run build' }))
  const info = await actions.info()
  assert.equal(info.name, 'TEST-PC')
  assert.equal(info.model, 'ROG Strix G16')
  assert.equal(info.version, '0.1.0')
  assert.deepEqual(info.games, ['Counter-Strike 2', 'Hades'])
  assert.deepEqual(info.gameArt, ['Counter-Strike 2'])
  assert.deepEqual(info.buttons, ['build'])
  assert.deepEqual(info.steam, { user: 'Alpha', playing: 'Counter-Strike 2', id: '76561198000000001', avatar: true, accounts: [{ id: '76561198000000001', name: 'Alpha' }, { id: '76561198000000002', name: 'Beta' }] })
  assert.equal(JSON.stringify(info).includes('alpha_login'), false, 'login names never leave the PC')
})

test('pictures: game art and the Steam avatar are read from Steam, only for known names', async (t) => {
  const { actions } = lab(t)
  assert.deepEqual(await actions.gameArt('Counter-Strike 2'), { type: 'image/jpeg', bytes: Buffer.from('JPEGDATA') })
  assert.equal(await actions.gameArt('Hades'), null)
  assert.equal(await actions.gameArt('../../Windows/win.ini'), null)
  assert.deepEqual(await actions.avatar(), { type: 'image/png', bytes: Buffer.from('PNGDATA') })
})

test('status joins what it can read, and update is passed through', async (t) => {
  const { actions } = lab(t, { ps: { Win32_Battery: '80|2\n' } })
  assert.equal(await actions.run('status'), 'Battery 80% (plugged in) · Up 3h 2m')
  assert.equal(await actions.run('update'), 'Updated.')
})

test('cleanModel tidies the model name', () => {
  assert.equal(cleanModel('ASUSTeK COMPUTER INC.|ROG Strix G614JV_G614JV'), 'ROG Strix G614JV')
  assert.equal(cleanModel(''), '')
  assert.deepEqual(APP_CANDIDATES.map((a) => a[0]), ['Spotify'])
})

test('headphones: only a paired device, by exact name, can be connected or disconnected, and the real state is reported', async (t) => {
  let airpodsConnected = false
  const { actions, calls } = lab(t, {
    ps: {
      'Get-PnpDeviceProperty': () => `AirPods\t${airpodsConnected ? 'True' : 'False'}\nAirPods\tFalse\nBuds\tTrue\n`,
      'AudioEndpoint': 'Speakers (Realtek)\nBuds Stereo\n',
      BluetoothSetServiceState: () => {
        airpodsConnected = !airpodsConnected
        return 'ok\n'
      },
    },
  })
  let info = await actions.info()
  assert.deepEqual(info.headphones, ['AirPods', 'Buds'])
  assert.deepEqual(info.btConnected, ['Buds'], 'only a device Windows reports as connected')
  assert.deepEqual(info.outputs, ['Speakers (Realtek)', 'Buds Stereo'])
  assert.equal(await actions.run('bt_connect', 'airpods'), 'AirPods is connected.')
  assert.match(decode(calls.find((c) => c[0] === 'powershell.exe' && decode(c).includes('$connect = $true'))), /\$name = 'AirPods'/)
  assert.match(await actions.run('bt_disconnect', 'AirPods'), /AirPods is disconnected/)
  for (const bad of ["x'; calc; '", 'A Mouse', '', undefined]) await assert.rejects(actions.run('bt_connect', bad), /not paired/)
  // When Windows never shows the new state the answer is honest about it.
  const stuck = lab(t, { ps: { 'Get-PnpDeviceProperty': 'Buds\tFalse\n', BluetoothSetServiceState: 'ok\n' } })
  assert.match(await stuck.actions.run('bt_connect', 'Buds'), /not connected yet/)
})

test('audio output: only an active playback device, by exact name', async (t) => {
  const { actions, calls } = lab(t, { ps: { 'ForEach-Object { $_.FriendlyName }': 'Speakers (Realtek)\nBuds Stereo\n', SetDefaultEndpoint: 'ok\n' } })
  assert.match(await actions.run('audio_set', 'buds stereo'), /Sound now plays on Buds Stereo/)
  assert.match(decode(calls.at(-1)), /\$name = 'Buds Stereo'/)
  for (const bad of ["x'; calc; '", 'Unknown', '', undefined]) await assert.rejects(actions.run('audio_set', bad), /not available/)
})

test('restart remote asks the program to restart itself', async (t) => {
  let restarted = 0
  const { actions } = lab(t, { extra: { restart: () => (restarted++, 'Restarting') } })
  assert.equal(await actions.run('restart_remote'), 'Restarting')
  assert.equal(restarted, 1)
})

test('power modes: the right Windows command, remembered for the page, with fallbacks', async (t) => {
  const { actions, calls, home } = lab(t)
  const modeFile = join(home, 'mode.txt')
  const a = createActions({ files: { buttons: join(home, 'b.json'), apps: join(home, 'a.json'), games: join(home, 'g.json'), switchLog: join(home, 's.log'), mode: modeFile }, run: async (f, args) => (calls.push([f, ...args]), ''), platform: 'win32', readdir: readdirSync, sleep: async () => {}, hostname: () => 'PC' })
  assert.equal(await a.run('mode_saver'), 'Efficiency power mode.')
  assert.deepEqual(calls.filter((c) => c[0] === 'powercfg.exe').at(-1), ['powercfg.exe', '/overlaysetactive', 'OVERLAY_SCHEME_MIN'])
  assert.equal(readFileSync(modeFile, 'utf8'), 'saver')
  assert.equal((await a.info()).mode, 'saver')
  await a.run('mode_gaming')
  assert.deepEqual(calls.filter((c) => c[0] === 'powercfg.exe').at(-1), ['powercfg.exe', '/overlaysetactive', 'OVERLAY_SCHEME_MAX'])
  const b = createActions({ files: { buttons: join(home, 'b.json'), apps: join(home, 'a.json'), games: join(home, 'g.json'), switchLog: join(home, 's.log'), mode: modeFile }, run: async (f, args) => { if (args[0] === '/overlaysetactive') throw new Error('no overlay'); calls.push([f, ...args]); return '' }, platform: 'win32', readdir: readdirSync, sleep: async () => {}, hostname: () => 'PC' })
  await b.run('mode_balanced')
  assert.deepEqual(calls.filter((c) => c[0] === 'powercfg.exe').at(-1), ['powercfg.exe', '/setactive', '381b4222-f694-41f0-9685-ff5bb260df2e'])
  assert.ok(actions)
})

test('info tells the page whether an update is waiting', async (t) => {
  const a = lab(t, { extra: { updateInfo: () => ({ available: true, boot: 'abc' }) } })
  assert.deepEqual((await a.actions.info()).update, { available: true, boot: 'abc' })
  assert.deepEqual((await lab(t).actions.info()).update, { available: false, boot: '' })
})

test('ASUS laptops: the Armoury Crate mode follows the button, and a PC without the ASUS device keeps only the Windows modes', async (t) => {
  let asusMode = 0
  const asus = lab(t, {
    ps: {
      RspAsus: (script) => {
        if (script.includes("$op = 'probe'")) return 'yes\n'
        if (script.includes("$op = 'get'")) return `mode:${asusMode}\n`
        asusMode = Number(/\$val = (\d+)/.exec(script)[1])
        return 'ok\n'
      },
    },
  })
  assert.equal((await asus.actions.info()).asus, true)
  assert.equal(await asus.actions.run('mode_gaming'), 'Turbo mode.')
  assert.equal(asusMode, 1)
  assert.equal((await asus.actions.info()).mode, 'gaming', 'the page shows what the laptop really says')
  assert.equal(await asus.actions.run('mode_saver'), 'Silent mode.')
  assert.equal(asusMode, 2)
  assert.equal(await asus.actions.run('mode_balanced'), 'Performance mode.')
  assert.equal(asusMode, 0)
  // Starting a game: Windows best performance + ASUS Performance (not Turbo).
  await asus.actions.run('steam_game', 'Hades')
  assert.equal(asusMode, 0)
  // A refusal is reported, the Windows mode stays set.
  const refuse = lab(t, { ps: { RspAsus: (script) => (script.includes("$op = 'probe'") ? 'yes\n' : script.includes("$op = 'get'") ? 'mode:0\n' : 'fail:0\n') } })
  assert.match(await refuse.actions.run('mode_gaming'), /did not switch/)
  // Mode 3 (full speed / manual): the ASUS buttons are still offered, so the laptop can be switched out of it.
  const three = lab(t, { ps: { RspAsus: (script) => (script.includes("$op = 'probe'") ? 'yes\n' : script.includes("$op = 'get'") ? 'mode:3\n' : 'ok\n') } })
  assert.equal((await three.actions.info()).asus, true)
  assert.equal((await three.actions.info()).mode, '', 'no button is highlighted for a mode that has none')
  // An unknown number: plain Windows buttons, the ASUS write is never tried.
  const weird = lab(t, { ps: { RspAsus: (script) => (script.includes("$op = 'probe'") ? 'yes\n' : script.includes("$op = 'get'") ? 'mode:9\n' : 'ok\n') } })
  assert.equal((await weird.actions.info()).asus, false)
  assert.match(await weird.actions.run('mode_gaming'), /^Performance power mode\.$/)
  assert.ok(!weird.calls.some((c) => c[0] === 'powershell.exe' && decode(c).includes("$op = 'set'")))
  // No ASUS device: plain Windows behaviour.
  const plain = lab(t, { ps: { RspAsus: 'no\n' } })
  assert.equal((await plain.actions.info()).asus, false)
  assert.match(await plain.actions.run('mode_gaming'), /power mode/)
})

test('volume: a real level 0 to 100, read for the slider and set from it, plus mute', async (t) => {
  let level = 35
  let muted = false
  const { actions, calls } = lab(t, {
    ps: {
      RspVol: (script) => {
        const op = /\$op = '(\w+)'/.exec(script)[1]
        if (op === 'set') {
          level = Number(/\$level = (\d+)/.exec(script)[1])
          if (level > 0) muted = false
        }
        if (op === 'mute') muted = true
        if (op === 'unmute') muted = false
        return `vol:${level} mute:${muted ? 1 : 0}\n`
      },
    },
  })
  assert.deepEqual((await actions.info()).volume, { level: 35, muted: false })
  assert.equal(await actions.run('volume_set', '80'), 'Volume 80%.', 'the phone sends text')
  assert.equal(await actions.run('volume_set', 80), 'Volume 80%.')
  assert.equal(await actions.run('mute_set', 'on'), 'Muted.')
  assert.equal(await actions.run('mute_set', 'off'), 'Sound on, volume 80%.')
  for (const bad of [-1, 101, 5.5, 'loud', undefined, '5; calc', '', '1e2', ' 50', '0x10']) await assert.rejects(actions.run('volume_set', bad), /whole number/, String(bad))
  await assert.rejects(actions.run('mute_set', 'maybe'), /on or off/)
  assert.ok(calls.some((c) => c[0] === 'powershell.exe' && decode(c).includes('$level = 80')))
  // A PC that cannot report a level: no slider data (the page keeps the three keys).
  const plain = lab(t, { ps: { RspVol: 'nonsense\n' } })
  assert.equal((await plain.actions.info()).volume, null)
})
