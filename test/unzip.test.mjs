import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, extractZip, readZip, safeRelative } from '../src/unzip.mjs'
import { makeZip, tempDir } from './helpers.mjs'

test('crc32 matches the known value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('reads deflated and stored entries', () => {
  for (const store of [false, true]) {
    const zip = makeZip({ 'a.txt': 'hello hello hello hello', 'dir/b.bin': Buffer.from([1, 2, 3, 0, 255]) }, { store })
    const files = readZip(zip)
    assert.deepEqual(files.map((f) => f.name), ['a.txt', 'dir/b.bin'])
    assert.equal(files[0].data.toString(), 'hello hello hello hello')
    assert.deepEqual([...files[1].data], [1, 2, 3, 0, 255])
  }
})

test('extracts into a folder and strips the top folder GitHub adds', (t) => {
  const dest = tempDir(t)
  const n = extractZip(makeZip({ 'proj-main/package.json': '{}', 'proj-main/src/a.mjs': 'x', 'proj-main/': '' }), dest, { strip: 1 })
  assert.equal(n, 2)
  assert.equal(readFileSync(join(dest, 'src', 'a.mjs'), 'utf8'), 'x')
  assert.ok(existsSync(join(dest, 'package.json')))
})

test('paths that climb out, or are absolute, are never written', (t) => {
  const dest = tempDir(t)
  assert.equal(safeRelative('p/../../evil', 1), null)
  assert.equal(safeRelative('p/..', 1), null)
  assert.equal(safeRelative('/etc/passwd', 0), null)
  assert.equal(safeRelative('C:\\Windows\\x', 0), null)
  assert.equal(safeRelative('p/C:/x', 1), null)
  assert.equal(safeRelative('p/a/b.txt', 1), 'a/b.txt')
  assert.equal(safeRelative('p', 1), null)
  const n = extractZip(makeZip({ 'p/ok.txt': 'ok', 'p/../../evil.txt': 'bad', '/abs.txt': 'bad' }), dest, { strip: 1 })
  assert.equal(n, 1)
  assert.ok(!existsSync(join(dest, '..', 'evil.txt')))
})

test('damaged, truncated or oversized zips are refused', () => {
  assert.throws(() => readZip(Buffer.from('nope')), /not a zip/)
  assert.throws(() => readZip(Buffer.alloc(100)), /not a zip/)
  const zip = makeZip({ 'a.txt': 'some text to damage' }, { store: true })
  const bad = Buffer.from(zip)
  bad[zip.indexOf('some')] ^= 0xff
  assert.throws(() => readZip(bad), /damaged/)
  assert.throws(() => readZip(makeZip({ 'a.txt': 'x'.repeat(100) }), { maxBytes: 10 }), /too large/)
  assert.throws(() => readZip(makeZip({ 'a': '1', 'b': '2' }), { maxFiles: 1 }), /too many/)
})
