/**
 * The settings. A small json file with safe defaults; anything odd in it is ignored.
 *
 *   port     the port of the phone page (default 8791)
 *   allow    who may connect: "loopback" (this PC), "tailscale" (your phone through Tailscale),
 *            "lan" (anything on the same Wi-Fi or cable). Never the open internet.
 *   accent   page colour: "blue" (default), "pink", "amber", "green", "purple", "red".
 *            Empty means: follow the PC's model name (ROG pink, TUF amber, otherwise blue).
 *   name     the name shown on the page; empty means the PC's own name
 *   pinHours how long a typed PIN stays valid on a phone (1 to 720, default 12)
 *   nodePath where node.exe is, so the launcher does not depend on PATH
 */

import { readJson, writeAtomic } from './fsutil.mjs'

export const ACCENTS = ['blue', 'pink', 'amber', 'green', 'purple', 'red']
export const NETWORKS = ['loopback', 'tailscale', 'lan']

export const DEFAULT_CONFIG = { port: 8791, allow: ['loopback', 'tailscale'], accent: '', name: '', nodePath: '', pinHours: 12 }

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
    nodePath: clean(r.nodePath, 260),
    pinHours: Number.isInteger(r.pinHours) && r.pinHours >= 1 && r.pinHours <= 720 ? r.pinHours : DEFAULT_CONFIG.pinHours,
  }
}

export const loadConfig = (file) => normalizeConfig(readJson(file, {}))
export const saveConfig = (file, config) => writeAtomic(file, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`)
