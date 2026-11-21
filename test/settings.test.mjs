import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuth } from '../src/auth.mjs'
import { normalizeConfig } from '../src/config.mjs'
import { createPin } from '../src/pin.mjs'
import { createSettings } from '../src/settings.mjs'
import { iconTheme, safeCoffeeUrl, shortcutName, startServer } from '../src/server.mjs'
import { runStartup } from '../src/startup.mjs'
import { tempDir } from './helpers.mjs'

const webDir = fileURLToPath(new URL('../src/web', import.meta.url))

function make(t, { platform = 'win32', run } = {}) {
  const dir = tempDir(t)
  const config = normalizeConfig({})
  const pin = createPin({ file: join(dir, 'pin.json') })
  const calls = []
  const s = createSettings({ file: join(dir, 'config.json'), config, pin, platform, version: '1.0', hostname: () => 'MY-PC', run: run ?? (async (f, a) => (calls.push([f, ...a]), 'Status: Ready\n')) })
  return { s, config, pin, calls, dir }
}

test('settings are read with the startup task state, and saved to the file and the running config', async (t) => {
  const { s, config, dir } = make(t)
  const got = await s.get()
  assert.equal(got.startupTask, 'on')
  assert.equal(got.host, 'MY-PC')
  assert.equal(got.values.lan, false)
  assert.deepEqual(s.save({ steamAtStart: true, steamDelay: 3, name: 'Desk', lan: true }).changed.sort(), ['allow', 'name', 'steamAtStart', 'steamDelay'])
  assert.equal(config.steamAtStart, true)
  assert.ok(config.allow.includes('lan'))
  const onDisk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
  assert.equal(onDisk.name, 'Desk')
  assert.ok(onDisk.allow.includes('lan'))
  s.save({ lan: false })
  assert.ok(!config.allow.includes('lan') && config.allow.includes('loopback'))
  assert.throws(() => s.save({ port: 22 }), /cannot be changed/)
})

test('the startup task can be switched, with plain errors', async (t) => {
  const a = make(t)
  assert.equal(await a.s.setTask(false), 'off')
  assert.deepEqual(a.calls.at(-1), ['schtasks.exe', '/change', '/tn', 'RemortStartPc', '/disable'])
  assert.equal(await a.s.setTask(true), 'on')
  const denied = make(t, { run: async (f, args) => { if (args[0] === '/change') throw new Error('Access is denied'); return 'Status: Ready' } })
  await assert.rejects(denied.s.setTask(false), /Windows refused: Access is denied/)
  const missing = make(t, { run: async () => { throw new Error('not found') } })
  assert.equal((await missing.s.get()).startupTask, 'missing')
  await assert.rejects(missing.s.setTask(true), /no automatic start/)
  assert.equal((await make(t, { platform: 'linux' }).s.get()).startupTask, null)
  assert.equal((await a.s.get()).windows, true)
})

test('a disabled task is reported as off', async (t) => {
  const { s } = make(t, { run: async () => 'TaskName: x\nStatus: Disabled\n' })
  assert.equal((await s.get()).startupTask, 'off')
})

test('changing the PIN needs the current one, refuses weak ones, and can remove it', (t) => {
  const { s, pin } = make(t)
  assert.equal(s.changePin('1.1.1.1', '', '8426'), 'set')
  assert.equal(pin.check('8426'), true)
  assert.throws(() => s.changePin('1.1.1.1', '0000', '2580'), /Wrong PIN/)
  assert.throws(() => s.changePin('1.1.1.1', '8426', '1234'), /too easy/)
  assert.throws(() => s.changePin('1.1.1.1', '8426', 'abc'), /4 to 8 digits/)
  assert.equal(s.changePin('1.1.1.1', '8426', '2580'), 'set')
  assert.equal(pin.check('2580'), true)
  assert.equal(s.changePin('1.1.1.1', '2580', ''), 'removed')
  assert.equal(pin.isSet(), false)
})

