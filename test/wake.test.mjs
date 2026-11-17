import { test } from 'node:test'
import assert from 'node:assert/strict'
import { knownPcs, magicPacket, parseMac, sendMagicPacket } from '../src/wake.mjs'

test('parseMac accepts the usual spellings and nothing else', () => {
  for (const m of ['AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', 'aabbccddeeff', ' AA:BB:CC:DD:EE:FF ']) assert.equal(parseMac(m)?.length, 6, m)
  for (const m of ['', 'AA:BB', 'GG:BB:CC:DD:EE:FF', 'AA:BB:CC:DD:EE:FF:00', undefined, 5]) assert.equal(parseMac(m), null, String(m))
})

test('the magic packet is 6 x 0xFF then the MAC 16 times', () => {
  const p = magicPacket('01:02:03:04:05:06')
  assert.equal(p.length, 102)
  assert.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255])
  for (let i = 0; i < 16; i++) assert.deepEqual([...p.subarray(6 + i * 6, 12 + i * 6)], [1, 2, 3, 4, 5, 6])
  assert.throws(() => magicPacket('nope'), /not a valid MAC/)
})

test('it is sent to ports 9 and 7 of the broadcast address', async () => {
  const sent = []
  await sendMagicPacket('01:02:03:04:05:06', { broadcast: '192.168.1.255', send: async (p, a, port) => sent.push([p.length, a, port]) })
  assert.deepEqual(sent, [[102, '192.168.1.255', 9], [102, '192.168.1.255', 7]])
})

test('pcs.json: valid entries only, nothing outside the file can be woken', () => {
  const file = JSON.stringify({
    Desk: { mac: 'AA:BB:CC:DD:EE:FF', page: 'http://100.1.2.3:8791/', broadcast: '192.168.1.255' },
    'Only page': { page: 'http://100.1.2.4:8791' },
    'Bad mac and page': { mac: 'zz', page: 'javascript:alert(1)' },
    'Bad broadcast': { mac: '11:22:33:44:55:66', broadcast: '999.1.1.1' },
    '': { mac: 'AA:BB:CC:DD:EE:FF' },
  })
  const pcs = knownPcs('x', () => file)
  assert.deepEqual(Object.keys(pcs), ['desk', 'only page', 'bad broadcast'])
  assert.deepEqual(pcs.desk, { label: 'Desk', mac: 'AA:BB:CC:DD:EE:FF', broadcast: '192.168.1.255', page: 'http://100.1.2.3:8791', theme: '', order: 0 })
  assert.equal(pcs['bad broadcast'].broadcast, '255.255.255.255')
  assert.deepEqual(knownPcs('x', () => { throw new Error('no file') }), {})
})

test('pcs.json can give each PC a look and a place in the swipe bar', () => {
  const pcs = knownPcs('x', () => JSON.stringify({ A: { page: 'http://100.1.2.3:8791', theme: 'tactical', order: 2 }, B: { page: 'http://100.1.2.4:8791', theme: 'sparkly', order: -1 }, C: { page: 'http://100.1.2.5:8791', order: 'x' } }))
  assert.deepEqual([pcs.a.theme, pcs.a.order], ['tactical', 2])
  assert.deepEqual([pcs.b.theme, pcs.b.order], ['', 0])
  assert.deepEqual([pcs.c.theme, pcs.c.order], ['', 0])
})
