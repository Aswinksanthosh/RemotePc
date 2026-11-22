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
  for (const risky of ['Turn off the PC?', 'Restart the PC?', 'Sleep the PC?', 'Switch Steam account?', 'Close the running game?', 'Update App?']) assert.ok(js.includes(risky), risky)
})

test('the page has a PIN screen and sends the PIN session with every call', () => {
  assert.ok(js.includes('function pinScreen') && js.includes("'Enter your PIN'"))
  assert.ok(js.includes("h['x-unlock'] = unlock"))
  assert.ok(/inputMode = 'numeric'/.test(js) && /autocomplete = 'off'/.test(js))
})

test('the page has three looks', () => {
  for (const t of ['neon', 'tactical', 'clean']) assert.ok(js.includes(`['${t}'`), t)
  assert.ok(!js.includes('pagerCard') && !css.includes('.pager'), 'the PC-switching swipe card is gone')
  assert.ok(js.includes("localStorage.setItem('rsp_theme:'"))
  for (const c of ['body[data-theme=neon]', 'body[data-theme=tactical]', '@property --a']) assert.ok(css.includes(c), c)
  assert.ok(!/class="nav"/.test(html), 'the old bottom bar is gone')
})

test('the Settings page only changes what the server allows, and every control saves through the checked route', () => {
  const settings = read('settings.js')
  assert.ok(settings.includes("'/api/settings/save'") && settings.includes("'/api/settings/pin'") && settings.includes("'/api/settings/task'"))
  for (const k of ['steamAtStart', 'steamDelay', 'theme', 'pinHours', 'name', 'lan']) assert.ok(settings.includes(k), k)
  assert.ok(!/localStorage\.setItem\('rsp_k'/.test(settings), 'the key is handled in common.js only')
})

test('the footer has the copyright line and a feedback drop-down that only opens a GitHub new-issue form', () => {
  assert.ok(js.includes('© 2026 Aswin K Santhosh') && js.includes('MIT licence'))
  for (const t of ['Share an idea', 'Give feedback', 'Report a bug or glitch']) assert.ok(js.includes(t), t)
  assert.ok(js.includes('issues\\/new$'), 'only a github.com .../issues/new address is accepted')
  assert.ok(js.includes('Please do not paste your pairing link, PIN or any password'))
  assert.ok(!/password\s*[:=]\s*['"]|localStorage\.getItem\('rsp_k'\)[^;]*encodeURIComponent/.test(js.slice(js.indexOf('function footer'))), 'the key never goes into a feedback link')
})

test('the header and footer stay on screen and only the cards are swapped', () => {
  for (const t of ['function ensureShell', 'function commitContent', 'sh.foot.dataset.sig']) assert.ok(js.includes(t), t)
  assert.ok(!js.includes("'#from='"), 'no hand-over between PC pages any more')
  assert.ok(!css.includes('transition:--a'), 'no colour-variable transition (it repaints the whole page every frame)')
})

test('the Settings page has custom apps and (on the PC only) adding a phone, and uses only the checked routes', () => {
  const st = read('settings.js')
  for (const t of ['My apps', 'Add a phone', "'/api/settings/apps'", "'/api/local/pair'", "'/api/settings/restart'"]) assert.ok(st.includes(t), t)
  assert.ok(st.includes("['localhost', '127.0.0.1', '[::1]']") && st.includes('p.append(addPhoneCard())'), 'the add-phone card is on every Settings page')
  assert.ok(js.includes("'x-rsp-local': '1'"), 'calls say they come from our own page')
})

test('the volume slider sends its level as text (the server only passes text arguments)', () => {
  assert.ok(js.includes("arg: String(slider.value)") && js.includes("act('volume_set', String(slider.value))"))
  assert.ok(!js.includes('Number(slider.value)'))
})

test('the Windows list is loaded only when opened, and every close asks first', () => {
  assert.ok(js.includes("call('/api/windows')") && js.includes("acc('windows', 'Windows'") && js.includes('() => loadWindows()'))
  assert.ok(js.includes("act('window_focus', w.id)") && js.includes("confirmBox('Close this window?'"))
  assert.ok(js.includes("act('window_close', w.id)"))
})

test('the Windows list and the app manager are drawn even before they are on the page (a redraw must not empty them)', () => {
  assert.ok(!js.includes('winBox.isConnected') && !js.includes('appMgrBox.isConnected'))
})

test('the player bar (previous, play, next, mute, volume slider) is pinned at the top and sound output is a drop-down', () => {
  assert.ok(js.indexOf('p.append(playerBar(pc))') > 0 && js.indexOf('p.append(playerBar(pc))') < js.indexOf("const steam = el('div', 'steam')"), 'the bar comes before Steam')
  assert.ok(js.includes("acc('sound', "), 'sound output is a drop-down like the Bluetooth one')
  assert.ok(!js.includes("section('play', 'Media')"), 'the old big Media card is gone')
  assert.ok(css.includes('.player{position:sticky'), 'the bar stays on screen while scrolling')
})

test('the Power mode card has the Screen off and Sleep timers, and an open drop-down sits above the cards below it', () => {
  assert.ok(js.includes("'Screen off after'") && js.includes("'Sleep after'") && js.includes("act('timer_set', kind + ':'"))
  assert.ok(css.includes('.card:has(.dd.open)'))
})

test('favourites: stars in the Bluetooth and sound output lists, and a one-tap strip under the player bar', () => {
  assert.ok(js.includes('function starBtn') && js.includes("act('favorite_set'") && js.includes("starBtn('bt', name") && js.includes("starBtn('out', name"))
  const call = js.indexOf('const favBox = favoritesStrip(pc)')
  assert.ok(js.indexOf('p.append(playerBar(pc))') < call && call < js.indexOf("const steam = el('div', 'steam')"), 'the strip is under the player bar and above Steam')
  assert.ok(js.includes("act(isOn ? 'bt_disconnect' : 'bt_connect', name)") && js.includes("act('audio_set', name)"))
})

test('battery: the laptop charge and plug icon are in the Power mode card and the earbud charge in the Bluetooth list and favourites', () => {
  assert.ok(js.includes("'batt'") && js.includes("'On battery' : 'Plugged in'") && js.includes("' · battery ' + pct") && js.includes("pct ? ' · ' + pct"))
})

test('a missing game can be added from the phone by its Steam number, with a PUBG shortcut', () => {
  assert.ok(js.includes("'Game missing? Add it'") && js.includes("'578080|PUBG: BATTLEGROUNDS'") && js.includes("changeGames('game_add'") && js.includes("changeGames('game_remove'"))
  assert.ok(js.includes('sys.append(gameManager(pc))'))
})

test('now playing sits in the pinned player bar: title, artist, cover, progress, hidden when nothing plays', () => {
  assert.ok(js.includes("'/api/media'") && js.includes("'/api/cover'") && js.includes("el('div', 'nowrow')") && js.includes('row.hidden = true'))
  assert.ok(js.includes("'nowtitle'") && js.includes("'nowmeter'") && js.includes('setInterval(pollNow'))
})

test('accessibility: the player bar buttons, mute, slider and song progress have names, and focus is visible', () => {
  assert.ok(js.includes("b.setAttribute('aria-label', label)") && js.includes("'Media and volume'") && js.includes("'progressbar'") && js.includes('aria-valuetext'))
  assert.ok(css.includes(':focus-visible'))
})
