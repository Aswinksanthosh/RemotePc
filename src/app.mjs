/**
 * Puts the pieces together: settings, paired phones, the buttons, the server.
 * bin/remote.mjs runs this; the tests run it too (with a temporary folder and without Windows).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createActions } from './actions.mjs'
import { writeAtomic } from './fsutil.mjs'
import { createAuth } from './auth.mjs'
import { loadConfig } from './config.mjs'
import { createPin } from './pin.mjs'
import { createSettings } from './settings.mjs'
import { runStartup } from './startup.mjs'
import { runCommand } from './actions.mjs'
import { connect } from './probe.mjs'
import { dataPaths, RESTART_CODE } from './paths.mjs'
import { startServer } from './server.mjs'
import { runDoctor } from './doctor.mjs'
import { installUpdate, latestVersionId, repoSlug } from './updater.mjs'
import { qrToSvg } from './qr.mjs'
import { newPairing } from './setup.mjs'
import { networkInterfaces } from 'node:os'
import { knownPcs, sendMagicPacket } from './wake.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = join(here, '..')

export function readVersion(root = PROJECT_ROOT, installedFile) {
  let version = ''
  try {
    version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? ''
  } catch {
    // Unknown version.
  }
  let sha = ''
  try {
    sha = String(JSON.parse(readFileSync(installedFile, 'utf8')).sha ?? '').slice(0, 7)
  } catch {
    // Not installed by the updater.
  }
  return sha && /^[0-9a-f]{7}$/.test(sha) ? `${version} (${sha})` : version
}

/**
 * Starts everything. `platform` decides whether this machine can do the buttons (Windows) or only
 * start other PCs (anything else, for example a Raspberry Pi that stays on).
 */
