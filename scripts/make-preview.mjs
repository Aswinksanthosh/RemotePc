#!/usr/bin/env node
// Builds ONE html file that shows the phone page with pretend data (no PC needed, nothing is sent anywhere).
//   node scripts/make-preview.mjs [output.html]
// Open the file in any browser; on a computer, narrow the window or use the phone view of the browser's developer tools.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'web')
const read = (f) => readFileSync(join(web, f), 'utf8')
const out = process.argv[2] || 'RemotePc-preview.html'

const pc = {
  name: 'ROG', model: 'ROG Strix G16', version: '0.1.0', control: true, accent: '', mode: 'balanced',
  games: ['Counter-Strike 2', 'Hades', 'Portal 2', 'PUBG: BATTLEGROUNDS'], gameArt: [], buttons: ['my tests', 'open code'],
  headphones: ['OnePlus Buds Pro', 'AirPods Pro'], outputs: ['Speakers (Realtek Audio)', 'OnePlus Buds Pro Stereo', 'Monitor (HDMI)'],
  apps: ['Discord', 'Spotify', 'Chrome', 'Epic Games', 'OBS Studio', 'Claude'],
  steam: { user: 'DemoPlayer', playing: '', id: '1', avatar: false, accounts: [{ id: '1', name: 'DemoPlayer' }, { id: '2', name: 'Second Account' }] },
}
const stub = `<script>
// PREVIEW ONLY: pretend answers instead of a real PC.
var previewTwo = true
var previewMode = 'balanced'
window.fetch = function (url, opts) {
  var body = {}
  try { body = JSON.parse((opts && opts.body) || '{}') } catch (e) {}
  var json = function (o) { return Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })) }
  if (String(url).indexOf('/api/state') >= 0) {
    var pc = ${JSON.stringify(pc)}
    pc.mode = previewMode
    return json({ pc: pc, version: '0.1.0', phones: [{ id: 'a', label: 'My phone', current: true }],
      others: previewTwo ? [{ key: 'tuf', name: 'TUF', canWake: true, page: 'https://example.invalid/tuf', online: true }] : [] })
  }
  if (String(url).indexOf('/api/do') >= 0) {
    if (/^mode_/.test(body.action)) previewMode = body.action.slice(5)
    return json({ message: 'Preview: ' + body.action + (body.arg ? ' (' + body.arg + ')' : '') + '. Nothing was really done.' })
  }
  return Promise.resolve(new Response(null, { status: 204 }))
}
</script>`
const pill = `<div style="display:flex;gap:6px;justify-content:center;padding:6px;background:#1b2530;font:12px system-ui">
<button id="pv1" style="padding:6px 10px;border-radius:99px;border:1px solid #888;background:#fff;color:#000">Two laptops (you)</button>
<button id="pv2" style="padding:6px 10px;border-radius:99px;border:1px solid #888;background:#fff;color:#000">One PC (your friend)</button></div>
<script>
document.getElementById('pv1').onclick = function () { previewTwo = true; lastSig = ''; refresh() }
document.getElementById('pv2').onclick = function () { previewTwo = false; lastSig = ''; refresh() }
</script>`

let html = read('index.html')
html = html.replace('<link rel="stylesheet" href="/app.css">', `<style>${read('app.css')}</style>`)
html = html.replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, '')
// The preview is already "paired": give the page a key without reading the address or storage.
const js = read('app.js').replace('if (key) {\n  // The home-screen shortcut', "key = 'preview-key-0123456789abcdef0123'\nif (key) {\n  // The home-screen shortcut")
html = html.replace('<script src="/app.js" defer></script>', `${stub}\n<script>${js}</script>\n${pill}`)
writeFileSync(out, html)
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`)
