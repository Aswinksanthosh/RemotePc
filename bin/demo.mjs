#!/usr/bin/env node
// A pretend PC, to look at the phone page on any computer (no Windows, nothing is really done).
//   node bin/demo.mjs            then open the address it prints
// Used by the tests and to make the screenshots in docs/img.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuth } from '../src/auth.mjs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPin } from '../src/pin.mjs'
import { startServer } from '../src/server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'rsp-demo-'))
const auth = createAuth({ file: join(home, 'phones.json') })
const { key } = auth.add('Demo phone')
const port = Number(process.argv[2]) || 8799

const info = {
  name: process.env.DEMO_NAME ?? 'ROG',
  model: process.env.DEMO_MODEL ?? 'ROG Strix G16',
  version: '0.1.0',
  games: ['Counter-Strike 2', 'Hades', 'Portal 2', 'PUBG: BATTLEGROUNDS'],
  gameArt: [],
  buttons: ['my tests', 'open code'],
  headphones: ['OnePlus Buds Pro', 'AirPods Pro'],
  outputs: ['Speakers (Realtek Audio)', 'OnePlus Buds Pro Stereo', 'Monitor (HDMI)'],
  apps: ['Discord', 'Spotify', 'Chrome', 'Epic Games', 'OBS Studio', 'Claude'],
  steam: { user: 'DemoPlayer', playing: '', id: '76561198000000001', avatar: false, accounts: [{ id: '76561198000000001', name: 'DemoPlayer' }, { id: '76561198000000002', name: 'Second Account' }] },
}
const actions = {
  info: async () => info,
  run: async (action, arg) => `Demo: ${action}${arg ? ` (${arg})` : ''}. Nothing was really done.`,
  avatar: async () => null,
  gameArt: async () => null,
}
const pin = createPin({ file: join(home, 'pin.json') })
if (process.env.DEMO_PIN) pin.set(process.env.DEMO_PIN)
await startServer({
  port,
  pin,
  allow: ['loopback', 'tailscale', 'lan'],
  auth,
  actions,
  config: { accent: process.env.DEMO_ACCENT ?? '' },
  others: () => (process.env.DEMO_ONE_PC ? {} : { tuf: { label: 'TUF', mac: 'AA:BB:CC:DD:EE:FF', page: 'http://127.0.0.1:1' } }),
  wake: async () => {},
  probe: async () => false,
  webDir: join(here, '..', 'src', 'web'),
  version: '0.1.0',
})
console.log(`Demo running. Open: http://127.0.0.1:${port}/?k=${key}`)
