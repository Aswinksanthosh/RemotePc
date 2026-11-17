/**
 * What the Settings page can read and change. Only the settings listed in config.mjs (EDITABLE) can be changed, each
 * is checked, and the running program uses the new values at once (except the ones that need a restart).
 */

import { hostname as osHostname } from 'node:os'
import { applySettingsPatch, saveConfig } from './config.mjs'
import { TASK_NAME } from './paths.mjs'
import { isWeakPin, validPin } from './pin.mjs'

export function createSettings({ file, config, pin, run, platform = process.platform, version = '', hostname = osHostname }) {
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

  return {
    async get() {
      const { name, theme, order, pinHours, steamAtStart, steamDelay, startMode, accent, allow } = config
      return {
        values: { name, theme, order, pinHours, steamAtStart, steamDelay, startMode, accent, lan: allow.includes('lan') },
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