export async function startApp({
  home,
  platform = process.platform,
  port,
  host = '0.0.0.0',
  exit = (code) => process.exit(code),
  fetchFn = globalThis.fetch,
  log = console.log,
} = {}) {
  const paths = dataPaths(home)
  const config = loadConfig(paths.config)
  const auth = createAuth({ file: paths.phones })
  const version = readVersion(PROJECT_ROOT, paths.installed)

  let pkg = {}
  try {
    pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))
  } catch {
    // No package.json next to the code (should not happen).
  }

  const update = async () => {
    const r = await installUpdate({ repo: repoSlug(pkg), paths, fetchFn })
    if (!r.installed) return r.message
    // The launcher starts the new version as soon as this one exits.
    setTimeout(() => exit(RESTART_CODE), 1500)
    return `Updated${r.sha ? ` to ${r.sha.slice(0, 7)}` : ''}. Restarting: reload this page in about 15 seconds.`
  }

  // Looked up once each time the program starts (so after every restart of the PC): is there a newer version on GitHub?
  // The phone page then asks "Update now? Yes / Not now". `boot` tells a phone it was already asked during this run.
  const updateState = { available: false, boot: Date.now().toString(36) }

  const actions =
    platform === 'win32'
      ? createActions({
          files: { buttons: paths.buttons, apps: paths.apps, games: paths.games, favorites: paths.favorites, switchLog: paths.switchLog, mode: paths.mode },
          version,
          update,
          updateInfo: () => ({ ...updateState }),
          restart: () => {
            // The launcher starts the program again as soon as this one exits.
            setTimeout(() => exit(RESTART_CODE), 1500)
            return 'Restarting the remote: reload this page in about 15 seconds.'
          },
          readdir: readdirSync,
        })
      : null

  const pin = createPin({ file: paths.pin })
  const server = await startServer({
    port: port ?? config.port,
    host,
    allow: config.allow,
    auth,
    pin,
    pairing: async () => {
      const p = newPairing({ paths, config, interfaces: networkInterfaces(), label: '' })
      return { url: p.url, svg: qrToSvg(p.url), label: p.label }
    },
    diagnostics: async () => {
      const d = await runDoctor({ paths, run: runCommand, interfaces: networkInterfaces(), fetchFn })
      const lines = []
      for (const r of d.results) {
        lines.push(`${r.level === 'ok' ? '[ OK ]' : r.level === 'warn' ? '[ !! ]' : '[FAIL]'} ${r.name}: ${r.detail}`)
        if (r.fix) lines.push(`        -> ${r.fix}`)
      }
      // Where the game list comes from: the number of games each source found (a source with 0 while another has many points at the problem).
      if (actions?.gameSources) {
        try {
          const g = await actions.gameSources()
          if (g) lines.push(`[ OK ] Games found: ${g.total} in the list (library files ${g.files}, Steam's own list ${g.steam}, added by hand ${g.added}${g.otherDrives.length ? `, extra library folders on drives: ${g.otherDrives.join(' ')}` : ''})`)
        } catch {
          // No games line.
        }
      }
      // Clear sound: which Hands-Free devices Windows lists (the switch can only work when it lists some).
      if (actions?.handsFreeInfo) {
        try {
          const h = await actions.handsFreeInfo()
          if (h) {
            const names = h.devices.map((d) => `${d.name} [${d.code === 22 ? 'off' : d.status || 'listed'}]`).join(', ')
            lines.push(h.found ? `[ OK ] Clear sound: ${h.devices.length} Hands-Free device${h.devices.length === 1 ? '' : 's'} found (${names}); administrator setup ${h.ready ? 'done' : 'NOT done: run Admin-Setup once'}` : '[ !! ] Clear sound: Windows lists no Hands-Free device for your Bluetooth devices, so the switch cannot work. Send this line to the developer.')
          }
        } catch {
          // No Clear sound line.
        }
      }
      // How long the slow Windows questions take right now (the page waits for the slowest one the first time it asks).
      if (actions?.timings) {
        try {
          const rows = await actions.timings()
          const slow = rows.some((r) => r.ms > 4000 || !r.ok)
          const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
          lines.push(`${slow ? '[ !! ]' : '[ OK ]'} Page speed (asked fresh, all at once): ${rows.map((r) => `${r.name} ${r.ok ? seconds(r.ms) : 'failed'}`).join(', ')}`)
          if (slow) lines.push('        -> A part over 4 s makes the first page load slow. Send this line to the developer.')
        } catch {
          // No timing line.
        }
      }
      // Windows questions that failed lately (otherwise the page just shows less, with no word why).
      for (const f of actions?.problems?.() ?? []) lines.push(`[ !! ] Could not read ${f.what} (${f.seconds} s ago): ${f.message}`)
      if (d.log) lines.push('', 'Last lines of the remote log:', ...d.log.split('\n').map((l) => `  ${l}`))
      return { lines, problems: d.problems }
    },
    settings: createSettings({ file: paths.config, appsFile: paths.apps, config, pin, run: runCommand, platform, version, appDir: join(here, '..') }),
    actions,
    config,
    others: () => knownPcs(paths.pcs),
    wake: (pc) => sendMagicPacket(pc.mac, { broadcast: pc.broadcast }),
    probe: (pc) => connect(pc.page),
    webDir: join(here, 'web'),
    version,
    coffeeUrl: typeof pkg?.funding?.url === 'string' ? pkg.funding.url : '',
    issuesUrl: repoSlug(pkg) ? `https://github.com/${repoSlug(pkg)}/issues/new` : '',
  })
  log(`[remote] ready on port ${server.port} (${config.allow.join(', ')}). ${actions ? 'This PC can be controlled.' : 'Helper mode: starts other PCs only.'}`)

  // Warm the slow lookups (Start menu, model name, Steam games) so the first phone does not wait for them.
  if (actions) actions.info().catch(() => {})
  if (actions) {
    const check = async () => {
      let current = ''
      try {
        current = String(JSON.parse(readFileSync(paths.installed, 'utf8')).sha ?? '')
      } catch {
        return // Not installed by the updater (for example a developer copy): nothing to compare.
      }
      const sha = await latestVersionId(repoSlug(pkg), 'main', fetchFn)
      updateState.available = Boolean(sha && current && sha !== current)
    }
    // A little after start, so a boot with no network yet still gets an answer, and tried again once.
    setTimeout(() => check().catch(() => {}), 30_000).unref?.()
    setTimeout(() => check().catch(() => {}), 5 * 60_000).unref?.()
  }
  // Things to do once per boot (set on the Settings page): Steam Big Picture.
  runStartup({ config, actions, stampFile: paths.startup, read: (f) => readFileSync(f, 'utf8'), write: (f, t) => writeAtomic(f, t), log }).catch(() => {})

  return { server, paths, config, auth, close: server.close }
}