function boot(t, config, calls, { now = 1_800_000_000_000, uptimeS = 300, saved = null } = {}) {
  let stamp = saved
  const waits = []
  const actions = { run: async (a) => (calls.push(a), 'ok') }
  const go = () => runStartup({ config, actions, stampFile: 'x', now: () => now, uptimeFn: () => uptimeS, read: () => { if (stamp === null) throw new Error('none'); return stamp }, write: (f, text) => (stamp = text), sleep: async (ms) => waits.push(ms), log: () => {} })
  return { go, waits, stamp: () => stamp }
}

test('startup: Steam Big Picture is done once per boot, not at every program restart', async (t) => {
  const calls = []
  const b = boot(t, normalizeConfig({ steamAtStart: true, steamDelay: 4 }), calls)
  assert.deepEqual(await b.go(), { steam: 'started' })
  assert.deepEqual(calls, ['steam_bigpicture'])
  assert.deepEqual(b.waits, [4000])
  assert.deepEqual(await b.go(), {}, 'the same boot: nothing again')
  const later = boot(t, normalizeConfig({ steamAtStart: true }), calls, { now: 1_800_000_000_000 + 4 * 3600 * 1000, saved: b.stamp() })
  assert.equal((await later.go()).steam, 'started')
})

test('startup: nothing is done unless asked, a failed first try is repeated once', async (t) => {
  const none = []
  assert.deepEqual(await boot(t, normalizeConfig({}), none).go(), {})
  assert.deepEqual(none, [])
  let tries = 0
  const waits = []
  const r = await runStartup({ config: normalizeConfig({ steamAtStart: true }), actions: { run: async () => { if (++tries === 1) throw new Error('not ready') } }, stampFile: 'x', read: () => { throw new Error('n') }, write() {}, sleep: async (ms) => waits.push(ms), log: () => {} })
  assert.equal(r.steam, 'started')
  assert.deepEqual(waits, [0, 15000])
  assert.deepEqual(await runStartup({ config: normalizeConfig({ steamAtStart: true }), actions: null, stampFile: 'x', read() {}, write() {} }), {})
})

async function server(t, { withPin = false } = {}) {
  const dir = tempDir(t)
  const auth = createAuth({ file: join(dir, 'phones.json') })
  const { key } = auth.add('Phone')
  const config = normalizeConfig({ name: '' })
  const pin = createPin({ file: join(dir, 'pin.json') })
  if (withPin) pin.set('8426')
  const settings = createSettings({ file: join(dir, 'config.json'), config, pin, platform: 'win32', hostname: () => 'HOST', run: async () => 'Status: Ready' })
  const srv = await startServer({ port: 0, host: '127.0.0.1', auth, pin, settings, actions: { info: async () => ({ name: 'HOST' }), run: async () => 'ok', avatar: async () => null, gameArt: async () => null }, config, webDir })
  t.after(() => srv.close())
  const base = `http://127.0.0.1:${srv.port}`
  const post = (path, body = {}, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...headers }, body: JSON.stringify(body) })
  return { base, post, key, config, pin }
}

test('the Settings page and its scripts are served, and the API needs a paired phone and the PIN', async (t) => {
  const { base, post, key } = await server(t, { withPin: true })
  for (const p of ['/settings', '/settings.js', '/common.js']) assert.equal((await fetch(base + p)).status, 200, p)
  assert.equal((await fetch(base + '/api/settings', { method: 'POST' })).status, 401)
  const noPin = await post('/api/settings')
  assert.equal(noPin.status, 401)
  assert.equal((await noPin.json()).code, 'pin')
  const { token } = await (await post('/api/unlock', { pin: '8426' })).json()
  const got = await (await post('/api/settings', {}, { 'x-unlock': token })).json()
  assert.equal(got.hasPin, true)
  assert.equal(got.host, 'HOST')
  assert.ok(key)
})

test('saving a setting changes the running page at once, and bad changes are refused', async (t) => {
  const { post } = await server(t)
  assert.equal((await post('/api/settings/save', { changes: { name: 'My Desk', theme: 'tactical', order: 3 } })).status, 200)
  const state = await (await post('/api/state')).json()
  assert.deepEqual([state.pc.name, state.pc.theme, state.pc.order], ['My Desk', 'tactical', 3])
  const bad = await post('/api/settings/save', { changes: { port: 22 } })
  assert.equal(bad.status, 400)
  assert.match((await bad.json()).error, /cannot be changed/)
  const lan = await (await post('/api/settings/save', { changes: { lan: true } })).json()
  assert.equal(lan.restart, true)
  assert.match(lan.message, /restarts/)
})

