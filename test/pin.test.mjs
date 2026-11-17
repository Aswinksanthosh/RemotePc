import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPin, isWeakPin, validPin } from '../src/pin.mjs'
import { setupPin } from '../src/setup.mjs'
import { createUi } from '../src/ui.mjs'
import { tempDir } from './helpers.mjs'

test('a PIN is 4 to 8 digits; easy ones are called weak', () => {
  for (const p of ['1357', '12345678', '0042']) assert.equal(validPin(p), true, p)
  for (const p of ['123', '123456789', 'abcd', '12 34', '', undefined, 1234]) assert.equal(validPin(p), false, String(p))
  for (const p of ['0000', '1111', '1234', '4321', '23456', '98765', '00000000']) assert.equal(isWeakPin(p), true, p)
  for (const p of ['1357', '2580', '1212', '8426']) assert.equal(isWeakPin(p), false, p)
})

test('the PIN is stored as a salted hash, never as text', (t) => {
  const file = join(tempDir(t), 'pin.json')
  const pin = createPin({ file })
  assert.equal(pin.isSet(), false)
  pin.set('8426')
  const text = readFileSync(file, 'utf8')
  assert.ok(!text.includes('8426'))
  assert.match(text, /"salt":"[0-9a-f]{32}"/)
  assert.equal(pin.isSet(), true)
  assert.equal(pin.check('8426'), true)
  assert.equal(pin.check('8427'), false)
  assert.throws(() => pin.set('12'), /4 to 8 digits/)
  pin.set('8426')
  assert.notEqual(readFileSync(file, 'utf8'), text, 'a new salt every time')
})

test('wrong PINs lock a device out for a while, other devices are not affected', (t) => {
  let now = 1_000_000
  const pin = createPin({ file: join(tempDir(t), 'pin.json'), now: () => now })
  pin.set('8426')
  for (let i = 0; i < 5; i++) assert.equal(pin.verify('9.9.9.9', '0000').status, 401)
  assert.equal(pin.verify('9.9.9.9', '8426').status, 429)
  assert.equal(pin.verify('8.8.8.8', '8426').ok, true)
  now += 6 * 60 * 1000
  assert.equal(pin.verify('9.9.9.9', '8426').ok, true)
})

test('changing or removing the PIN is noticed by a running program', (t) => {
  const file = join(tempDir(t), 'pin.json')
  const running = createPin({ file })
  assert.equal(running.version(), '')
  createPin({ file }).set('8426')
  const v1 = running.version()
  assert.ok(v1)
  createPin({ file }).set('8427')
  assert.notEqual(running.version(), v1)
  createPin({ file }).remove()
  assert.equal(running.isSet(), false)
})

function lab(t, answers, env) {
  const out = []
  const ui = createUi({ write: (s) => out.push(s) })
  const pin = createPin({ file: join(tempDir(t), 'pin.json') })
  const queue = [...(answers ?? [])]
  const asked = []
  const ask = async (q) => (asked.push(q), queue.shift() ?? '')
  return { pin, ui, out, ask, asked, run: () => setupPin({ pin, ask: answers ? ask : undefined, ui, env }) }
}

test('the installer asks twice, refuses weak and different PINs, then saves', async (t) => {
  const l = lab(t, ['0000', '1234', 'abc', '8426', '1111', '8426', '8426'])
  await l.run()
  assert.equal(l.pin.check('8426'), true)
  const text = l.out.join('')
  assert.match(text, /too easy to guess/)
  assert.match(text, /4 to 8 digits, nothing else/)
  assert.match(text, /two PINs were different/)
  assert.match(text, /PIN saved/)
})

test('the installer lets you skip, with a warning, and keeps an existing PIN on Enter', async (t) => {
  const skip = lab(t, [''])
  await skip.run()
  assert.equal(skip.pin.isSet(), false)
  assert.match(skip.out.join(''), /No PIN set/)
  const keep = lab(t, [''])
  keep.pin.set('8426')
  await keep.run()
  assert.equal(keep.pin.check('8426'), true)
  assert.match(keep.out.join(''), /current PIN stays/)
})

test('six bad tries in a row give up without a PIN', async (t) => {
  const l = lab(t, ['0000', '1234', '1111', 'abc', '99', '5555'])
  await l.run()
  assert.equal(l.pin.isSet(), false)
})

test('RSP_PIN sets the PIN without asking, and refuses a bad one', async (t) => {
  const a = lab(t, undefined, { RSP_PIN: '8426' })
  await a.run()
  assert.equal(a.pin.check('8426'), true)
  assert.equal(a.asked.length, 0)
  const b = lab(t, undefined, { RSP_PIN: 'abc' })
  await b.run()
  assert.equal(b.pin.isSet(), false)
})
