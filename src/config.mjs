/**
 * The settings. A small json file with safe defaults; anything odd in it is ignored.
 *
 *   port     the port of the phone page (default 8791)
 *   allow    who may connect: "loopback" (this PC), "tailscale" (your phone through Tailscale),
 *            "lan" (anything on the same Wi-Fi or cable). Never the open internet.
 *   accent   page colour: "blue" (default), "pink", "amber", "green", "purple", "red".
 *            Empty means: follow the PC's model name (ROG pink, TUF amber, otherwise blue).
 *   name     the name shown on the page; empty means the PC's own name
 *   theme    "neon", "tactical" or "clean": the look this PC starts with (empty: ROG neon, TUF tactical, else clean)
 *   order    place in the swipe bar when you own several PCs (0 to 99, lower is further left)
 *   steamAtStart  true: open Steam Big Picture once per boot, steamDelay seconds after the program starts (0 to 300)
 *   pinHours how long a typed PIN stays valid on a phone (1 to 720, default 12)
 *   nodePath where node.exe is, so the launcher does not depend on PATH
 */

import { readJson, writeAtomic } from './fsutil.mjs'

export const ACCENTS = ['blue', 'pink', 'amber', 'green', 'purple', 'red']
export const THEMES = ['neon', 'tactical', 'clean']
export const NETWORKS = ['loopback', 'tailscale', 'lan']

export const DEFAULT_CONFIG = { port: 8791, allow: ['loopback', 'tailscale'], accent: '', name: '', theme: '', order: 0, nodePath: '', pinHours: 12, steamAtStart: false, steamDelay: 0 }

export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const port = Number(r.port)
  const allow = Array.isArray(r.allow) ? [...new Set(r.allow.filter((x) => NETWORKS.includes(x)))] : DEFAULT_CONFIG.allow
  // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
  const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '')
  return {
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_CONFIG.port,
    // This PC must always be able to reach its own page (the installer and Fix-It check it).
    allow: allow.includes('loopback') ? allow : ['loopback', ...allow],
    accent: ACCENTS.includes(r.accent) ? r.accent : '',
    name: clean(r.name, 30),
    // The look the page starts with on this PC. Empty means: follow the PC (ROG neon, TUF tactical, otherwise clean). Each phone can pick its own.
    theme: THEMES.includes(r.theme) ? r.theme : '',
    // Where this PC sits in the swipe bar of the page (lower is further left). Ties go by name.
    order: Number.isInteger(r.order) && r.order >= 0 && r.order <= 99 ? r.order : 0,
    nodePath: clean(r.nodePath, 260),
    // Things done when the program starts at sign-in.
    steamAtStart: r.steamAtStart === true,
    steamDelay: Number.isInteger(r.steamDelay) && r.steamDelay >= 0 && r.steamDelay <= 300 ? r.steamDelay : 0,
    pinHours: Number.isInteger(r.pinHours) && r.pinHours >= 1 && r.pinHours <= 720 ? r.pinHours : DEFAULT_CONFIG.pinHours,
  }
}

export const loadConfig = (file) => normalizeConfig(readJson(file, {}))
export const saveConfig = (file, config) => writeAtomic(file, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`)

/** The settings the Settings page may change, and how each is checked. Anything else is refused. */
export const EDITABLE = ['name', 'theme', 'order', 'pinHours', 'steamAtStart', 'steamDelay', 'accent', 'allow']
/** These only take effect after the program restarts. */
export const NEEDS_RESTART = ['allow']

/** Applies a patch of editable settings to the current ones. Returns { config, changed, restart } or throws a plain sentence. */
export function applySettingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Nothing to save.')
  const next = { ...current }
  const changed = []
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE.includes(k)) throw new Error(`"${k}" cannot be changed here.`)
    if (k === 'steamAtStart' && typeof v !== 'boolean') throw new Error('Steam at startup is on or off.')
    if (k === 'steamDelay' && !(Number.isInteger(v) && v >= 0 && v <= 300)) throw new Error('The wait is 0 to 300 seconds.')
    if (k === 'order' && !(Number.isInteger(v) && v >= 0 && v <= 99)) throw new Error('The order is a number from 0 to 99.')
    if (k === 'pinHours' && !(Number.isInteger(v) && v >= 1 && v <= 720)) throw new Error('The PIN stays valid for 1 to 720 hours.')
    if (k === 'theme' && v !== '' && !THEMES.includes(v)) throw new Error('Unknown theme.')
    if (k === 'allow' && !(Array.isArray(v) && v.every((x) => NETWORKS.includes(x)))) throw new Error('Unknown network.')
    if (k === 'name' && typeof v !== 'string') throw new Error('The name is text.')
    if (k === 'accent' && v !== '' && !ACCENTS.includes(v)) throw new Error('Unknown colour.')
    next[k] = v
    changed.push(k)
  }
  const config = normalizeConfig(next)
  return { config, changed, restart: changed.some((k) => NEEDS_RESTART.includes(k)) }
}