test('the PIN can be set, changed and removed from the Settings page', async (t) => {
  const { post, pin } = await server(t)
  assert.equal((await post('/api/settings/pin', { current: '', next: '8426' })).status, 200)
  assert.equal(pin.isSet(), true)
  // The PIN is now required for everything, including more changes.
  assert.equal((await post('/api/settings')).status, 401)
  const { token } = await (await post('/api/unlock', { pin: '8426' })).json()
  const h = { 'x-unlock': token }
  assert.equal((await post('/api/settings/pin', { current: '0000', next: '2580' }, h)).status, 401)
  assert.equal((await post('/api/settings/pin', { current: '8426', next: '2580' }, h)).status, 200)
  assert.equal(pin.check('2580'), true)
  assert.equal((await post('/api/state', {}, h)).status, 401, 'the old PIN session ends when the PIN changes')
})

async function localServer(t, { withPin = false } = {}) {
  const dir = tempDir(t)
  const auth = createAuth({ file: join(dir, 'phones.json') })
  const { key } = auth.add('Phone')
  const config = normalizeConfig({})
  const pin = createPin({ file: join(dir, 'pin.json') })
  if (withPin) pin.set('8426')
  const calls = []
  const settings = createSettings({ file: join(dir, 'config.json'), appsFile: join(dir, 'apps.json'), config, pin, platform: 'win32', hostname: () => 'HOST', dir, run: async () => 'Status: Ready' })
  const srv = await startServer({
    port: 0, host: '127.0.0.1', auth, pin, settings, config, webDir,
    actions: { info: async () => ({ name: 'HOST' }), run: async (a) => (calls.push(a), 'ok'), avatar: async () => null, gameArt: async () => null },
    pairing: async () => ({ url: 'http://100.1.2.3:8791/?k=SECRET', svg: '<svg/>', label: 'Phone 2' }),
  })
  t.after(() => srv.close())
  const port = srv.port
  const local = (path, body = {}, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rsp-local': '1', ...headers }, body: JSON.stringify(body) })
  return { local, key, port, calls, dir, pin }
}

test('on the PC itself the Settings page works with no phone key', async (t) => {
  const { local } = await localServer(t)
  const got = await local('/api/settings')
  assert.equal(got.status, 200)
  assert.equal((await got.json()).host, 'HOST')
  assert.equal((await local('/api/settings/save', { changes: { name: 'Local' } })).status, 200)
})

test('the local access is only for the settings, never for the buttons or the state', async (t) => {
  const { local } = await localServer(t)
  for (const path of ['/api/state', '/api/do', '/api/avatar', '/api/gameart']) assert.equal((await local(path, { action: 'lock' })).status, 401, path)
})

import { request } from 'node:http'
const raw = (port, path, headers) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end('{}')
  })

test('the local access refuses a request that does not look like the real local page', async (t) => {
  const { port } = await localServer(t)
  const ok = { 'x-rsp-local': '1', host: `127.0.0.1:${port}` }
  assert.equal(await raw(port, '/api/settings', ok), 200)
  assert.equal(await raw(port, '/api/settings', { host: `127.0.0.1:${port}` }), 401, 'no custom header: a web page cannot add one')
  assert.equal(await raw(port, '/api/settings', { ...ok, host: 'evil.example:80' }), 401, 'a name that is not local (DNS tricks)')
  assert.equal(await raw(port, '/api/settings', { ...ok, origin: 'https://evil.example' }), 401, 'another website')
  assert.equal(await raw(port, '/api/settings', { ...ok, origin: `http://127.0.0.1:${port}` }), 200, 'the page itself')
  assert.equal(await raw(port, '/api/settings', { ...ok, host: `localhost:${port}` }), 200)
})

test('with a PIN set, the local page asks for it too', async (t) => {
  const { local } = await localServer(t, { withPin: true })
  const noPin = await local('/api/settings')
  assert.equal(noPin.status, 401)
  assert.equal((await noPin.json()).code, 'pin')
  assert.equal((await local('/api/unlock', { pin: '0000' })).status, 401)
  const { token } = await (await local('/api/unlock', { pin: '8426' })).json()
  assert.equal((await local('/api/settings', {}, { 'x-unlock': token })).status, 200)
})

