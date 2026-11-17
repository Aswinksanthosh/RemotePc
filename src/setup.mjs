/**
 * The one-tap installer, as plain steps. bin/setup.mjs wires the real Windows commands into this;
 * the tests run it with pretend ones. Each step says what it did in plain words, and a step that
 * fails tells you what to do next instead of stopping everything it could still finish.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createAuth } from './auth.mjs'
import { loadConfig, saveConfig } from './config.mjs'
import { createPin, isWeakPin, validPin } from './pin.mjs'
import { listAddresses, phoneUrl } from './net.mjs'
import { TASK_NAME } from './paths.mjs'
import { qrToConsole, qrToSvg } from './qr.mjs'
import {
  configureFirewall,
  findTailscale,
  launcherScript,
  loginTailscale,
  psArgs,
  registerTaskScript,
  shortcutsScript,
  stopRemoteScript,
  tailscaleStatus,
} from './windows.mjs'

const SKIP_COPY = new Set(['.git', 'node_modules', '.github'])

/** Copies the program into <home>\app (replacing what was there). Skips the copy when run from that folder already. */
export function syncApp(source, dest) {
  if (resolve(source) === resolve(dest)) return false
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(source, dest, { recursive: true, filter: (src) => !SKIP_COPY.has(basename(src)) })
  return true
}

