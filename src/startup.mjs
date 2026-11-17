/**
 * What the program does by itself when the PC starts (set on the Settings page):
 *   - set a Windows power mode (config.startMode)
 *   - open Steam Big Picture (config.steamAtStart, after config.steamDelay seconds)
 * Each is done ONCE PER BOOT: restarting only the remote (the Restart button, an update) does not repeat them.
 * The boot is recognised by the minute the PC started, kept in startup.json.
 */

import { uptime } from 'node:os'

export async function runStartup({
  config,
  actions,
  stampFile,
  now = Date.now,
  uptimeFn = uptime,
  read,
  write,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  const result = {}
  if (!actions) return result
  const boot = String(Math.round((now() - uptimeFn() * 1000) / 60_000))
  let saved = { boot: '', done: [] }
  try {
    saved = JSON.parse(read(stampFile))
  } catch {
    // First start after a boot.
  }
  const done = new Set(Math.abs(Number(saved.boot) - Number(boot)) <= 2 && Array.isArray(saved.done) ? saved.done : [])
  const mark = (what) => {
    done.add(what)
    try {
      write(stampFile, JSON.stringify({ boot, done: [...done] }))
    } catch {
      // Worst case it repeats once.
    }
  }

  if (config.startMode && !done.has('mode')) {
    mark('mode')
    try {
      log(`[remote] startup: ${await actions.run(`mode_${config.startMode}`)}`)
      result.mode = 'set'
    } catch (err) {
      log(`[remote] startup: could not set the power mode: ${err.message}`)
      result.mode = 'failed'
    }
  }
  if (config.steamAtStart && !done.has('steam')) {
    mark('steam')
    await sleep(config.steamDelay * 1000)
    result.steam = 'failed'
    // The first try can come before Windows or Steam is ready: one more try, 15 seconds later.
    for (let attempt = 1; attempt <= 2 && result.steam === 'failed'; attempt++) {
      try {
        await actions.run('steam_bigpicture')
        log(`[remote] startup: opened Steam Big Picture${attempt > 1 ? ' (second try)' : ''}.`)
        result.steam = 'started'
      } catch (err) {
        log(`[remote] startup: could not open Steam Big Picture (try ${attempt}): ${err.message}`)
        if (attempt === 1) await sleep(15_000)
      }
    }
  }
  return result
}
