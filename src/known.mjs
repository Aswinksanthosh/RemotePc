/** Reads the owner's own small files (buttons.json, favorites.json, apps.json). Odd entries are ignored. */

import { readFileSync } from 'node:fs'

export const WILDCARD = (pattern) => new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
export const CONTROL = /[\u0000-\u001f]/

/** Buttons you defined yourself in buttons.json. Entries that look odd are ignored. */
export function knownButtons(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = {}
  try {
    for (const [name, v] of Object.entries(JSON.parse(readText(file)))) {
      const key = String(name).toLowerCase().trim()
      const command = typeof v === 'string' ? v.trim() : typeof v?.command === 'string' ? v.command.trim() : ''
      const cwd = typeof v?.cwd === 'string' ? v.cwd.trim() : ''
      if (!key || key.length > 40 || !command || command.length > 300 || CONTROL.test(command) || CONTROL.test(cwd) || CONTROL.test(key)) continue
      out[key] = { command, cwd }
    }
  } catch {
    // No file: no custom buttons.
  }
  return out
}

/** Apps you added yourself in apps.json: { "button name": "exact name in the Start menu" }. */
/** Favourite Bluetooth devices and sound outputs: { bt: [names], out: [names] }, kept in favorites.json. Anything odd is ignored. */
export function knownFavorites(file, readText = (f) => readFileSync(f, 'utf8')) {
  const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.trim() && x.length <= 80).map((x) => x.trim()))].slice(0, 8) : [])
  try {
    const raw = JSON.parse(readText(file))
    return { bt: clean(raw?.bt), out: clean(raw?.out) }
  } catch {
    return { bt: [], out: [] }
  }
}

export function knownCustomApps(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = {}
  try {
    for (const [name, v] of Object.entries(JSON.parse(readText(file)))) {
      const label = String(name).trim()
      const target = typeof v === 'string' ? v.trim() : ''
      if (!label || label.length > 30 || !target || target.length > 60 || CONTROL.test(label + target)) continue
      out[label.toLowerCase()] = { label, match: target, exact: true }
    }
  } catch {
    // No file: only the built-in list.
  }
  return out
}

