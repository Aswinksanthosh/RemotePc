import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuth } from '../src/auth.mjs'
import { normalizeConfig } from '../src/config.mjs'
import { createPin } from '../src/pin.mjs'
import { createSettings } from '../src/settings.mjs'
import { startServer } from '../src/server.mjs'
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

test('startup: a power mode and Steam Big Picture are done once per boot, not at every program restart', async (t) => {
  const calls = []
  const b = boot(t, normalizeConfig({ steamAtStart: true, steamDelay: 4, startMode: 'saver' }), calls)
  assert.deepEqual(await b.go(), { mode: 'set', steam: 'started' })
  assert.deepEqual(calls, ['mode_saver', 'steam_bigpicture'])
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
