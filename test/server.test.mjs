import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuth } from '../src/auth.mjs'
import { startServer } from '../src/server.mjs'
import { tempDir } from './helpers.mjs'

const webDir = fileURLToPath(new URL('../src/web', import.meta.url))

async function lab(t, opts = {}) {
  const auth = createAuth({ file: join(tempDir(t), 'phones.json') })
  const { key, id } = auth.add('Test phone')
  const done = []
  const woke = []
  const actions = {
    info: async () => ({ name: 'PC1', model: 'ROG', games: ['Hades'], apps: [], buttons: [] }),
    run: async (a, arg) => {
      done.push([a, arg])
      if (a === 'boom') throw new Error('x')
      return `did ${a}`
    },
    avatar: async () => ({ type: 'image/png', bytes: Buffer.from('PNG') }),
    gameArt: async (g) => (g === 'Hades' ? { type: 'image/jpeg', bytes: Buffer.from('JPG') } : null),
  }
  const srv = await startServer({
    port: 0,
    host: '127.0.0.1',
    auth,
    actions,
    config: { accent: '', name: '' },
    others: () => ({ desk: { label: 'Desk', mac: 'AA:BB:CC:DD:EE:FF', broadcast: '255.255.255.255', page: 'http://100.1.2.3:8791' }, nomac: { label: 'No mac', mac: '', page: '' } }),
    wake: async (pc) => woke.push(pc.label),
    probe: async () => true,
    webDir,
    version: '9.9',
    ...opts,
  })
  t.after(() => srv.close())
  const base = `http://127.0.0.1:${srv.port}`
  const post = (path, body = {}, k = key) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: JSON.stringify(body) })
  return { base, key, id, post, done, woke, auth }
}

test('the page and its files are served with a strict policy', async (t) => {
  const { base } = await lab(t)
  const res = await fetch(base + '/')
  assert.equal(res.status, 200)
  const csp = res.headers.get('content-security-policy')
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /script-src 'self'/)
  assert.ok(!/unsafe/.test(csp))
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
  for (const p of ['/app.js', '/app.css', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png']) assert.equal((await fetch(base + p)).status, 200, p)
  assert.equal((await fetch(base + '/server.mjs')).status, 404)
  assert.equal((await fetch(base + '/../package.json')).status, 404)
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true, app: 'remortstartpc', version: '9.9' })
})

test('the API needs a paired phone', async (t) => {
  const { post, key } = await lab(t)
  // (Wrong tries are counted, so this stays under the lockout limit.)
  for (const path of ['/api/state', '/api/do', '/api/avatar', '/api/gameart']) assert.equal((await post(path, {}, '')).status, 401, path)
  assert.equal((await post('/api/state', {}, 'not-the-key')).status, 401)
  assert.equal((await post('/api/state', {}, key)).status, 200)
})

test('a key in the address or in a cookie is not accepted for the API', async (t) => {
  const { base, key } = await lab(t)
  assert.equal((await fetch(`${base}/api/state?k=${key}`, { method: 'POST' })).status, 401)
  assert.equal((await fetch(base + '/api/state', { method: 'POST', headers: { cookie: `k=${key}` } })).status, 401)
  assert.equal((await fetch(base + '/api/state', { method: 'GET', headers: { authorization: `Bearer ${key}` } })).status, 404)
})

test('state has this PC, the other PCs and the paired phones', async (t) => {
  const { post, id } = await lab(t)
  const s = await (await post('/api/state')).json()
  assert.equal(s.pc.name, 'PC1')
  assert.equal(s.pc.control, true)
  assert.deepEqual(s.others.map((o) => [o.key, o.canWake, o.online]), [['desk', true, true], ['nomac', false, null]])
  assert.deepEqual(s.phones, [{ id, label: 'Test phone', current: true }])
  assert.equal(s.version, '9.9')
})

test('settings name and accent override what the PC reports', async (t) => {
  const { post } = await lab(t, { config: { name: 'Desk PC', accent: 'green' } })
  const s = await (await post('/api/state')).json()
  assert.equal(s.pc.name, 'Desk PC')
  assert.equal(s.pc.accent, 'green')
})

