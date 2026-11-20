/**
 * What the Settings page can read and change. Only the settings listed in config.mjs (EDITABLE) can be changed, each
 * is checked, and the running program uses the new values at once (except the ones that need a restart).
 */

import { hostname as osHostname } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applySettingsPatch, saveConfig } from './config.mjs'
import { writeAtomic } from './fsutil.mjs'
import { TASK_NAME } from './paths.mjs'
import { isWeakPin, validPin } from './pin.mjs'

/** The only tools the page can open: fixed names, fixed files. */
const TOOLS = { update: 'Update.cmd', fixit: 'Fix-It.cmd', uninstall: 'Uninstall.cmd' }

export function createSettings({ file, appsFile = '', config, pin, run, platform = process.platform, version = '', appDir = '', hostname = osHostname, readText = (f) => readFileSync(f, 'utf8') }) {
  const windows = platform === 'win32'

  /** 'on' | 'off' | 'missing' (no scheduled task) | null (not Windows). */
  async function taskState() {
    if (!windows) return null
    try {
      const out = await run('schtasks.exe', ['/query', '/tn', TASK_NAME, '/fo', 'LIST'])
      return /Status:\s*Disabled/i.test(out) ? 'off' : 'on'
    } catch {
      return 'missing'
    }
  }

  // The apps you add yourself: { "name on the button": "exact name in the Start menu" }. Same rules as the file you could write by hand.
  const CONTROL = /[\u0000-\u001f]/
  function readApps() {
    try {
      const raw = JSON.parse(readText(appsFile))
      return Object.entries(raw).filter(([k, v]) => typeof v === 'string' && k.trim() && k.length <= 30 && v.trim() && v.length <= 60 && !CONTROL.test(k + v)).map(([label, match]) => ({ label: label.trim(), match: match.trim() }))
    } catch {
      return []
    }
  }
  /** Every app the Start menu lists, so the PC's own Settings page can offer them (names only, sorted, no helper entries). */
  async function startApps() {
    if (!windows) throw new Error('This works on Windows only.')
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from('Get-StartApps | ForEach-Object { $_.Name }', 'utf16le').toString('base64')], { timeout: 20_000 })
    const noise = /\b(uninstall|readme|help|documentation|release notes|website|license|manual)\b/i
    const names = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.length <= 60 && !CONTROL.test(l) && !noise.test(l))
    return [...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, 400)
  }

  /** { op: 'list' } | { op: 'add', label, match } | { op: 'remove', label } -> { apps } */
  function apps(body) {
    if (!appsFile) throw new Error('Custom apps are not available here.')
    let list = readApps()
    if (body?.op === 'add') {
      const label = String(body.label ?? '').trim()
      const match = String(body.match ?? '').trim()
      if (!label || label.length > 30) throw new Error('Give the app a short name (up to 30 letters).')
      if (!match || match.length > 60) throw new Error('Type the app name exactly as the Start menu shows it (up to 60 letters).')
      if (CONTROL.test(label + match)) throw new Error('That name has odd characters.')
      if (list.length >= 30 && !list.some((a) => a.label.toLowerCase() === label.toLowerCase())) throw new Error('That is plenty of apps: remove one first.')
      list = list.filter((a) => a.label.toLowerCase() !== label.toLowerCase())
      list.push({ label, match })
    } else if (body?.op === 'remove') {
      const label = String(body.label ?? '').trim().toLowerCase()
      list = list.filter((a) => a.label.toLowerCase() !== label)
    } else if (body?.op !== 'list') throw new Error('Unknown request.')
    if (body.op !== 'list') writeAtomic(appsFile, `${JSON.stringify(Object.fromEntries(list.map((a) => [a.label, a.match])), null, 2)}\n`)
    return { apps: list }
  }

  return {
    apps,
    startApps,
    async get() {
      const { name, theme, order, pinHours, steamAtStart, steamDelay, accent, allow } = config
      return {
        values: { name, theme, order, pinHours, steamAtStart, steamDelay, accent, lan: allow.includes('lan') },
        startupTask: await taskState(),
        host: hostname(),
        hasPin: pin.isSet(),
        windows,
        version,
      }
    },
    save(patch) {
      // The page sends "lan" as a yes or no; the program keeps a list of networks.
      const p = { ...patch }
      if ('lan' in p) {
        const lan = p.lan === true
        delete p.lan
        p.allow = lan ? [...new Set([...config.allow, 'lan'])] : config.allow.filter((x) => x !== 'lan')
      }
      const r = applySettingsPatch(config, p)
      Object.assign(config, r.config)
      saveConfig(file, config)
      return { changed: r.changed, restart: r.restart }
    },
    /** Opens Update, Fix-It or Uninstall in their own window on the PC (they need a console, and Uninstall asks Windows for rights). */
    async openTool(name) {
      if (!windows) throw new Error('This works on Windows only.')
      const file = TOOLS[name]
      if (!file || !appDir) throw new Error('Unknown tool.')
      await run('cmd.exe', ['/c', 'start', '', join(appDir, file)])
      return `Opened ${file.replace('.cmd', '')} in a window on the PC.`
    },
    async setTask(on) {
      if (!windows) throw new Error('This works on Windows only.')
      if ((await taskState()) === 'missing') throw new Error('There is no automatic start to change. Run Install.cmd.')
      try {
        await run('schtasks.exe', ['/change', '/tn', TASK_NAME, on ? '/enable' : '/disable'])
      } catch (err) {
        throw new Error(`Windows refused: ${err.message}. Try it on the PC: run Install.cmd as administrator.`)
      }
      return on ? 'on' : 'off'
    },
    /** Changes the PIN. The current PIN is checked first (with the same lockout as the page). `next` empty removes the PIN. */
    changePin(ip, current, next) {
      if (pin.isSet()) {
        const r = pin.verify(ip, current)
        if (!r.ok) throw Object.assign(new Error(r.error), { status: r.status })
      }
      if (next === '') {
        pin.remove()
        return 'removed'
      }
      if (!validPin(next)) throw new Error('A PIN is 4 to 8 digits.')
      if (isWeakPin(next)) throw new Error('That PIN is too easy to guess (like 0000 or 1234).')
      pin.set(next)
      return 'set'
    },
  }
}
