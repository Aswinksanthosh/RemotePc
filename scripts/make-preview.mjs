#!/usr/bin/env node
// Builds ONE html file that shows the phone page with pretend data (no PC needed, nothing is sent anywhere).
//   node scripts/make-preview.mjs [folder]     writes RemotePc-preview.html and RemotePc-settings-preview.html (linked: the gear opens the second)
// Open the first file in any browser; on a computer, narrow the window or use the phone view of the browser's developer tools.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'web')
const read = (f) => readFileSync(join(web, f), 'utf8')
const outDir = process.argv[2] || '.'
mkdirSync(outDir, { recursive: true })

const base = {
  version: '0.1.0', control: true, battery: { percent: 78, onBattery: false }, btBattery: { 'OnePlus Buds Pro': 85 }, favorites: { bt: ['OnePlus Buds Pro'], out: ['Speakers (Realtek Audio)', 'OnePlus Buds Pro Stereo'] }, mode: 'balanced', timers: { screen: 10, sleep: 30 }, timerChoices: { screen: [1, 2, 3, 5, 10, 15, 20, 30, 60, 0], sleep: [5, 10, 15, 20, 30, 45, 60, 120, 0] }, volume: { level: 62, muted: false }, gameArt: [], buttons: ['my tests', 'open code'],
  headphones: ['OnePlus Buds Pro', 'AirPods Pro'], btConnected: ['OnePlus Buds Pro'], outputs: ['Speakers (Realtek Audio)', 'OnePlus Buds Pro Stereo', 'Monitor (HDMI)'],
  apps: ['Spotify'],
}
const pcs = {
  ROG: { ...base, name: 'ROG', model: 'ROG Strix G16', order: 2, games: ['Counter-Strike 2', 'Hades', 'Portal 2', 'PUBG: BATTLEGROUNDS'], steam: { user: 'DemoPlayer', playing: '', id: '1', avatar: false, accounts: [{ id: '1', name: 'DemoPlayer' }, { id: '2', name: 'Second Account' }] } },
  TUF: { ...base, name: 'TUF', model: 'TUF Gaming A15', order: 1, games: ['Elden Ring', 'Hollow Knight', 'Rocket League'], steam: { user: 'TufPlayer', playing: 'Elden Ring', id: '3', avatar: false, accounts: [] } },
}
const stub = `<script>
// PREVIEW ONLY: pretend answers instead of a real PC. Your two laptops are both inside this one file.
var previewPcs = ${JSON.stringify(pcs)}
var previewSelf = 'ROG'
var previewCustom = [{ label: 'Notes', match: 'Notepad' }]
window.previewDelay = window.previewDelay || 0
window.fetch = function (url, opts) {
  var body = {}
  try { body = JSON.parse((opts && opts.body) || '{}') } catch (e) {}
  var json = function (o) { return new Promise(function (ok) { setTimeout(function () { ok(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })) }, window.previewDelay) }) }
  if (String(url).indexOf('/api/state') >= 0) {
    var pc = JSON.parse(JSON.stringify(previewPcs[previewSelf]))
    var other = previewSelf === 'ROG' ? 'TUF' : 'ROG'
    return json({ pc: pc, version: '0.1.0', feedback: 'https://github.com/example/remotepc/issues/new', coffee: 'https://buy.stripe.com/example', phones: [{ id: 'a', label: 'My phone', current: true, connected: true, lastSeen: Date.now() }, { id: 'b', label: 'Partner phone', current: false, connected: true, lastSeen: Date.now() - 40000 }, { id: 'c', label: 'Old tablet', current: false, connected: false, lastSeen: Date.now() - 5 * 3600 * 1000 }],
      others: [] })
  }
  if (String(url).indexOf('/api/settings/startapps') >= 0) return json({ names: ['Discord', 'Epic Games Launcher', 'Notepad', 'OBS Studio', 'Spotify', 'Visual Studio Code', 'VLC media player'] })
  if (String(url).indexOf('/api/settings/apps') >= 0) {
    if (body.op === 'add') previewCustom.push({ label: body.label, match: body.match })
    if (body.op === 'remove') previewCustom = previewCustom.filter(function (a) { return a.label !== body.label })
    return json({ apps: previewCustom })
  }
  if (String(url).indexOf('/api/windows') >= 0) {
    return json({ windows: [{ id: '1', name: 'brave', title: 'YouTube - Brave', minimized: false }, { id: '2', name: 'Spotify', title: 'Spotify Premium', minimized: true }, { id: '3', name: 'Discord', title: 'Discord | #general', minimized: false }, { id: '4', name: 'notepad', title: 'notes.txt - Notepad', minimized: false }] })
  }
  if (String(url).indexOf('/api/do') >= 0) {
    return json({ message: 'Preview: ' + body.action + (body.arg ? ' (' + body.arg + ')' : '') + '. Nothing was really done.' })
  }
  return Promise.resolve(new Response(null, { status: 204 }))
}
</script>`
let html = read('index.html')
html = html.replace('<link rel="stylesheet" href="/app.css">', `<style>${read('app.css')}</style>`)
html = html.replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, '')
// The preview is already "paired": give the page a key without reading the address or storage.
const fakeKey = (code) => code.replace('if (key) {\n  // The home-screen shortcut', "key = 'preview-key-0123456789abcdef0123'\nif (key) {\n  // The home-screen shortcut")
const common = fakeKey(read('common.js'))
const js = read('app.js').replace("location.href = '/settings?k=' + encodeURIComponent(key)", "location.href = 'RemotePc-settings-preview.html'")
html = html.replace('<script src="/common.js"></script>\n<script src="/app.js" defer></script>', `${stub}\n<script>${common}</script>\n<script>${js}</script>`)
writeFileSync(join(outDir, 'RemotePc-preview.html'), html)

