import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Writes a whole file at once: a half-written file is never seen, even if the PC loses power. */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Appends a line to a log and keeps the file small (the older half is dropped past `max` bytes). */
export function appendLog(file, text, max = 256 * 1024) {
  mkdirSync(dirname(file), { recursive: true })
  try {
    if (statSync(file).size > max) {
      const keep = readFileSync(file, 'utf8').slice(-Math.floor(max / 2))
      writeFileSync(file, keep.slice(keep.indexOf('\n') + 1))
    }
  } catch {
    // No log yet.
  }
  appendFileSync(file, text)
}