test('adding a phone shows its link, from the PC itself or from a paired phone, never for an unknown caller', async (t) => {
  const { local, key, port } = await localServer(t)
  const r = await (await local('/api/local/pair')).json()
  assert.equal(r.label, 'Phone 2')
  assert.ok(r.url.includes('?k=') && r.svg.startsWith('<svg'))
  const viaPhone = await fetch(`http://127.0.0.1:${port}/api/local/pair`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-rsp-local': '1' } })
  assert.equal(viaPhone.status, 200)
  const nobody = await fetch(`http://127.0.0.1:${port}/api/local/pair`, { method: 'POST', headers: { authorization: 'Bearer wrong-key' } })
  assert.equal(nobody.status, 401)
})

test('custom apps: add, list, replace, remove, with checks', async (t) => {
  const { local, dir } = await localServer(t)
  const call = async (body) => (await local('/api/settings/apps', body)).json()
  assert.deepEqual((await call({ op: 'list' })).apps, [])
  assert.deepEqual((await call({ op: 'add', label: 'VS Code', match: 'Visual Studio Code' })).apps, [{ label: 'VS Code', match: 'Visual Studio Code' }])
  await call({ op: 'add', label: 'Notes', match: 'Notepad' })
  assert.equal((await call({ op: 'add', label: 'vs code', match: 'VSCodium' })).apps.length, 2, 'the same name replaces the old one')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'apps.json'), 'utf8')), { Notes: 'Notepad', 'vs code': 'VSCodium' })
  assert.deepEqual((await call({ op: 'remove', label: 'NOTES' })).apps, [{ label: 'vs code', match: 'VSCodium' }])
  for (const bad of [{ op: 'add', label: '', match: 'x' }, { op: 'add', label: 'x', match: '' }, { op: 'add', label: 'a'.repeat(31), match: 'x' }, { op: 'add', label: 'x', match: 'y'.repeat(61) }, { op: 'add', label: 'a\u0001', match: 'x' }, { op: 'nope' }]) {
    const r = await local('/api/settings/apps', bad)
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
})

test('restart from the Settings page asks the program to restart', async (t) => {
  const { local, calls } = await localServer(t)
  assert.equal((await local('/api/settings/restart')).status, 200)
  assert.deepEqual(calls, ['restart_remote'])
})

test('openTool opens only the three fixed tools, on Windows', async () => {
  const runs = []
  const s = createSettings({ file: '/x/config.json', config: { allow: [] }, pin: { isSet: () => false }, run: async (...a) => runs.push(a), platform: 'win32', appDir: 'C:\\app' })
  assert.match(await s.openTool('fixit'), /Fix-It/)
  assert.deepEqual(runs[0].slice(0, 1), ['cmd.exe']); assert.match(runs[0][1][3], /Fix-It\.cmd$/)
  await assert.rejects(() => s.openTool('format-disk'), /Unknown/)
  const linux = createSettings({ file: '/x/config.json', config: { allow: [] }, pin: { isSet: () => false }, run: async () => {}, platform: 'linux', appDir: '/app' })
  await assert.rejects(() => linux.openTool('update'), /Windows/)
})

test('startApps lists Start menu names, sorted, without helper entries (Windows only)', async () => {
  const mk = (platform) => createSettings({ file: '/x/config.json', config: { allow: [] }, pin: { isSet: () => false }, run: async () => 'Zoom\r\nOBS Studio\r\nOBS Studio\r\nUninstall OBS\r\nDiscord\r\n', platform })
  assert.deepEqual(await mk('win32').startApps(), ['Discord', 'OBS Studio', 'Zoom'])
  await assert.rejects(() => mk('linux').startApps(), /Windows/)
})

test('a paired phone can add and remove apps, but an unknown caller cannot', async (t) => {
  const { port, key } = await localServer(t)
  const call = (body, k = key) => fetch(`http://127.0.0.1:${port}/api/settings/apps`, { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: JSON.stringify(body) })
  assert.equal((await call({ op: 'add', label: 'Notes', match: 'Notepad' })).status, 200)
  assert.equal((await (await call({ op: 'list' })).json()).apps.length, 1)
  assert.equal((await call({ op: 'remove', label: 'Notes' })).status, 200)
  assert.equal((await call({ op: 'add', label: 'Bank', match: 'Bank App' }, 'wrong-key')).status, 401)
})