// The Settings page, with pretend settings kept in memory.
const settingsStub = `<script>
// PREVIEW ONLY: pretend settings, kept in this page.
var pv = { feedback: 'https://github.com/example/remotepc/issues/new', coffee: 'https://buy.stripe.com/example', values: { name: '', theme: '', order: 2, pinHours: 12, steamAtStart: true, steamDelay: 0, startMode: 'balanced', accent: '', lan: false }, startupTask: 'on', host: 'ROG-STRIX', hasPin: true, windows: true, version: '0.1.0' }
window.fetch = function (url, opts) {
  var body = {}
  try { body = JSON.parse((opts && opts.body) || '{}') } catch (e) {}
  var json = function (o) { return Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })) }
  var u = String(url)
  if (u.indexOf('/api/settings/save') >= 0) {
    var ch = body.changes || {}
    for (var k in ch) pv.values[k] = ch[k]
    return json({ changed: Object.keys(ch), restart: 'lan' in ch, message: 'lan' in ch ? 'Saved. This one applies after the program restarts (use Restart remote).' : 'Saved.' })
  }
  if (u.indexOf('/api/settings/apps') >= 0) {
    window.pvApps = window.pvApps || [{ label: 'VS Code', match: 'Visual Studio Code' }]
    if (body.op === 'add') window.pvApps = window.pvApps.filter(function (a) { return a.label.toLowerCase() !== String(body.label).toLowerCase() }).concat([{ label: body.label, match: body.match }])
    if (body.op === 'remove') window.pvApps = window.pvApps.filter(function (a) { return a.label !== body.label })
    return json({ apps: window.pvApps })
  }
  if (u.indexOf('/api/local/pair') >= 0) return json({ url: 'http://100.101.102.103:8791/?k=EXAMPLE', label: 'Phone 2', svg: ${JSON.stringify('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><path d="M1 1h3v3H1zM6 1h3v3H6zM1 6h3v3H1zM5 5h1v1H5zM7 6h2v1H7zM6 8h3v1H6z" fill="#000"/></svg>')} })
  if (u.indexOf('/api/settings/restart') >= 0) return json({ message: 'Preview: restarting. Nothing was really done.' })
  if (u.indexOf('/api/settings/task') >= 0) { pv.startupTask = body.on ? 'on' : 'off'; return json({ state: pv.startupTask }) }
  if (u.indexOf('/api/settings/pin') >= 0) { pv.hasPin = body.next !== ''; return json({ result: 'set', message: body.next === '' ? 'The PIN was removed.' : 'The PIN was changed (preview).' }) }
  if (u.indexOf('/api/settings') >= 0) return json(JSON.parse(JSON.stringify(pv)))
  if (u.indexOf('/api/do') >= 0) return json({ message: 'Preview: ' + body.action + '. Nothing was really done.' })
  return Promise.resolve(new Response(null, { status: 204 }))
}
</script>`
let sh = read('settings.html')
sh = sh.replace('<link rel="stylesheet" href="/app.css">', `<style>${read('app.css')}</style>`).replace(/<link rel="icon"[^>]*>\n?/, '')
const sjs = read('settings.js').replace("const onThePc = ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) >= 0", 'const onThePc = true').replace("location.href = '/'", "location.href = 'RemotePc-preview.html'").replace('setTimeout(() => location.reload(), 900)', 'setTimeout(() => load(), 900)')
sh = sh.replace('<script src="/common.js"></script>\n<script src="/settings.js" defer></script>', `${settingsStub}\n<script>${common}</script>\n<script>${sjs}</script>`)
writeFileSync(join(outDir, 'RemotePc-settings-preview.html'), sh)
console.log(`Wrote ${outDir}/RemotePc-preview.html and RemotePc-settings-preview.html`)
