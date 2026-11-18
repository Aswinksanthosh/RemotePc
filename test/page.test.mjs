// The phone page is a security boundary: these checks keep it simple and safe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (f) => readFileSync(fileURLToPath(new URL(`../src/web/${f}`, import.meta.url)), 'utf8')
const js = read('common.js') + '\n' + read('app.js') + '\n' + read('settings.js')
const html = read('index.html') + read('settings.html')
const css = read('app.css')

test('the page scripts are valid JavaScript', () => {
  for (const f of ['common.js', 'app.js', 'settings.js']) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../src/web/${f}`, import.meta.url))])
})

test('text from the PC is never put on the page as HTML', () => {
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("', "setTimeout('", 'srcdoc']) assert.ok(!js.includes(bad), bad)
})

test('no outside address, no native pop-ups, no inline code', () => {
  assert.ok(!/https?:\/\//.test(js.replace("'http:' + '//www.w3.org/2000/svg'", '')), 'no URLs in the script')
  assert.ok(!/https?:\/\//.test(html) && !/https?:\/\//.test(css))
  assert.ok(!/\b(confirm|alert|prompt)\(/.test(js))
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline script')
  assert.ok(!/<style/.test(html) && !/\sstyle=/.test(html) && !/\son[a-z]+=/.test(html), 'no inline style or handlers')
  assert.ok(!/url\(['"]?https?:/.test(css) && !/@import/.test(css))
})

test('the key is only ever sent in a header, never in the address of an API call', () => {
  assert.ok(/authorization = 'Bearer ' \+ key/.test(js))
  assert.ok(!/fetch\([^)]*\?k=/.test(js.replace(/manifest\.webmanifest\?k=/, '')))
})

test('every button of the page maps to an action the server knows', async () => {
  const { ACTIONS } = await import('../src/actions.mjs')
  const used = new Set([...js.matchAll(/(?:run|act)\('([a-z_]+)'[,)]/g)].map((m) => m[1]))
  for (const a of used) assert.ok(ACTIONS.includes(a) || ['wake', 'forget_phone'].includes(a), `${a} is not an action`)
  assert.ok(used.size >= 15, `found ${used.size} actions in the page`)
})

test('the page asks before the risky things', () => {
  for (const risky of ['Turn off the PC?', 'Restart the PC?', 'Sleep the PC?', 'Switch Steam account?', 'Close the running game?', 'Update this app? It restarts by itself.']) assert.ok(js.includes(risky), risky)
})

test('the page has a PIN screen and sends the PIN session with every call', () => {
  assert.ok(js.includes('function pinScreen') && js.includes("'Enter your PIN'"))
  assert.ok(js.includes("h['x-unlock'] = unlock"))
  assert.ok(/inputMode = 'numeric'/.test(js) && /autocomplete = 'off'/.test(js))
})

test('the page has three looks, a swipe card for several PCs, and a hand-over animation', () => {
  for (const t of ['neon', 'tactical', 'clean']) assert.ok(js.includes(`['${t}'`), t)
  assert.ok(js.includes('function pagerCard') && js.includes("'swipe to change PC'"))
  assert.ok(js.includes("localStorage.setItem('rsp_theme:'"))
  for (const c of ['body[data-theme=neon]', 'body[data-theme=tactical]', '.pager.enter-right', '.pager.dragging', '@property --a']) assert.ok(css.includes(c), c)
  assert.ok(!/class="nav"/.test(html), 'the old bottom bar is gone')
})

test('the Settings page only changes what the server allows, and every control saves through the checked route', () => {
  const settings = read('settings.js')
  assert.ok(settings.includes("'/api/settings/save'") && settings.includes("'/api/settings/pin'") && settings.includes("'/api/settings/task'"))
  for (const k of ['steamAtStart', 'steamDelay', 'startMode', 'theme', 'order', 'pinHours', 'name', 'lan']) assert.ok(settings.includes(k), k)
  assert.ok(!/localStorage\.setItem\('rsp_k'/.test(settings), 'the key is handled in common.js only')
})

test('the footer has the copyright line and a feedback drop-down that only opens a GitHub new-issue form', () => {
  assert.ok(js.includes('© 2026 Aswin K Santhosh') && js.includes('MIT licence'))
  for (const t of ['Share an idea', 'Give feedback', 'Report a bug or glitch']) assert.ok(js.includes(t), t)
  assert.ok(js.includes('issues\\/new$'), 'only a github.com .../issues/new address is accepted')
  assert.ok(js.includes('Please do not paste your pairing link, PIN or any password'))
  assert.ok(!/password\s*[:=]\s*['"]|localStorage\.getItem\('rsp_k'\)[^;]*encodeURIComponent/.test(js.slice(js.indexOf('function footer'))), 'the key never goes into a feedback link')
})

test('switching PCs keeps the header, swipe card and footer on screen and swaps only the cards; the next page paints its shell at once', () => {
  for (const t of ['function ensureShell', 'function placePager', 'function commitContent', 'function showSkeleton', 'card._set', 'sh.foot.dataset.sig']) assert.ok(js.includes(t), t)
  assert.ok(js.includes("'#from='") && js.includes("encodeURIComponent(JSON.stringify(l.map("), 'the address carries the look and the list of PCs')
  assert.ok(read('boot.js').includes('document.body.dataset.theme'), 'the look is set before the first paint')
  assert.ok(html.includes('<script src="/boot.js"></script>'))
  assert.ok(!css.includes('transition:--a'), 'no colour-variable transition (it repaints the whole page every frame)')
})

test('the Settings page has the limiter, custom apps and (on the PC only) adding a phone, and uses only the checked routes', () => {
  const st = read('settings.js')
  for (const t of ['Temperature limit', 'Check temperature sensors', 'My apps', 'Add a phone', "'/api/settings/apps'", "'/api/settings/sensors'", "'/api/local/pair'", "'/api/settings/restart'", 'limiterOn', 'cpuLimit', 'gpuLimit']) assert.ok(st.includes(t), t)
  assert.ok(st.includes("['localhost', '127.0.0.1', '[::1]']") && st.includes('if (onThePc) p.append(addPhoneCard())'), 'the QR is only offered on the PC itself')
  assert.ok(js.includes("'x-rsp-local': '1'"), 'calls say they come from our own page')
})
