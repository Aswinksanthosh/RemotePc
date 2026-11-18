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
import { installUpdate, repoSlug } from './updater.mjs'
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

  const actions =
    platform === 'win32'
      ? createActions({
          files: { buttons: paths.buttons, apps: paths.apps, games: paths.games, switchLog: paths.switchLog, mode: paths.mode },
          version,
          update,
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
    settings: createSettings({ file: paths.config, appsFile: paths.apps, config, pin, run: runCommand, platform, version }),
    actions,
    config,
    others: () => knownPcs(paths.pcs),
    wake: (pc) => sendMagicPacket(pc.mac, { broadcast: pc.broadcast }),
    probe: (pc) => connect(pc.page),
    webDir: join(here, 'web'),
    version,
    issuesUrl: repoSlug(pkg) ? `https://github.com/${repoSlug(pkg)}/issues/new` : '',
  })
  log(`[remote] ready on port ${server.port} (${config.allow.join(', ')}). ${actions ? 'This PC can be controlled.' : 'Helper mode: starts other PCs only.'}`)

  // Warm the slow lookups (Start menu, model name, Steam games) so the first phone does not wait for them.
  if (actions) actions.info().catch(() => {})
  // Things to do once per boot (set on the Settings page): a power mode, Steam Big Picture.
  runStartup({ config, actions, stampFile: paths.startup, read: (f) => readFileSync(f, 'utf8'), write: (f, t) => writeAtomic(f, t), log }).catch(() => {})

  return { server, paths, config, auth, close: server.close }
}
