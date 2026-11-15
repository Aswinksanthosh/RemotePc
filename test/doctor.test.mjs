import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createAuth } from '../src/auth.mjs'
import { saveConfig } from '../src/config.mjs'
import { runDoctor } from '../src/doctor.mjs'
import { dataPaths } from '../src/paths.mjs'
import { describeWol, parseWol } from '../src/wol.mjs'
import { tempDir } from './helpers.mjs'

const IFACES = { Tailscale: [{ family: 'IPv4', address: '100.101.102.103', internal: false }] }
const health = { ok: true, json: async () => ({ app: 'remortstartpc' }) }
const level = (r, name) => r.results.find((x) => x.name === name)?.level

test('Fix-It on a healthy PC finds nothing wrong', async (t) => {
  const paths = dataPaths(tempDir(t))
  saveConfig(paths.config, {})
  createAuth({ file: paths.phones }).add('Phone 1')
  const run = async (f, a) => {
    if (f === 'schtasks.exe') return 'ok'
    if (f === 'netsh.exe') return 'Rule Name: RemortStartPc'
    if (f === 'powershell.exe') return 'ok\n'
    if (f.includes('ailscale')) return JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.101.102.103'] } })
    if (f === 'reg.exe') return `SteamPath REG_SZ ${paths.home}`
    return ''
  }
  const r = await runDoctor({ paths, run, fetchFn: async () => health, exists: () => true, platform: 'win32', interfaces: IFACES, nodeVersion: '22.1.0', env: {} })
  assert.equal(r.problems, 0, JSON.stringify(r.results.filter((x) => x.level === 'bad')))
  assert.equal(r.up, true)
  assert.equal(level(r, 'Paired phones'), 'ok')
})

test('Fix-It explains each problem in plain words', async (t) => {
  const paths = dataPaths(tempDir(t))
  const run = async (f) => {
    throw new Error('nothing works: ' + f)
  }
  const r = await runDoctor({ paths, run, fetchFn: async () => { throw new Error('refused') }, exists: () => false, platform: 'win32', interfaces: {}, nodeVersion: '18.0.0', env: {} })
  for (const name of ['Node.js', 'Program files', 'Remote running', 'Windows Firewall', 'PowerShell', 'Tailscale', 'Network address']) assert.equal(level(r, name), 'bad', name)
  assert.equal(level(r, 'Starts at sign-in'), 'warn')
  assert.equal(level(r, 'Paired phones'), 'warn')
  assert.equal(r.up, false)
  for (const x of r.results.filter((x) => x.level !== 'ok')) assert.ok(x.fix || x.name === 'Steam' || x.name === 'Windows', `${x.name} has advice`)
})

test('Fix-It shows the end of the log when the remote is down', async (t) => {
  const paths = dataPaths(tempDir(t))
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const r = await runDoctor({ paths, run: async () => '', fetchFn: async () => { throw new Error('x') }, exists: () => true, platform: 'linux', interfaces: {}, readText: () => lines })
  assert.equal(r.log.split('\n').length, 10)
  assert.ok(r.log.endsWith('line 29'))
})

test('Wake-on-LAN: the script output becomes plain advice', () => {
  const parsed = parseWol('noise\n' + JSON.stringify({ adapters: [{ name: 'Ethernet', media: '802.3', mac: 'aa-bb-cc-dd-ee-ff', up: true, wol: true }, { name: 'Wi-Fi', media: 'Native 802.11', mac: '11-22-33-44-55-66', up: true, wol: true }], fastStartup: 'off' }))
  assert.deepEqual(parsed.adapters.map((a) => [a.kind, a.mac]), [['cable', 'AA:BB:CC:DD:EE:FF'], ['wifi', '11:22:33:44:55:66']])
  const text = describeWol(parsed, { ip: '100.1.2.3', port: 8791, hostname: 'BIG-PC' }).join('\n')
  assert.match(text, /Fast startup is off/)
  assert.match(text, /AA:BB:CC:DD:EE:FF/)
  assert.match(text, /add-pc\.mjs" "BIG-PC" AA:BB:CC:DD:EE:FF http:\/\/100\.1\.2\.3:8791/)
  assert.match(text, /BIOS/)
})

test('Wake-on-LAN: a PC on Wi-Fi only is told the truth', () => {
  const parsed = parseWol(JSON.stringify({ adapters: { name: 'Wi-Fi', media: 'Native 802.11', mac: '11-22-33-44-55-66', up: true, wol: true }, fastStartup: 'unchanged' }))
  const text = describeWol(parsed).join('\n')
  assert.match(text, /no network cable adapter/)
  assert.match(text, /almost never wakes up from OFF/)
  assert.match(text, /Fast startup could not be turned off/)
})
