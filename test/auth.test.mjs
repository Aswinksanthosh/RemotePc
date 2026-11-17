import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAuth } from '../src/auth.mjs'
import { tempDir } from './helpers.mjs'

test('a paired phone is accepted and a stranger is not', (t) => {
  const file = join(tempDir(t), 'phones.json')
  const auth = createAuth({ file })
  const { key } = auth.add('My phone')
  assert.match(key, /^[A-Za-z0-9_-]{32}$/)
  assert.equal(auth.verify('1.1.1.1', key).ok, true)
  assert.equal(auth.verify('1.1.1.1', key + 'x').status, 401)
  assert.equal(auth.verify('1.1.1.1', '').status, 401)
  assert.equal(auth.verify('1.1.1.1', undefined).status, 401)
})

test('the key itself is never stored, only a fingerprint', (t) => {
  const file = join(tempDir(t), 'phones.json')
  const { key } = createAuth({ file }).add('Phone')
  const text = readFileSync(file, 'utf8')
  assert.ok(!text.includes(key))
  assert.match(text, /"hash": "[0-9a-f]{64}"/)
})

test('a new phone can be paired while the program runs (the file is re-read)', (t) => {
  const file = join(tempDir(t), 'phones.json')
  const running = createAuth({ file })
  assert.equal(running.verify('1.1.1.1', 'whatever-key-that-is-long-enough').status, 401)
  const { key } = createAuth({ file }).add('Second process')
  assert.equal(running.verify('1.1.1.1', key).ok, true)
})

test('forgetting a phone stops its key at once', (t) => {
  const auth = createAuth({ file: join(tempDir(t), 'phones.json') })
  const a = auth.add('A')
  const b = auth.add('B')
  assert.equal(auth.forget(a.id), 1)
  assert.equal(auth.verify('1.1.1.1', a.key).status, 401)
  assert.equal(auth.verify('1.1.1.1', b.key).ok, true)
  assert.equal(auth.forgetAll(), 1)
  assert.equal(auth.verify('1.1.1.1', b.key).status, 401)
  assert.deepEqual(auth.list(), [])
})

test('too many wrong keys lock a device out for a while, then it may try again', (t) => {
  let now = 1_000_000
  const auth = createAuth({ file: join(tempDir(t), 'phones.json'), now: () => now })
  const { key } = auth.add('Phone')
  for (let i = 0; i < 8; i++) assert.equal(auth.verify('9.9.9.9', 'wrong').status, 401)
  assert.equal(auth.verify('9.9.9.9', key).status, 429, 'even the right key waits during a lockout')
  assert.equal(auth.verify('8.8.8.8', key).ok, true, 'other devices are not affected')
  now += 6 * 60 * 1000
  assert.equal(auth.verify('9.9.9.9', key).ok, true)
})

test('a damaged or odd phones file is ignored, not trusted', (t) => {
  const file = join(tempDir(t), 'phones.json')
  const auth = createAuth({ file })
  writeFileSync(file, '{not json')
  assert.equal(auth.verify('1.1.1.1', 'abc').status, 401)
  writeFileSync(file, JSON.stringify([{ id: 'x', label: 'y', hash: 'short' }, null, 5]))
  assert.deepEqual(auth.list(), [])
})

test('labels are cleaned and the number of phones is limited', (t) => {
  const auth = createAuth({ file: join(tempDir(t), 'phones.json') })
  assert.equal(auth.add('  A\u0000B  ').label, 'AB')
  assert.equal(auth.add('').label, 'Phone')
  for (let i = 0; i < 28; i++) auth.add(`p${i}`)
  assert.throws(() => auth.add('one too many'), /Too many/)
})

test('the list says which phones are connected now and when each was last seen', (t) => {
  let now = 1_800_000_000_000
  const file = join(tempDir(t), 'phones.json')
  const auth = createAuth({ file, now: () => now })
  const a = auth.add('A')
  const b = auth.add('B')
  assert.deepEqual(auth.list().map((p) => [p.label, p.connected, p.lastSeen]), [['A', false, 0], ['B', false, 0]])
  auth.verify('1.1.1.1', a.key)
  assert.deepEqual(auth.list().map((p) => [p.label, p.connected]), [['A', true], ['B', false]])
  now += 60_000
  assert.equal(auth.list()[0].connected, true)
  now += 90_000
  assert.equal(auth.list()[0].connected, false, 'two minutes of silence: no longer connected')
  assert.ok(auth.list()[0].lastSeen > 0)
  // Remembered after a restart of the program.
  const again = createAuth({ file, now: () => now })
  assert.ok(again.list().find((p) => p.label === 'A').lastSeen > 0)
  assert.equal(again.list().find((p) => p.label === 'A').connected, false)
  assert.equal(again.list().find((p) => p.label === 'B').lastSeen, 0)
  assert.ok(b)
})
