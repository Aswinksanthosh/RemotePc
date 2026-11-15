import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAddress, isAllowedAddress, listAddresses, phoneUrl } from '../src/net.mjs'

test('classifyAddress tells the networks apart', () => {
  assert.equal(classifyAddress('127.0.0.1'), 'loopback')
  assert.equal(classifyAddress('::1'), 'loopback')
  assert.equal(classifyAddress('::ffff:127.0.0.1'), 'loopback')
  assert.equal(classifyAddress('100.101.102.103'), 'tailscale')
  assert.equal(classifyAddress('100.64.0.1'), 'tailscale')
  assert.equal(classifyAddress('100.127.255.255'), 'tailscale')
  assert.equal(classifyAddress('100.128.0.1'), 'other')
  assert.equal(classifyAddress('100.63.0.1'), 'other')
  assert.equal(classifyAddress('fd7a:115c:a1e0::1'), 'tailscale')
  for (const a of ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.1', '169.254.1.1', 'fe80::1', 'fd12:3456::1']) assert.equal(classifyAddress(a), 'lan', a)
  for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '1.2.3.4', '300.1.1.1', 'not an address', '', undefined]) assert.equal(classifyAddress(a), 'other', String(a))
})

test('only the allowed networks get in, and never the open internet', () => {
  assert.equal(isAllowedAddress('100.101.102.103', ['loopback', 'tailscale']), true)
  assert.equal(isAllowedAddress('192.168.1.5', ['loopback', 'tailscale']), false)
  assert.equal(isAllowedAddress('192.168.1.5', ['loopback', 'tailscale', 'lan']), true)
  assert.equal(isAllowedAddress('8.8.8.8', ['loopback', 'tailscale', 'lan']), false)
})

test('listAddresses finds Tailscale and the real network, not virtual cards', () => {
  const ifaces = {
    Tailscale: [{ family: 'IPv4', address: '100.101.102.103', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    'VirtualBox Host-Only': [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    Ethernet: [{ family: 4, address: '169.254.9.9', internal: false }],
  }
  assert.deepEqual(listAddresses(ifaces), { tailscale: ['100.101.102.103'], lan: ['192.168.1.20'] })
})

test('phoneUrl prefers Tailscale and respects what is allowed', () => {
  const both = { tailscale: ['100.1.2.3'], lan: ['192.168.1.9'] }
  assert.equal(phoneUrl(both, 8791, 'KEY'), 'http://100.1.2.3:8791/?k=KEY')
  assert.equal(phoneUrl({ tailscale: [], lan: ['192.168.1.9'] }, 8791, 'KEY'), 'http://192.168.1.9:8791/?k=KEY')
  assert.equal(phoneUrl({ tailscale: [], lan: ['192.168.1.9'] }, 8791, 'KEY', ['tailscale']), null)
  assert.equal(phoneUrl(both, 8791, 'KEY', ['lan']), 'http://192.168.1.9:8791/?k=KEY')
  assert.equal(phoneUrl({ tailscale: [], lan: [] }, 8791, 'KEY'), null)
  assert.equal(phoneUrl(both, 9000, ''), 'http://100.1.2.3:9000/')
})
