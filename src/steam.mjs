/**
 * Everything that reads Steam's own files. Nothing is ever written except the account switch,
 * and no passwords are read: Steam keeps those in its own encrypted storage.
 *
 *   - which games are installed (steamapps\appmanifest_*.acf in every Steam library folder)
 *   - the picture of a game (Steam's own cache), so nothing is downloaded
 *   - who is signed in and which accounts stay signed in (config\loginusers.vdf)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Steam's text format: "key" "value" and "key" { ... }. Returns nested objects without a prototype. */
export function parseVdf(text) {
  const token = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g
  const stack = [Object.create(null)]
  let key = null
  let m
  while ((m = token.exec(String(text ?? '')))) {
    if (m[2] === '{') {
      const o = Object.create(null)
      if (key !== null) {
        stack.at(-1)[key] = o
        key = null
      }
      stack.push(o)
    } else if (m[2] === '}') {
      if (stack.length > 1) stack.pop()
      key = null
    } else if (m[1] !== undefined) {
      const s = m[1].replace(/\\(.)/g, '$1')
      if (key === null) key = s
      else {
        stack.at(-1)[key] = s
        key = null
      }
    }
  }
  return stack[0]
}

/** Things in steamapps that are not games. */
const NOT_GAMES = new Set(['228980', '1070560', '1391110', '1493710', '1628350', '1826330'])
const NOT_GAME_NAME = /^(steamworks common|steam linux runtime|proton\b|steam voice|steamvr performance)/i

/** The folders that hold Steam games: Steam's own folder plus every extra library from libraryfolders.vdf. */
export function libraryFolders(steamPath, readText = (f) => readFileSync(f, 'utf8')) {
  const folders = [steamPath]
  try {
    const vdf = parseVdf(readText(join(steamPath, 'steamapps', 'libraryfolders.vdf')))
    const root = vdf.libraryfolders ?? vdf.LibraryFolders ?? {}
    for (const v of Object.values(root)) {
      const p = typeof v === 'string' ? v : v?.path
      if (typeof p === 'string' && p && !folders.some((f) => f.toLowerCase() === p.toLowerCase())) folders.push(p)
    }
  } catch {
    // No libraryfolders.vdf: only Steam's own folder.
  }
  return folders
}