test('the home-screen icon takes the colour of the PC theme (name, accent or setting)', async (t) => {
  assert.equal(iconTheme({}, 'ROG-STRIX'), 'neon')
  assert.equal(iconTheme({}, 'TUF-GAMING'), 'tactical')
  assert.equal(iconTheme({ name: 'Ally' }, 'DESKTOP-1'), 'clean')
  assert.equal(iconTheme({ theme: 'tactical', name: 'ROG' }, 'x'), 'tactical', 'the theme setting wins')
  assert.equal(iconTheme({ accent: 'pink' }, 'x'), 'neon')
  const dir = tempDir(t)
  const get = async (config, path) => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', auth: createAuth({ file: join(dir, 'p.json') }), pin: createPin({ file: join(dir, 'pin.json') }), config, webDir })
    try {
      const r = await fetch(`http://127.0.0.1:${srv.port}${path}`)
      return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) }
    } finally {
      await srv.close()
    }
  }
  const svg = await get(normalizeConfig({ theme: 'tactical' }), '/icon.svg')
  assert.match(svg.body.toString(), /#ffa927/)
  const pink = await get(normalizeConfig({ theme: 'neon' }), '/icon-192.png')
  const blue = await get(normalizeConfig({ theme: 'clean' }), '/icon-192.png')
  assert.deepEqual([pink.status, pink.type], [200, 'image/png'])
  assert.notDeepEqual(pink.body, blue.body, 'different colours for different themes')
  // The page names the icon with the theme in the address, so a phone never keeps an old picture of another colour.
  const page = await get(normalizeConfig({ theme: 'neon' }), '/')
  assert.match(page.body.toString(), /apple-touch-icon-neon\.png/)
  assert.ok(!page.body.toString().includes('{{ICON}}'))
  const themed = await get(normalizeConfig({ theme: 'clean' }), '/apple-touch-icon-tactical.png')
  assert.deepEqual([themed.status, themed.type], [200, 'image/png'])
  assert.equal(shortcutName({}, 'ROG-STRIX'), 'ROG-STRIX')
  assert.equal(shortcutName({ name: 'My <b>Ally</b>' }, 'x'), 'My bAllyb')
  assert.equal(shortcutName({}, ''), 'Remote PC')
  const named = await get(normalizeConfig({ name: 'TUF' }), '/')
  assert.match(named.body.toString(), /<title>TUF<\/title>/)
  assert.match(named.body.toString(), /apple-mobile-web-app-title" content="TUF"/)
  const manifest = await get(normalizeConfig({ theme: 'tactical', name: 'TUF' }), '/manifest.webmanifest')
  assert.match(manifest.body.toString(), /"name":"TUF"/)
  assert.match(manifest.body.toString(), /icon-192-tactical\.png/)
})

test('diagnostics: a paired phone gets the Fix-It report, an unknown caller does not', async (t) => {
  const dir = tempDir(t)
  const auth = createAuth({ file: join(dir, 'p.json') })
  const { key } = auth.add('Phone')
  const srv = await startServer({
    port: 0, host: '127.0.0.1', auth, pin: createPin({ file: join(dir, 'pin.json') }), config: normalizeConfig({}), webDir,
    diagnostics: async () => ({ lines: ['[ OK ] Windows: Windows', '[ !! ] ASUS performance mode: x'], problems: 0 }),
  })
  t.after(() => srv.close())
  const post = (k) => fetch(`http://127.0.0.1:${srv.port}/api/diagnostics`, { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: '{}' })
  const ok = await post(key)
  assert.equal(ok.status, 200)
  assert.deepEqual((await ok.json()).lines.length, 2)
  assert.equal((await post('wrong-key')).status, 401)
  assert.equal((await post('')).status, 401)
})

