import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAuth } from '../src/auth.mjs'
import { saveConfig } from '../src/config.mjs'
import { readVersion, startApp } from '../src/app.mjs'
import { dataPaths } from '../src/paths.mjs'
import { tempDir } from './helpers.mjs'

test('the program starts from a fresh folder, and a helper (not Windows) only starts other PCs', async (t) => {
  const home = tempDir(t)
  const paths = dataPaths(home)
  saveConfig(paths.config, { port: 18791 })
  const { key } = createAuth({ file: paths.phones }).add('Phone')
  writeFileSyncJson(join(home, 'pcs.json'), { Desk: { mac: 'AA:BB:CC:DD:EE:FF' } })
  const app = await startApp({ home, platform: 'linux', host: '127.0.0.1', log: () => {} })
  t.after(() => app.close())
  const base = `http://127.0.0.1:${app.server.port}`
  assert.equal(app.server.port, 18791)
  assert.equal((await (await fetch(base + '/health')).json()).app, 'remortstartpc')
  const state = await (await fetch(base + '/api/state', { method: 'POST', headers: { authorization: `Bearer ${key}` } })).json()
  assert.equal(state.pc.control, false)
  assert.equal(state.others[0].name, 'Desk')
})

test('on Windows the PC is controllable', async (t) => {
  const home = tempDir(t)
  const paths = dataPaths(home)
  const { key } = createAuth({ file: paths.phones }).add('Phone')
  const app = await startApp({ home, platform: 'win32', port: 0, host: '127.0.0.1', log: () => {} })
  t.after(() => app.close())
  const base = `http://127.0.0.1:${app.server.port}`
  const state = await (await fetch(base + '/api/state', { method: 'POST', headers: { authorization: `Bearer ${key}` } })).json()
  assert.equal(state.pc.control, true)
})

test('the version shows the number and the short commit that was installed', (t) => {
  const dir = tempDir(t)
  const installed = join(dir, 'installed.json')
  assert.match(readVersion(undefined, installed), /^\d+\.\d+\.\d+$/)
  writeFileSyncJson(installed, { sha: 'abcdef0123456789' })
  assert.match(readVersion(undefined, installed), /^\d+\.\d+\.\d+ \(abcdef0\)$/)
  assert.equal(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).name, 'remortstartpc')
})

import { writeFileSync } from 'node:fs'
function writeFileSyncJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj))
}