/** Installed games: [{ appid, name }], sorted by name. */
export function scanGames(steamPath, { readText = (f) => readFileSync(f, 'utf8'), readdir = readdirSync } = {}) {
  const found = new Map()
  for (const lib of libraryFolders(steamPath, readText)) {
    let files = []
    try {
      files = readdir(join(lib, 'steamapps'))
    } catch {
      continue
    }
    for (const f of files) {
      const m = /^appmanifest_(\d{1,10})\.acf$/.exec(f)
      if (!m) continue
      try {
        const app = parseVdf(readText(join(lib, 'steamapps', f))).AppState
        const name = typeof app?.name === 'string' ? app.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) : ''
        const appid = String(app?.appid ?? m[1])
        if (!name || !/^\d{1,10}$/.test(appid) || NOT_GAMES.has(appid) || NOT_GAME_NAME.test(name)) continue
        found.set(appid, { appid, name })
      } catch {
        // A damaged manifest: skip that game.
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** games.json: { "name": appid }. The owner's own entries, for games Steam does not list. Odd entries are ignored. */
export function extraGames(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = []
  try {
    for (const [name, id] of Object.entries(JSON.parse(readText(file)))) {
      const n = String(name).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
      if (n && /^\d{1,10}$/.test(String(id))) out.push({ appid: String(id), name: n })
    }
  } catch {
    // No file: only the games Steam lists.
  }
  return out
}

/** Picture files Steam keeps for a game, best first. Old Steam: <id>_header.jpg. New Steam: a folder per game. */
export function findGameArt(steamPath, appid, { readdir = readdirSync, stat = statSync, max = 1.5 * 1024 * 1024 } = {}) {
  if (!/^\d{1,10}$/.test(String(appid))) return null
  const dir = join(steamPath, 'appcache', 'librarycache')
  const ok = (file) => {
    try {
      const s = stat(file)
      return s.isFile() && s.size > 0 && s.size <= max
    } catch {
      return false
    }
  }
  const want = ['header.jpg', 'library_header.jpg', 'library_hero.jpg']
  const found = []
  const walk = (folder, depth) => {
    let names = []
    try {
      names = readdir(folder)
    } catch {
      return
    }
    for (const n of names) {
      if (want.includes(n)) found.push(join(folder, n))
      else if (depth > 0 && !n.includes('.')) walk(join(folder, n), depth - 1)
    }
  }
  walk(join(dir, String(appid)), 2)
  found.sort((a, b) => want.indexOf(a.split(/[\\/]/).pop()) - want.indexOf(b.split(/[\\/]/).pop()))
  for (const f of [join(dir, `${appid}_header.jpg`), ...found, join(dir, `${appid}_library_hero.jpg`)]) if (ok(f)) return f
  return null
}

// -- who is signed in -----------------------------------------------------------------

/** The signed-in Steam user (display name and 17-digit id) from config/loginusers.vdf. */
export function parseSteamLogin(vdf) {
  const users = []
  for (const m of String(vdf ?? '').matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
    const field = (k) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[2])?.[1]
    users.push({ id: m[1], name: field('PersonaName') || field('AccountName') || '', recent: field('MostRecent') === '1' })
  }
  const pick = users.find((u) => u.recent && u.name) ?? users.find((u) => u.name)
  return pick ? { id: pick.id, name: pick.name.slice(0, 40) } : { id: '', name: '' }
}

/** Every account in loginusers.vdf: { id, name }. */
export function parseSteamUsers(vdf) {
  const out = []
  for (const m of String(vdf ?? '').matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
    const field = (k) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[2])?.[1]
    out.push({ id: m[1], name: (field('PersonaName') || field('AccountName') || '').slice(0, 40) })
  }
  return out
}

/** Steam keeps the account that is signed in right now as a small number; the 17-digit id is that number plus a fixed offset. */
export function steamIdFromAccountNumber(n) {
  const num = Number(n)
  return Number.isInteger(num) && num > 0 ? String(76561197960265728n + BigInt(num)) : ''
}

/**
 * Moves the "MostRecent" flag in loginusers.vdf to one account (1 for it, 0 for the others).
 * Only those flags change; if the chosen account has no such line, one is added.
 */
export function setMostRecent(vdf, id) {
  return String(vdf ?? '').replace(/("(\d{17})"\s*\{)([^}]*)(\})/g, (whole, open, userId, body, close) => {
    const flag = userId === id ? '1' : '0'
    if (/"MostRecent"\s+"\d"/i.test(body)) return open + body.replace(/("MostRecent"\s+")\d(")/i, `$1${flag}$2`) + close
    return userId === id ? `${open}${body.replace(/\s*$/, '')}\n\t\t"MostRecent"\t\t"1"\n\t${close}` : whole
  })
}

/** The accounts Steam stays signed in to on this PC (RememberPassword). `account` is the login name Steam needs to pick the account; it never leaves the PC. */
export function parseSteamAccounts(vdf) {
  const out = []
  for (const m of String(vdf ?? '').matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
    const field = (k) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[2])?.[1]
    const account = field('AccountName') ?? ''
    const name = (field('PersonaName') || account).slice(0, 40)
    if (field('RememberPassword') === '1' && name && /^[A-Za-z0-9_.-]{2,64}$/.test(account)) out.push({ id: m[1], name, account })
  }
  return out.slice(0, 10)
}

/** Value of a name in `reg query` output. */
export const regValue = (out, name) => new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, 'i').exec(String(out))?.[1]?.trim() ?? ''