test('the coffee button: only a payment page on a known host is passed to the page', () => {
  assert.equal(safeCoffeeUrl('https://buy.stripe.com/abc123XYZ'), 'https://buy.stripe.com/abc123XYZ')
  assert.equal(safeCoffeeUrl('https://ko-fi.com/someone'), 'https://ko-fi.com/someone')
  assert.equal(safeCoffeeUrl('https://www.buymeacoffee.com/someone'), 'https://www.buymeacoffee.com/someone')
  for (const bad of ['', undefined, 'http://buy.stripe.com/x', 'https://evil.example/x', 'javascript:alert(1)', 'https://buy.stripe.com/x?a=b', 'https://buy.stripe.com.evil.com/x']) assert.equal(safeCoffeeUrl(bad), '', String(bad))
})

test('speed: page files are sent compressed with an ETag, and an unchanged file costs only a 304', async (t) => {
  const dir = tempDir(t)
  const srv = await startServer({ port: 0, host: '127.0.0.1', auth: createAuth({ file: join(dir, 'p.json') }), pin: createPin({ file: join(dir, 'pin.json') }), config: normalizeConfig({}), webDir })
  t.after(() => srv.close())
  const base = `http://127.0.0.1:${srv.port}`
  for (const path of ['/', '/app.js', '/app.css', '/common.js']) {
    const plain = await fetch(base + path, { headers: { 'accept-encoding': 'identity' } })
    const raw = Buffer.from(await plain.arrayBuffer())
    assert.equal(plain.status, 200, path)
    const etag = plain.headers.get('etag')
    assert.ok(etag, path)
    assert.equal(plain.headers.get('content-encoding'), null)
    const gz = await fetch(base + path, { headers: { 'accept-encoding': 'gzip' } })
    assert.equal(gz.headers.get('content-encoding'), 'gzip', path)
    assert.equal(gz.headers.get('etag'), etag, 'the same ETag compressed or not')
    assert.deepEqual(Buffer.from(await gz.arrayBuffer()), raw, 'fetch unzips it to the same bytes')
    const again = await fetch(base + path, { headers: { 'if-none-match': etag } })
    assert.equal(again.status, 304, path)
    assert.equal((await again.arrayBuffer()).byteLength, 0)
  }
})

test('speed: other PCs that cannot be started are not probed on every page load', async (t) => {
  const dir = tempDir(t)
  const auth = createAuth({ file: join(dir, 'p.json') })
  const { key } = auth.add('Phone')
  let probes = 0
  const srv = await startServer({
    port: 0, host: '127.0.0.1', auth, pin: createPin({ file: join(dir, 'pin.json') }), config: normalizeConfig({}), webDir,
    others: () => ({ tuf: { label: 'TUF', page: 'http://100.1.2.3:8791' }, desk: { label: 'Desk', page: 'http://100.1.2.4:8791', mac: 'AA:BB:CC:DD:EE:FF' } }),
    probe: async () => (probes++, true),
  })
  t.after(() => srv.close())
  const state = () => fetch(`http://127.0.0.1:${srv.port}/api/state`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())
  const first = await state()
  await state()
  await state()
  assert.equal(probes, 1, 'only the PC that can be started is probed, and the answer is kept for a while')
  assert.equal(first.others.find((o) => o.key === 'tuf').online, null)
  assert.equal(first.others.find((o) => o.key === 'desk').online, true)
})

test('the Windows list: a paired phone gets it, an unknown caller does not', async (t) => {
  const dir = tempDir(t)
  const auth = createAuth({ file: join(dir, 'p.json') })
  const { key } = auth.add('Phone')
  const srv = await startServer({
    port: 0, host: '127.0.0.1', auth, pin: createPin({ file: join(dir, 'pin.json') }), config: normalizeConfig({}), webDir,
    actions: { info: async () => ({ name: 'PC' }), run: async () => 'ok', windows: async () => [{ id: '1', name: 'chrome', title: 'YouTube', minimized: false }], avatar: async () => null, gameArt: async () => null },
  })
  t.after(() => srv.close())
  const post = (k) => fetch(`http://127.0.0.1:${srv.port}/api/windows`, { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: '{}' })
  const ok = await post(key)
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).windows[0].title, 'YouTube')
  assert.equal((await post('wrong-key')).status, 401)
  assert.equal((await post('')).status, 401)
})