/** The page shown on this PC's screen: a big QR code to scan with the phone's camera. */
export function pairingPage({ url, label, tailscale }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pair your phone</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1016;color:#e8f1f6;font:18px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:560px;padding:24px;text-align:center}
h1{margin:0 0 8px;font-size:1.6rem}
.qr{background:#fff;border-radius:16px;padding:6px;width:min(80vw,420px);margin:18px auto}
.qr svg{display:block;width:100%;height:auto}
ol{text-align:left;display:inline-block;margin:8px 0;padding-left:22px}
code{display:block;word-break:break-all;background:#16202b;border-radius:10px;padding:10px;margin-top:14px;font-size:.78rem;color:#9db1be;user-select:all}
.warn{color:#ffd9a0;font-size:.9rem;margin-top:14px}
</style></head><body><main>
<h1>Pair your phone</h1>
<p>${esc(label)}</p>
<div class="qr">${qrToSvg(url)}</div>
<ol>
${tailscale ? '<li>Install <b>Tailscale</b> on the phone and sign in with the same account as on this PC.</li>' : ''}
<li>Open the phone's <b>camera</b> and point it at the code.</li>
<li>Tap the link. Then use the browser menu: <b>Add to Home Screen</b>.</li>
</ol>
<code>${esc(url)}</code>
<p class="warn">This link is the key to your PC. Do not share it. It is shown only here.<br>Close this page when you are done.</p>
</main></body></html>`
}

/**
 * Pairs a new phone and returns everything needed to show it. Throws a plain sentence when the
 * PC has no address a phone could use.
 */
export function newPairing({ paths, config, interfaces, label }) {
  const auth = createAuth({ file: paths.phones })
  const addresses = listAddresses(interfaces)
  if (!phoneUrl(addresses, config.port, '', config.allow)) {
    throw new Error(
      config.allow.includes('lan')
        ? 'This PC has no network address. Connect it to Wi-Fi or a cable and try again.'
        : 'Tailscale is not connected on this PC. Open Tailscale, sign in, then try again (or run Install again).',
    )
  }
  const count = auth.list().length
  const { key, id, label: name } = auth.add(label || `Phone ${count + 1}`)
  return { key, id, label: name, url: phoneUrl(addresses, config.port, key, config.allow), tailscale: addresses.tailscale.length > 0 }
}

/**
 * Asks for the PIN (4 to 8 digits, typed twice) and saves it. A PIN that is already set can be kept by pressing Enter.
 * `RSP_PIN` in the environment sets it without asking (for automatic installs). Without `ask`, nothing is asked.
 */
export async function setupPin({ pin, ask, ui, env = {} }) {
  const had = pin.isSet()
  if (env.RSP_PIN) {
    if (!validPin(env.RSP_PIN)) ui.warn('RSP_PIN must be 4 to 8 digits, so no PIN was set.')
    else {
      pin.set(env.RSP_PIN)
      ui.ok('PIN set.')
    }
    return
  }
  if (!ask) {
    if (!had) ui.warn('No PIN is set. Double-click Set-PIN to add one.')
    return
  }
  ui.blank()
  ui.say('  Choose a PIN. The phone asks for it every time it opens the remote, so a stranger holding your unlocked phone cannot use it.')
  ui.say('  4 to 8 digits. Pick something you can remember (not 0000 or 1234).')
  for (let attempt = 0; attempt < 6; attempt++) {
    const first = (await ask(had ? '  New PIN (or press Enter to keep your current PIN): ' : '  Choose a PIN (or press Enter to skip, not recommended): ')).trim()
    if (!first) {
      if (had) ui.ok('Your current PIN stays.')
      else ui.warn('No PIN set. Double-click Set-PIN later to add one.')
      return
    }
    if (!validPin(first)) {
      ui.warn('A PIN is 4 to 8 digits, nothing else. Try again.')
      continue
    }
    if (isWeakPin(first)) {
      ui.warn('That is too easy to guess (like 0000 or 1234). Pick another.')
      continue
    }
    const second = (await ask('  Type it again: ')).trim()
    if (second !== first) {
      ui.warn('The two PINs were different. Try again.')
      continue
    }
    pin.set(first)
    ui.ok('PIN saved. The phone asks for it when it opens the remote.')
    return
  }
  ui.warn(had ? 'The PIN was not changed.' : 'No PIN set. Double-click Set-PIN later to add one.')
}

/** Waits until the program answers on this PC. */
export async function waitForHealth({ port, fetchFn = globalThis.fetch, sleep, tries = 30, gap = 1000 }) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchFn(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok && (await res.json()).app === 'remortstartpc') return true
    } catch {
      // Not up yet.
    }
    await sleep(gap)
  }
  return false
}

/** Installs Tailscale (winget, then a direct download) and signs in. Returns { ok, ip, exe }. */
export async function setupTailscale({ run, spawnFn, exists, ui, fetchFn, open, sleep, env, skip = false, downloadTo }) {
  if (skip) {
    ui.warn('Skipping Tailscale. The phone will only work on the same Wi-Fi.')
    return { ok: false, ip: '', exe: '' }
  }
  let exe = findTailscale(exists, env)
  if (exe) ui.ok('Tailscale is already installed.')
  else {
    ui.info('Installing Tailscale (the private link between your phone and this PC). This can take a minute...')
    await run('winget.exe', ['install', '-e', '--id', 'Tailscale.Tailscale', '--silent', '--accept-package-agreements', '--accept-source-agreements'], { timeout: 10 * 60_000 }).catch(() => {})
    exe = findTailscale(exists, env)
    if (!exe && downloadTo) {
      try {
        const file = await downloadTo('https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe', fetchFn)
        await run(file, ['/quiet'], { timeout: 10 * 60_000 })
      } catch {
        // Fall through to the manual message.
      }
      exe = findTailscale(exists, env)
    }
    if (!exe) {
      ui.warn('Tailscale could not be installed automatically. Install it from https://tailscale.com/download/windows, sign in, then run Install again.')
      return { ok: false, ip: '', exe: '' }
    }
    ui.ok('Tailscale installed.')
  }

  let status = { state: 'unknown', ip: '' }
  for (let i = 0; i < 15; i++) {
    status = await tailscaleStatus({ run, exe })
    if (status.state !== 'unknown' && status.state !== 'Starting') break
    await sleep(2000)
  }
  if (status.state !== 'Running') {
    ui.info('Signing in to Tailscale...')
    const ok = await loginTailscale({ spawnFn, run, exe, open, ui, sleep })
    status = await tailscaleStatus({ run, exe })
    if (!ok && status.state !== 'Running') {
      ui.warn('Tailscale is not signed in yet. Open Tailscale from the tray, sign in, then run Install again.')
      return { ok: false, ip: '', exe }
    }
  }
  // Keeps Tailscale connected even before anyone is signed in to Windows (needed when Windows starts in Xbox full-screen mode).
  await run(exe, ['set', '--unattended'], { timeout: 15_000 }).catch(() => {})
  ui.ok(`Tailscale is connected${status.ip ? ` (${status.ip})` : ''}.`)
  return { ok: true, ip: status.ip, exe }
}

/**
 * The whole install. Returns { ok, url } where url is the pairing link of the first phone (never logged).
 * Everything outside the program is injected: `run(file, args, opts)`, `spawnFn`, `exists`, ...
 */
export async function runSetup({
  source,
  paths,
  ui,
  run,
  spawnFn,
  exists = existsSync,
  fetchFn = globalThis.fetch,
  open,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  env = process.env,
  platform = process.platform,
  nodePath = process.execPath,
  interfaces,
  skipTailscale = false,
  downloadTo,
  showPairing,
  askLine,
}) {
  const TOTAL = 6
  const ps = (script, opts) => run('powershell.exe', psArgs(script), opts)
  const windows = platform === 'win32'
  let healthy = false

  ui.step(1, TOTAL, 'Putting the program in place')
  if (windows) await ps(stopRemoteScript).catch(() => {})
  const copied = syncApp(source, paths.app)
  ui.ok(copied ? `Program copied to ${paths.app}` : 'Program is already in place.')

  ui.step(2, TOTAL, 'Private link to your phone (Tailscale)')
  const ts = windows ? await setupTailscale({ run, spawnFn, exists, ui, fetchFn, open, sleep, env, skip: skipTailscale, downloadTo }) : { ok: false, ip: '', exe: '' }

  ui.step(3, TOTAL, 'Settings')
  const fresh = !existsSync(paths.config)
  const config = loadConfig(paths.config)
  if (fresh) config.allow = ts.ok ? ['loopback', 'tailscale'] : ['loopback', 'tailscale', 'lan']
  config.nodePath = nodePath
  mkdirSync(paths.home, { recursive: true })
  saveConfig(paths.config, config)
  writeFileSync(paths.launcher, launcherScript({ nodePath, entry: join(paths.app, 'bin', 'remote.mjs'), home: paths.home }))
  ui.ok(`Phone page on port ${config.port}. Allowed: ${config.allow.join(', ')}.`)
  await setupPin({ pin: createPin({ file: paths.pin }), ask: askLine, ui, env })
  if (!ts.ok && windows) ui.warn('Without Tailscale, the phone must be on the same Wi-Fi as this PC. Run Install again after setting up Tailscale to change that.')

  ui.step(4, TOTAL, 'Starting by itself at every sign-in')
  if (windows) {
    try {
      await configureFirewall({ run, config })
      ui.ok('Windows Firewall: the phone page is allowed (only from your own devices).')
    } catch {
      ui.warn('Could not change the Windows Firewall. If the phone cannot connect, run Install.cmd again and answer Yes to the administrator question.')
    }
    try {
      const how = (await ps(registerTaskScript(paths.launcher))).trim()
      ui.ok(how === 'task' ? `Scheduled task "${TASK_NAME}" created (also works in Xbox full-screen mode).` : 'Added to the Startup folder (starts after the desktop loads). Run Install.cmd as administrator for the better way.')
    } catch (err) {
      ui.warn(`Could not set up the automatic start: ${err.message}`)
    }
    try {
      await ps(shortcutsScript(paths.app))
      ui.ok('Start menu shortcuts added (search for Pair-Phone or Fix-It).')
    } catch {
      ui.warn('Could not add Start menu shortcuts. You can still use the .cmd files in the program folder.')
    }
  } else {
    ui.info('Not Windows: skipped the firewall, scheduled task and shortcuts.')
  }

  ui.step(5, TOTAL, 'Starting it now')
  if (windows) {
    await run('schtasks.exe', ['/run', '/tn', TASK_NAME]).catch(async () => {
      spawnFn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', paths.launcher], { detached: true, stdio: 'ignore', windowsHide: true }).unref?.()
    })
  }
  healthy = await waitForHealth({ port: config.port, fetchFn, sleep })
  if (healthy) ui.ok('The remote is running.')
  else ui.fail('The remote did not start. Double-click Fix-It to see why.')

  ui.step(6, TOTAL, 'Pairing your phone')
  let url = ''
  try {
    const pairing = newPairing({ paths, config, interfaces, label: 'Phone 1' })
    url = pairing.url
    await showPairing?.(pairing, config)
  } catch (err) {
    ui.warn(err.message)
  }
  return { ok: healthy && Boolean(url), url, healthy, tailscale: ts.ok }
}

/** Shows a pairing on the console and on screen. The link is a secret: it is printed, never logged. */
export async function showPairingOnScreen(pairing, { ui, tmp, writeFile = writeFileSync, open, sleep, removeFile = (f) => rmSync(f, { force: true }), waitMs = 10 * 60_000, waitForKey }) {
  ui.blank()
  ui.say('  On your phone: install Tailscale (App Store / Play Store) and sign in with the SAME account.')
  ui.say('  Then scan this code with the phone camera and tap the link:')
  ui.blank()
  ui.secret(qrToConsole(pairing.url))
  ui.blank()
  ui.secret(`  ${pairing.url}`)
  ui.blank()
  ui.say('  (A bigger code is opening in your browser. Do not share this link: it is the key to your PC.)')
  const file = join(tmp, `remortstartpc-pair-${pairing.id}.html`)
  writeFile(file, pairingPage({ url: pairing.url, label: `${pairing.label}: scan this with the phone camera`, tailscale: pairing.tailscale }))
  open(file)
  if (waitForKey) await waitForKey(waitMs)
  removeFile(file)
}

/** Removes pairing pages left behind (they contain a key). Called at the start of every install and pairing. */
export function cleanupPairingPages(dir, { readdir = readdirSync, remove = (f) => rmSync(f, { force: true }) } = {}) {
  let n = 0
  try {
    for (const f of readdir(dir)) {
      if (/^remortstartpc-pair-[0-9a-f]+\.html$/.test(f)) {
        remove(join(dir, f))
        n++
      }
    }
  } catch {
    // Nothing to clean.
  }
  return n
}
