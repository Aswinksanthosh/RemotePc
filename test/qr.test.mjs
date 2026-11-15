import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qrModules, qrToConsole, qrToSvg } from '../src/qr.mjs'

const URL = 'http://100.101.102.103:8791/?k=AbCdEfGhIjKlMnOpQrStUvWxYz012345'

test('a QR code is a square with the three corner finder patterns', () => {
  const m = qrModules(URL)
  assert.equal(m.length, m[0].length)
  assert.ok(m.length >= 21 && m.length <= 57, `size ${m.length}`)
  for (const [r, c] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) {
    for (let i = 0; i < 7; i++) assert.ok(m[r][c + i] && m[r + 6][c + i] && m[r + i][c] && m[r + i][c + 6], 'finder border')
    assert.ok(m[r + 3][c + 3], 'finder centre')
  }
})

test('the SVG has a quiet border and is a plain, safe picture', () => {
  const svg = qrToSvg(URL)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/)
  assert.ok(!/<script|onload|href/i.test(svg))
  const n = qrModules(URL).length
  assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`))
})

test('the console version uses two rows of squares per line', () => {
  const lines = qrToConsole(URL).split('\n')
  const n = qrModules(URL).length + 4
  assert.equal(lines.length, Math.ceil(n / 2))
  assert.ok(lines.every((l) => [...l].length === n))
  assert.ok([...lines.join('')].every((ch) => '█▀▄ '.includes(ch)))
})

test('different links give different codes', () => {
  assert.notDeepEqual(qrModules(URL), qrModules(URL + 'x'))
})
