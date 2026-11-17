/**
 * Paired phones. There is no password to type: each phone holds a long random key in the
 * link it was paired with (the QR code), and the program keeps only a fingerprint of it.
 *
 *   - a key is 192 random bits, so it cannot be guessed
 *   - keys are compared in constant time, and a device that keeps failing is locked out
 *   - "Forget" a phone (or all of them) and its key stops working immediately
 *   - the file is read again when it changes, so pairing a new phone needs no restart
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { statSync } from 'node:fs'
import { readJson, writeAtomic } from './fsutil.mjs'

const MAX_FAILS = 8
const FAIL_WINDOW_MS = 10 * 60 * 1000
const LOCKOUT_MS = 5 * 60 * 1000
const MAX_PHONES = 30

const fingerprint = (key) => createHash('sha256').update(String(key)).digest()

export function createAuth({ file, now = Date.now }) {
  const fails = new Map() // ip -> { count, first, lockedUntil }
  const seen = new Map() // phone id -> when it last talked to this PC (this run)
  let cache = { stamp: '', list: [] }

  function load() {
    let stamp = 'none'
    try {
      const s = statSync(file)
      stamp = `${s.mtimeMs}:${s.size}`
    } catch {
      cache = { stamp, list: [] }
      return cache.list
    }
    if (stamp === cache.stamp) return cache.list
    const raw = readJson(file, [])
    const list = (Array.isArray(raw) ? raw : []).filter(
      (p) => p && typeof p.id === 'string' && typeof p.label === 'string' && /^[0-9a-f]{64}$/.test(p.hash ?? ''),
    )
    cache = { stamp, list }
    return list
  }

  function save(list) {
    writeAtomic(file, `${JSON.stringify(list, null, 2)}\n`)
    cache = { stamp: '', list }
  }

  return {
    /** Checks a key. Returns { ok, id, label } or { error, status }. */
    verify(ip, key) {
      const t = now()
      const f = fails.get(ip)
      if (f?.lockedUntil > t) return { error: 'Too many wrong tries. Wait a few minutes.', status: 429 }
      const given = fingerprint(typeof key === 'string' ? key.slice(0, 200) : '')
      let found = null
      for (const p of load()) {
        if (timingSafeEqual(given, Buffer.from(p.hash, 'hex'))) found = p
      }
      if (!found) {
        const rec = f && t - f.first < FAIL_WINDOW_MS ? f : { count: 0, first: t, lockedUntil: 0 }
        rec.count++
        if (rec.count >= MAX_FAILS) rec.lockedUntil = t + LOCKOUT_MS
        fails.set(ip, rec)
        return { error: 'This phone is not paired. Open the pairing link from the PC again.', status: 401 }
      }
      fails.delete(ip)
      seen.set(found.id, t)
      // Remembered across restarts, but written at most every ten minutes per phone.
      const before = Date.parse(found.lastSeen ?? '') || 0
      if (t - before > 10 * 60 * 1000) {
        try {
          save(load().map((p) => (p.id === found.id ? { ...p, lastSeen: new Date(t).toISOString() } : p)))
        } catch {
          // Only the "last seen" time is lost.
        }
      }
      return { ok: true, id: found.id, label: found.label }
    },
    /** Pairs a new phone. Returns the key ONCE; only its fingerprint is kept. */
    add(label = 'Phone') {
      const list = load().slice()
      if (list.length >= MAX_PHONES) throw new Error('Too many paired phones. Forget some first.')
      const key = randomBytes(24).toString('base64url')
      const id = randomBytes(4).toString('hex')
      // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
      const clean = String(label).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30) || 'Phone'
      list.push({ id, label: clean, hash: fingerprint(key).toString('hex'), created: new Date(now()).toISOString() })
      save(list)
      return { key, id, label: clean }
    },
    /** Paired phones. `lastSeen` is milliseconds (0 = never); `connected` means it talked to this PC in the last two minutes. */
    list: () =>
      load().map(({ id, label, created, lastSeen }) => {
        const last = Math.max(seen.get(id) ?? 0, Date.parse(lastSeen ?? '') || 0)
        return { id, label, created, lastSeen: last, connected: last > 0 && now() - last < 120_000 }
      }),
    forget(id) {
      const before = load()
      const after = before.filter((p) => p.id !== id)
      if (after.length !== before.length) save(after)
      return before.length - after.length
    },
    forgetAll() {
      const n = load().length
      save([])
      return n
    },
  }
}