test('buttons run only known actions, and errors are reported plainly', async (t) => {
  const { post, done } = await lab(t)
  assert.deepEqual(await (await post('/api/do', { action: 'lock' })).json(), { message: 'did lock' })
  assert.equal((await post('/api/do', { action: 'steam_game', arg: 'Hades' })).status, 200)
  assert.deepEqual(done, [['lock', undefined], ['steam_game', 'Hades']])
  for (const action of ['rm_rf', 'run', '', 'wake_all', undefined]) {
    const r = await post('/api/do', { action })
    assert.equal(r.status, 400, String(action))
  }
  assert.equal(done.length, 2)
})

test('wake starts only the PCs in pcs.json', async (t) => {
  const { post, woke } = await lab(t)
  assert.equal((await post('/api/do', { action: 'wake', pc: 'desk' })).status, 200)
  assert.deepEqual(woke, ['Desk'])
  assert.equal((await post('/api/do', { action: 'wake', pc: 'nomac' })).status, 400)
  assert.equal((await post('/api/do', { action: 'wake', pc: 'AA:BB:CC:DD:EE:FF' })).status, 400)
  assert.equal((await post('/api/do', { action: 'wake' })).status, 400)
  assert.deepEqual(woke, ['Desk'])
})

test('a phone can be forgotten from the page', async (t) => {
  const { post, auth, id, key } = await lab(t)
  assert.equal((await post('/api/do', { action: 'forget_phone', arg: id })).status, 200)
  assert.equal(auth.list().length, 0)
  assert.equal((await post('/api/state', {}, key)).status, 401)
})

test('pictures come back only for known names; no picture is a quiet 204', async (t) => {
  const { post } = await lab(t)
  const art = await post('/api/gameart', { game: 'Hades' })
  assert.equal(art.status, 200)
  assert.equal(art.headers.get('content-type'), 'image/jpeg')
  assert.equal(art.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await post('/api/gameart', { game: 'Unknown' })).status, 204)
  assert.equal((await post('/api/avatar')).headers.get('content-type'), 'image/png')
})

test('the manifest keeps the key for the home-screen shortcut, but only for a real key', async (t) => {
  const { base, key } = await lab(t)
  const good = await (await fetch(`${base}/manifest.webmanifest?k=${key}`)).json()
  assert.equal(good.start_url, `/?k=${key}`)
  assert.equal(good.display, 'standalone')
  const bad = await (await fetch(`${base}/manifest.webmanifest?k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).json()
  assert.equal(bad.start_url, '/')
  const injected = await (await fetch(`${base}/manifest.webmanifest?k=${encodeURIComponent('"}<script>')}`)).json()
  assert.equal(injected.start_url, '/')
})

test('networks that are not allowed are turned away, even with a valid key', async (t) => {
  const { base, key } = await lab(t, { allow: ['tailscale'] })
  assert.equal((await fetch(base + '/')).status, 403)
  const r = await fetch(base + '/api/state', { method: 'POST', headers: { authorization: `Bearer ${key}` } })
  assert.equal(r.status, 403)
})

test('big or broken requests are refused', async (t) => {
  const { base, key } = await lab(t)
  const h = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  assert.equal((await fetch(base + '/api/do', { method: 'POST', headers: h, body: '{not json' })).status, 400)
  assert.equal((await fetch(base + '/api/do', { method: 'POST', headers: h, body: JSON.stringify({ action: 'lock', pad: 'x'.repeat(5000) }) }).catch(() => ({ status: 413 }))).status, 413)
})

test('a helper (no actions) only starts other PCs', async (t) => {
  const { post, woke } = await lab(t, { actions: null })
  const s = await (await post('/api/state')).json()
  assert.equal(s.pc.control, false)
  assert.equal((await post('/api/do', { action: 'lock' })).status, 400)
  assert.equal((await post('/api/do', { action: 'wake', pc: 'desk' })).status, 200)
  assert.deepEqual(woke, ['Desk'])
  assert.equal((await post('/api/avatar')).status, 204)
})
