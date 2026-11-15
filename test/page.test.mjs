// The phone page is a security boundary: these checks keep it simple and safe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (f) => readFileSync(fileURLToPath(new URL(`../src/web/${f}`, import.meta.url)), 'utf8')
const js = read('app.js')
const html = read('index.html')
const css = read('app.css')

test('the page script is valid JavaScript', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../src/web/app.js', import.meta.url))])
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
  const used = new Set([...js.matchAll(/(?:run|act)\('([a-z_]+)'/g)].map((m) => m[1]))
  for (const a of used) assert.ok(ACTIONS.includes(a) || ['wake', 'forget_phone'].includes(a), `${a} is not an action`)
  assert.ok(used.size >= 15, `found ${used.size} actions in the page`)
})

test('the page asks before the risky things', () => {
  for (const risky of ['Turn off the PC?', 'Restart the PC?', 'Sleep the PC?', 'Switch Steam account?', 'Close the running game?', 'Update this app and restart it?']) assert.ok(js.includes(risky), risky)
})
