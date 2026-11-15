import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, saveConfig } from '../src/config.mjs'
import { dataPaths } from '../src/paths.mjs'
import { cleanupPairingPages, newPairing, pairingPage, runSetup, setupTailscale, showPairingOnScreen, syncApp, waitForHealth } from '../src/setup.mjs'
import { createUi } from '../src/ui.mjs'
import { configureFirewall, findTailscale, firewallArgs, launcherScript, loginTailscale, psArgs, registerTaskScript, shortcutsScript, stopRemoteScript, tailscaleStatus } from '../src/windows.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const decode = (args) => Buffer.from(args.at(-1), 'base64').toString('utf16le')
const IFACES = { Tailscale: [{ family: 'IPv4', address: '100.101.102.103', internal: false }], 'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }
const WIFI_ONLY = { 'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }

function capture() {
  const out = []
  const logged = []
  return { ui: createUi({ write: (s) => out.push(s), log: (s) => logged.push(s) }), out, logged }
}

test('the launcher restarts after an update, waits after a crash, stops for good on exit 0', () => {
  const s = launcherScript({ nodePath: "C:\\Program Files\\nodejs\\node.exe", entry: "C:\\Users\\me\\it's here\\app\\bin\\remote.mjs", home: "C:\\Users\\me\\it's here" })
  assert.ok(s.includes("$entry = 'C:\\Users\\me\\it''s here\\app\\bin\\remote.mjs'"), 'a quote in a path cannot break out')
  assert.match(s, /if \(\$code -eq 0\) \{ break \}/)
  assert.match(s, /if \(\$code -ne 75\) \{ Start-Sleep -Seconds 5 \}/)
  assert.match(s, /while \(\$true\)/)
})

test('the firewall rule only allows the networks the settings allow', () => {
  const rule = (allow) => firewallArgs({ port: 8791, allow }).find((a) => a.startsWith('remoteip='))
  assert.equal(rule(['loopback', 'tailscale']), 'remoteip=100.64.0.0/10,127.0.0.1')
  assert.equal(rule(['loopback', 'tailscale', 'lan']), 'remoteip=LocalSubnet,100.64.0.0/10,127.0.0.1')
  assert.equal(rule(['loopback']), 'remoteip=127.0.0.1')
  assert.ok(firewallArgs({ port: 9000, allow: ['loopback'] }).includes('localport=9000'))
})

test('configureFirewall removes the old rule first, and a missing old rule is fine', async () => {
  const calls = []
  await configureFirewall({ run: async (f, a) => { calls.push(a[2]); if (a[2] === 'delete') throw new Error('no rule') }, config: { port: 8791, allow: ['loopback', 'tailscale'] } })
  assert.deepEqual(calls, ['delete', 'add'])
})

test('the Windows scripts name the right things', () => {
  assert.match(registerTaskScript('C:\\x\\start.ps1'), /\$name = 'RemortStartPc'/)
  assert.match(registerTaskScript('C:\\x\\start.ps1'), /-LogonType Interactive -RunLevel Limited/)
  assert.match(registerTaskScript('C:\\x\\start.ps1'), /-WindowStyle Hidden -File/)
  assert.match(stopRemoteScript, /remortstartpc\.\*remote\\\.mjs/)
  assert.match(shortcutsScript('C:\\a'), /'Pair-Phone', 'Fix-It', 'Update', 'Uninstall', 'Wake-on-LAN-Setup'/)
  const args = psArgs('Write-Output 1')
  assert.deepEqual(args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'])
  assert.equal(decode(args), 'Write-Output 1')
})

test('Tailscale status is read from its json', async () => {
  const run = async () => JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.1.2.3', 'fd7a::1'] } })
  assert.deepEqual(await tailscaleStatus({ run, exe: 'x' }), { state: 'Running', ip: '100.1.2.3' })
  assert.deepEqual(await tailscaleStatus({ run: async () => { throw new Error('x') }, exe: 'x' }), { state: 'unknown', ip: '' })
  assert.deepEqual(await tailscaleStatus({ run: async () => 'not json', exe: 'x' }), { state: 'unknown', ip: '' })
  assert.equal(findTailscale((p) => p.includes('Program Files\\Tailscale'), { ProgramFiles: 'C:\\Program Files' }), 'C:\\Program Files\\Tailscale\\tailscale.exe')
  assert.equal(findTailscale(() => false), '')
})

// A pause that lets other queued work (like a child process printing) run, as a real pause would.
const tick = () => new Promise((r) => setImmediate(r))

function fakeChild() {
  const c = new EventEmitter()
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  c.kill = () => (c.killed = true)
  return c
}

test('signing in to Tailscale opens only the sign-in page it printed, and waits until it is connected', async () => {
  const { ui } = capture()
  const child = fakeChild()
  const opened = []
  let polls = 0
  const run = async () => JSON.stringify({ BackendState: ++polls < 3 ? 'NeedsLogin' : 'Running', Self: { TailscaleIPs: ['100.1.1.1'] } })
  const ok = await loginTailscale({
    spawnFn: () => {
      setImmediate(() => child.stdout.emit('data', 'To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123XYZ\n'))
      return child
    },
    run, exe: 'ts', open: (u) => opened.push(u), ui, sleep: tick, pollMs: 0,
  })
  assert.equal(ok, true)
  assert.deepEqual(opened, ['https://login.tailscale.com/a/abc123XYZ'])
  assert.equal(child.killed, true)
})

test('a printed address that is not the Tailscale sign-in page is never opened', async () => {
  const { ui } = capture()
  const child = fakeChild()
  const opened = []
  await loginTailscale({
    spawnFn: () => {
      setImmediate(() => child.stdout.emit('data', 'visit https://evil.example/a/abc and https://login.tailscale.com.evil.example/a/x'))
      return child
    },
    run: async () => JSON.stringify({ BackendState: 'NeedsLogin' }), exe: 'ts', open: (u) => opened.push(u), ui, sleep: tick, timeoutMs: 50, pollMs: 0,
  })
  assert.deepEqual(opened, [], 'nothing was opened')
})

test('setupTailscale: already installed and connected', async () => {
  const { ui } = capture()
  const calls = []
  const r = await setupTailscale({ run: async (f, a) => { calls.push(a.join(' ')); return JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.9.9.9'] } }) }, spawnFn: () => assert.fail('no sign-in needed'), exists: () => true, ui, open() {}, sleep: async () => {}, env: {} })
  assert.deepEqual([r.ok, r.ip], [true, '100.9.9.9'])
  assert.ok(calls.includes('set --unattended'))
})

test('setupTailscale: installs through winget when missing, and reports when it cannot', async () => {
  const { ui } = capture()
  let installed = false
  const calls = []
  const run = async (f, a) => {
    calls.push([f, ...a])
    if (f === 'winget.exe') installed = true
    return JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.9.9.9'] } })
  }
  const ok = await setupTailscale({ run, spawnFn: () => assert.fail('x'), exists: () => installed, ui, open() {}, sleep: async () => {}, env: {} })
  assert.equal(ok.ok, true)
  assert.deepEqual(calls[0].slice(0, 5), ['winget.exe', 'install', '-e', '--id', 'Tailscale.Tailscale'])

  const cap = capture()
  const bad = await setupTailscale({ run: async () => { throw new Error('no winget') }, spawnFn: () => assert.fail('x'), exists: () => false, ui: cap.ui, open() {}, sleep: async () => {}, env: {}, downloadTo: async () => { throw new Error('offline') } })
  assert.equal(bad.ok, false)
  assert.ok(cap.out.join('').includes('https://tailscale.com/download/windows'))
})

test('setupTailscale can be skipped', async () => {
  const cap = capture()
  assert.equal((await setupTailscale({ skip: true, ui: cap.ui })).ok, false)
})

test('syncApp copies the program and leaves out git and node_modules', (t) => {
  const src = tempDir(t)
  const dest = join(tempDir(t), 'app')
  writeTree(src, { 'bin/a.mjs': 'a', 'package.json': '{}', '.git/config': 'x', 'node_modules/x/y.js': 'y', '.github/workflows/ci.yml': 'z' })
  writeTree(dest, { 'stale.txt': 'old' })
  assert.equal(syncApp(src, dest), true)
  assert.ok(existsSync(join(dest, 'bin', 'a.mjs')) && existsSync(join(dest, 'package.json')))
  assert.ok(!existsSync(join(dest, '.git')) && !existsSync(join(dest, 'node_modules')) && !existsSync(join(dest, 'stale.txt')))
  assert.equal(syncApp(dest, dest), false)
})

test('newPairing makes a link that works, numbers the phones, and explains when there is no address', (t) => {
  const paths = dataPaths(tempDir(t))
  const config = { port: 8791, allow: ['loopback', 'tailscale'] }
  const first = newPairing({ paths, config, interfaces: IFACES })
  assert.equal(first.label, 'Phone 1')
  assert.match(first.url, /^http:\/\/100\.101\.102\.103:8791\/\?k=[A-Za-z0-9_-]{32}$/)
  assert.equal(newPairing({ paths, config, interfaces: IFACES }).label, 'Phone 2')
  assert.equal(newPairing({ paths, config, interfaces: IFACES, label: 'Dad' }).label, 'Dad')
  assert.throws(() => newPairing({ paths, config, interfaces: WIFI_ONLY }), /Tailscale is not connected/)
  assert.match(newPairing({ paths, config: { ...config, allow: ['loopback', 'lan'] }, interfaces: WIFI_ONLY }).url, /^http:\/\/192\.168\.1\.20:8791\//)
  assert.throws(() => newPairing({ paths, config: { ...config, allow: ['loopback', 'lan'] }, interfaces: {} }), /no network address/)
})

test('the pairing page shows the QR and escapes text', () => {
  const html = pairingPage({ url: 'http://100.1.2.3:8791/?k=ABC', label: '<b>x</b>', tailscale: true })
  assert.ok(html.includes('<svg') && html.includes('http://100.1.2.3:8791/?k=ABC'))
  assert.ok(!html.includes('<b>x</b>') && html.includes('&lt;b&gt;'))
  assert.ok(html.includes('Install <b>Tailscale</b>'))
  assert.ok(!pairingPage({ url: 'http://192.168.1.2:8791/?k=A', label: 'x', tailscale: false }).includes('Install <b>Tailscale</b>'))
})

test('the pairing link is printed but never written to the log', async () => {
  const cap = capture()
  const written = []
  const removed = []
  const opened = []
  const pairing = { url: 'http://100.1.2.3:8791/?k=SECRETSECRETSECRETSECRET123456', id: 'abcd1234', label: 'Phone 1', tailscale: true }
  await showPairingOnScreen(pairing, { ui: cap.ui, tmp: '/tmp', writeFile: (f, t) => written.push([f, t]), open: (f) => opened.push(f), removeFile: (f) => removed.push(f), waitForKey: async () => {} })
  assert.ok(cap.out.join('').includes('SECRETSECRETSECRETSECRET123456'))
  assert.ok(!cap.logged.join('').includes('SECRETSECRET'), 'the log never sees the key')
  assert.deepEqual(opened, written.map((w) => w[0]))
  assert.deepEqual(removed, opened)
  assert.match(written[0][0], /remortstartpc-pair-abcd1234\.html$/)
})

test('leftover pairing pages are cleaned up, other files are not touched', () => {
  const removed = []
  const n = cleanupPairingPages('/t', { readdir: () => ['remortstartpc-pair-ab12.html', 'notes.html', 'remortstartpc-pair-zz.html'], remove: (f) => removed.push(f) })
  assert.equal(n, 1)
  assert.deepEqual(removed, [join('/t', 'remortstartpc-pair-ab12.html')])
})

test('waitForHealth gives up politely and succeeds when the program answers', async () => {
  let n = 0
  assert.equal(await waitForHealth({ port: 1, sleep: async () => {}, tries: 5, fetchFn: async () => ({ ok: ++n > 2, json: async () => ({ app: 'remortstartpc' }) }) }), true)
  assert.equal(await waitForHealth({ port: 1, sleep: async () => {}, tries: 3, fetchFn: async () => { throw new Error('refused') } }), false)
  assert.equal(await waitForHealth({ port: 1, sleep: async () => {}, tries: 2, fetchFn: async () => ({ ok: true, json: async () => ({ app: 'something else' }) }) }), false)
})

function setupLab(t, extra = {}) {
  const source = tempDir(t)
  writeTree(source, { 'bin/remote.mjs': '//', 'package.json': '{"name":"remortstartpc"}' })
  const paths = dataPaths(join(tempDir(t), 'home'))
  const cap = capture()
  const calls = []
  const run = async (f, a) => {
    calls.push([f, ...a])
    if (f === 'powershell.exe' && decode(a).includes('Register-ScheduledTask')) return 'task\n'
    if (/tailscale/i.test(f)) return JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.101.102.103'] } })
    return ''
  }
  const args = {
    source, paths, ui: cap.ui, run, spawnFn: () => assert.fail('no process should be spawned'), exists: () => true,
    fetchFn: async () => ({ ok: true, json: async () => ({ app: 'remortstartpc' }) }), open() {}, sleep: async () => {}, env: {},
    platform: 'win32', nodePath: 'C:\\node\\node.exe', interfaces: IFACES, ...extra,
  }
  return { args, paths, cap, calls }
}

test('the whole install on Windows: every step runs, the settings are right, nothing secret is logged', async (t) => {
  const shown = []
  const { args, paths, cap, calls } = setupLab(t, { showPairing: async (p) => shown.push(p) })
  const r = await runSetup(args)
  assert.equal(r.ok, true)
  assert.equal(r.tailscale, true)
  assert.match(r.url, /^http:\/\/100\.101\.102\.103:8791\/\?k=/)
  assert.deepEqual(loadConfig(paths.config).allow, ['loopback', 'tailscale'])
  assert.equal(loadConfig(paths.config).nodePath, 'C:\\node\\node.exe')
  assert.ok(existsSync(join(paths.app, 'bin', 'remote.mjs')))
  const launcher = readFileSync(paths.launcher, 'utf8')
  assert.ok(launcher.includes('C:\\node\\node.exe') && launcher.includes('remote.mjs'))
  const flat = calls.map((c) => (c[0] === 'powershell.exe' ? 'ps:' + decode(c) : c.join(' ')))
  assert.ok(flat.findIndex((c) => c.includes('Stop-Process')) < flat.findIndex((c) => c.includes('winget') || c.includes('status --json')), 'the old copy is stopped first')
  assert.ok(flat.some((c) => c.startsWith('netsh.exe advfirewall firewall add rule')))
  assert.ok(flat.some((c) => c.includes('Register-ScheduledTask')))
  assert.ok(flat.some((c) => c.includes('CreateShortcut')))
  assert.ok(flat.some((c) => c === 'schtasks.exe /run /tn RemortStartPc'))
  assert.ok(flat.some((c) => c.endsWith('set --unattended')))
  assert.equal(shown.length, 1)
  assert.ok(!cap.logged.join('\n').includes('?k='), 'no pairing key in the install log')
})

test('without Tailscale the home network is allowed so the phone can still connect', async (t) => {
  const { args, paths } = setupLab(t, { skipTailscale: true, interfaces: WIFI_ONLY, showPairing: async () => {} })
  const r = await runSetup(args)
  assert.equal(r.ok, true)
  assert.deepEqual(loadConfig(paths.config).allow, ['loopback', 'tailscale', 'lan'])
  assert.match(r.url, /^http:\/\/192\.168\.1\.20:8791\//)
})

test('running it again keeps your settings and your paired phones', async (t) => {
  const { args, paths } = setupLab(t, { showPairing: async () => {} })
  mkdirSync(paths.home, { recursive: true })
  saveConfig(paths.config, { port: 9123, accent: 'green', name: 'Desk', allow: ['loopback', 'lan'] })
  writeFileSync(paths.phones, '[]')
  await runSetup(args)
  const c = loadConfig(paths.config)
  assert.deepEqual([c.port, c.accent, c.name, c.allow], [9123, 'green', 'Desk', ['loopback', 'lan']])
})

test('a failing step is reported, the others still run, and the result says it was not finished', async (t) => {
  const cap = capture()
  const lab = setupLab(t, {
    ui: cap.ui,
    showPairing: async () => {},
    fetchFn: async () => { throw new Error('refused') },
    run: async (f, a) => {
      if (f === 'netsh.exe') throw new Error('Access is denied')
      if (f === 'powershell.exe' && decode(a).includes('Register-ScheduledTask')) throw new Error('denied')
      if (/tailscale/i.test(f)) return JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.1.1.1'] } })
      return ''
    },
    spawnFn: () => ({ unref() {} }),
  })
  lab.args.sleep = async () => {}
  const r = await runSetup(lab.args)
  const text = cap.out.join('')
  assert.equal(r.ok, false)
  assert.match(text, /Could not change the Windows Firewall/)
  assert.match(text, /Could not set up the automatic start/)
  assert.match(text, /\[FAIL\] The remote did not start/)
  assert.match(text, /Pairing your phone/)
})

test('on a system that is not Windows the Windows steps are skipped, not attempted', async (t) => {
  const { args, calls } = setupLab(t, { platform: 'linux', showPairing: async () => {} })
  const r = await runSetup(args)
  assert.equal(calls.length, 0)
  assert.equal(r.ok, true)
})
