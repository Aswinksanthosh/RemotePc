/**
 * A small zip reader, so updating needs nothing but Node (no tar, no PowerShell, no git).
 * It reads the zip files GitHub makes (stored or deflated entries) and refuses anything odd:
 * paths that climb out of the folder, absolute paths, too many files, too much data.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Reads a zip held in memory. Returns [{ name, data }]; folders are left out. */
export function readZip(buf, { maxFiles = 3000, maxBytes = 60 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('That is not a zip file.')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('That is not a zip file.')
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || offset === 0xffffffff) throw new Error('Zip64 files are not supported.')
  if (count > maxFiles) throw new Error('The zip has too many files.')
  const out = []
  let total = 0
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('The zip is damaged.')
    const method = buf.readUInt16LE(offset + 10)
    const crc = buf.readUInt32LE(offset + 16)
    const compSize = buf.readUInt32LE(offset + 20)
    const size = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const local = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    offset += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    total += size
    if (total > maxBytes) throw new Error('The zip is too large.')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('The zip is damaged.')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + compSize)
    if (raw.length !== compSize) throw new Error('The zip is damaged.')
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error('The zip uses a method that is not supported.')
    if (data.length !== size || crc32(data) !== crc) throw new Error(`The zip is damaged (${name}).`)
    out.push({ name, data })
  }
  return out
}

/** "repo-main/src/a.mjs" with strip 1 -> "src/a.mjs". Returns null for anything unsafe. */
export function safeRelative(name, strip = 0) {
  const parts = String(name).replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length <= strip) return null
  const rest = parts.slice(strip)
  if (rest.some((p) => p === '..' || p.includes('\0') || /^[a-zA-Z]:/.test(p))) return null
  if (String(name).startsWith('/') || /^[a-zA-Z]:/.test(String(name))) return null
  return rest.join('/')
}

/** Writes the files of a zip into `dest`. Returns how many files were written. */
export function extractZip(buf, dest, { strip = 1, write = writeFileSync, mkdir = mkdirSync } = {}) {
  const root = resolve(dest)
  let written = 0
  for (const { name, data } of readZip(buf)) {
    const rel = safeRelative(name, strip)
    if (!rel) continue
    const target = resolve(join(root, rel))
    if (target !== root && !target.startsWith(root + sep)) throw new Error('The zip tries to write outside its folder.')
    mkdir(dirname(target), { recursive: true })
    write(target, data)
    written++
  }
  return written
}
