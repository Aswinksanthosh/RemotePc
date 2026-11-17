/**
 * An optional PIN on top of the phone key. Even a phone that is paired (or a stolen unlocked phone with the page open
 * after the PIN session ran out) must type the PIN. The PC keeps only a salted scrypt hash, in pin.json.
 * Wrong tries are counted per device: five wrong PINs lock that device out for five minutes.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { rmSync, statSync } from 'node:fs'
import { readJson, writeAtomic } from './fsutil.mjs'

const MAX_FAILS = 5
const FAIL_WINDOW_MS = 10 * 60 * 1000
const LOCKOUT_MS = 5 * 60 * 1000

export const validPin = (p) => typeof p === 'string' && /^\d{4,8}$/.test(p)

/** Too easy to guess: all the same digit (0000), or a straight run up or down (1234, 4321). */
export function isWeakPin(p) {
  if (!validPin(p)) return false
  if (/^(\d)\1+$/.test(p)) return true
  const d = [...p].map(Number)
  return d.every((x, i) => i === 0 || x - d[i - 1] === 1) || d.every((x, i) => i === 0 || d[i - 1] - x === 1)
}

const hash = (pin, salt) => scryptSync(pin, salt, 32)

export function createPin({ file, now = Date.now }) {
  const fails = new Map()
  let cache = { stamp: '', rec: null }

  function load() {
    let stamp = 'none'
    try {
      const s = statSync(file)
      stamp = `${s.mtimeMs}:${s.size}`
    } catch {
      cache = { stamp, rec: null }
      return null
    }
    if (stamp === cache.stamp) return cache.rec
    const raw = readJson(file, null)
    const rec = /^[0-9a-f]{32}$/.test(raw?.salt ?? '') && /^[0-9a-f]{64}$/.test(raw?.hash ?? '') ? raw : null
    cache = { stamp, rec }
    return rec
  }

  return {
    isSet: () => load() !== null,
    /** Changes whenever the PIN changes, so sessions made with an old PIN stop working. */
    version: () => load()?.hash.slice(0, 16) ?? '',
    set(pin) {
      if (!validPin(pin)) throw new Error('A PIN is 4 to 8 digits.')
      const salt = randomBytes(16)
      writeAtomic(file, `${JSON.stringify({ salt: salt.toString('hex'), hash: hash(pin, salt).toString('hex') })}\n`)
      cache = { stamp: '', rec: null }
    },
    remove() {
      rmSync(file, { force: true })
      cache = { stamp: '', rec: null }
    },
    /** Checks a PIN with no counting (for the tools on the PC). */
    check(pin) {
      const rec = load()
      if (!rec || !validPin(pin)) return false
      return timingSafeEqual(hash(pin, Buffer.from(rec.salt, 'hex')), Buffer.from(rec.hash, 'hex'))
    },
    /** For the phone: counts wrong tries per device. Returns { ok } or { error, status }. */
    verify(ip, pin) {
      const t = now()
      const f = fails.get(ip)
      if (f?.lockedUntil > t) return { error: 'Too many wrong PINs. Wait a few minutes.', status: 429 }
      if (!this.check(typeof pin === 'string' ? pin : '')) {
        const rec = f && t - f.first < FAIL_WINDOW_MS ? f : { count: 0, first: t, lockedUntil: 0 }
        rec.count++
        if (rec.count >= MAX_FAILS) rec.lockedUntil = t + LOCKOUT_MS
        fails.set(ip, rec)
        return { error: 'Wrong PIN.', status: 401 }
      }
      fails.delete(ip)
      return { ok: true }
    },
  }
}
