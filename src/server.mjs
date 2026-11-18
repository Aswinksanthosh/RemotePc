/**
 * The phone page and its API. One small server, no outside connections.
 *
 *   GET  /                      the page (and its script, style and icons)
 *   GET  /health                {ok:true}, so the installer can tell the program is up
 *   GET  /manifest.webmanifest  makes "Add to Home Screen" keep the pairing key (see page)
 *   POST /api/state             everything the page shows              (needs a paired phone)
 *   POST /api/do                {action, arg, pc}: one button          (needs a paired phone)
 *   POST /api/avatar | /api/gameart   small pictures                   (needs a paired phone)
 *
 * Who can connect: only the networks in config.allow (this PC, Tailscale, optionally your home
 * network). A request must carry a paired phone's key in the Authorization header, never in a cookie,
 * so other websites cannot make a browser send it.
 */

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIONS } from './actions.mjs'
import { classifyAddress, isAllowedAddress } from './net.mjs'

const MAX_BODY = 2048

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/app.css': ['app.css', 'text/css; charset=utf-8', 'no-cache'],
  '/settings': ['settings.html', 'text/html; charset=utf-8', 'no-cache'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/boot.js': ['boot.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/common.js': ['common.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/icon.svg': ['icon.svg', 'image/svg+xml', 'public, max-age=3600'],
  '/icon-192.png': ['icon-192.png', 'image/png', 'public, max-age=3600'],
  '/icon-512.png': ['icon-512.png', 'image/png', 'public, max-age=3600'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png', 'public, max-age=3600'],
}

// The Settings page can also be opened ON the PC itself, with no phone key (but with the PIN, if one is set). Only for loopback, only for the
// settings calls, and only when the request really comes from that page: a custom header (a website cannot add one without being asked
// first) and a local Host / Origin (so a web page cannot reach it through a trick with names).
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/
const localOnly = (p) => p === '/api/unlock' || p.startsWith('/api/settings') || p.startsWith('/api/local/')
const isLocalPage = (req, ip) =>
  classifyAddress(ip) === 'loopback' &&
  req.headers['x-rsp-local'] === '1' &&
  LOCAL_HOST.test(String(req.headers.host ?? '')) &&
  (req.headers.origin === undefined || LOCAL_ORIGIN.test(String(req.headers.origin)))

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Too large.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('Bad request.'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(obj))
}

const sendPicture = (res, pic, maxAge) => {
  if (!pic) {
    res.writeHead(204, { 'cache-control': 'no-store' })
    return res.end()
  }
  res.writeHead(200, { 'content-type': pic.type, 'content-length': pic.bytes.length, 'cache-control': `private, max-age=${maxAge}`, 'x-content-type-options': 'nosniff' })
  return res.end(pic.bytes)
}

/**
 * `actions` is { run, info, avatar, gameArt } (the real PC) or null (a helper that only starts other PCs).
 * `others()` lists the PCs from pcs.json, `wake(pc)` sends the magic packet and `probe(pc)` says if a PC answers.
 */
export async function startServer({
  port = 8791,
  host = '0.0.0.0',
  allow = ['loopback', 'tailscale'],
  auth,
  pin = null,
  settings = null,
  pairing = null,
  actions = null,
  config = {},
  others = () => ({}),
  wake = async () => {
    throw new Error('Waking is not available here.')
  },
  probe = async () => false,
  webDir,
  version = '',
  issuesUrl = '',
}) {
  const files = new Map()
  for (const [path, [file, type, cache]] of Object.entries(STATIC)) {
    try {
      files.set(path, { body: readFileSync(join(webDir, file)), type, cache })
    } catch {
      // A missing icon only means a plainer home-screen shortcut; the page itself is checked below.
      if (path === '/' || path === '/app.js' || path === '/app.css') throw new Error(`The page file ${file} is missing from ${webDir}.`)
    }
  }
  const knownActions = new Set(ACTIONS)

  // A typed PIN gives this phone a session token for config.pinHours; it also stops working when the PIN changes.
  const unlocks = new Map() // token -> { id, version, expires }
  const unlocked = (token, id) => {
    const u = unlocks.get(String(token ?? ''))
    if (!u) return false
    if (u.expires <= Date.now() || u.version !== pin.version()) {
      unlocks.delete(token)
      return false
    }
    // A token belongs to one phone. Another phone trying it is refused, and does not end the owner's session.
    return u.id === id
  }

  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress
    if (!isAllowedAddress(ip, allow)) return json(res, 403, { error: 'This network is not allowed.' })
    try {
      const url = new URL(req.url ?? '/', 'http://pc')
      const path = url.pathname

      if (req.method === 'GET') {
        if (path === '/health') return json(res, 200, { ok: true, app: 'remortstartpc', version })
        if (path === '/manifest.webmanifest') {
          const key = url.searchParams.get('k') ?? ''
          const paired = /^[A-Za-z0-9_-]{20,64}$/.test(key) && auth.verify(ip, key).ok
          return json(
            res,
            200,
            {
              name: 'Remote PC',
              short_name: 'Remote',
              start_url: paired ? `/?k=${key}` : '/',
              scope: '/',
              display: 'standalone',
              background_color: '#0b1016',
              theme_color: '#0b1016',
              icons: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
              ],
            },
            { 'content-type': 'application/manifest+json' },
          )
        }
        const f = files.get(path)
        if (!f) return json(res, 404, { error: 'Not found.' })
        const headers = { 'content-type': f.type, 'cache-control': f.cache, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
        if (path === '/' || path === '/settings') Object.assign(headers, { 'content-security-policy': CSP, 'x-frame-options': 'DENY' })
        res.writeHead(200, headers)
        return res.end(f.body)
      }

      if (req.method !== 'POST' || !path.startsWith('/api/')) return json(res, 404, { error: 'Not found.' })

      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
      const who = !bearer && localOnly(path) && isLocalPage(req, ip) ? { ok: true, id: 'local', local: true } : auth.verify(ip, bearer)
      if (!who.ok) return json(res, who.status, { error: who.error })
      const body = await readBody(req)

      if (path === '/api/unlock') {
        if (!pin?.isSet()) return json(res, 200, { token: '' })
        const r = pin.verify(ip, body.pin)
        if (!r.ok) return json(res, r.status, { error: r.error })
        const t = Date.now()
        for (const [k, u] of unlocks) if (u.expires <= t) unlocks.delete(k)
        while (unlocks.size >= 50) unlocks.delete(unlocks.keys().next().value)
        const token = randomBytes(24).toString('base64url')
        unlocks.set(token, { id: who.id, version: pin.version(), expires: t + (Number(config.pinHours) || 12) * 3600 * 1000 })
        return json(res, 200, { token })
      }
      if (pin?.isSet() && !unlocked(req.headers['x-unlock'], who.id)) return json(res, 401, { error: 'Enter your PIN.', code: 'pin' })

      if (path === '/api/state') {
        // If reading the PC's details fails, the page still opens with the buttons (and the problem is in the log).
        const info = actions
          ? await actions.info().catch((err) => {
              console.error('[remote] could not read the PC details:', err)
              return { name: '' }
            })
          : { name: '' }
        const list = others()
        const pcs = await Promise.all(
          Object.entries(list).map(async ([key, d]) => ({
            key,
            name: d.label,
            canWake: Boolean(d.mac),
            page: d.page,
            theme: d.theme,
            order: d.order,
            online: d.page ? await probe(d) : null,
          })),
        )
        return json(res, 200, {
          pc: actions ? { ...info, name: config.name || info.name || 'This PC', accent: config.accent ?? '', theme: config.theme ?? '', order: config.order ?? 0, control: true } : { name: config.name || 'Helper', accent: config.accent ?? '', theme: config.theme ?? '', order: config.order ?? 0, control: false },
          others: pcs,
          phones: auth.list().map((p) => ({ id: p.id, label: p.label, current: p.id === who.id, lastSeen: p.lastSeen, connected: p.connected })),
          version,
          feedback: issuesUrl,
        })
      }

      if (path === '/api/local/pair') {
        // Shown only on the PC's own screen: the link is the key to the PC.
        if (!who.local || !pairing) return json(res, 403, { error: 'Open this page on the PC itself to add a phone.' })
        try {
          return json(res, 200, await pairing())
        } catch (err) {
          return json(res, 400, { error: String(err?.message ?? err).slice(0, 200) })
        }
      }

      if (path.startsWith('/api/settings')) {
        if (!settings) return json(res, 404, { error: 'No settings here.' })
        try {
          if (path === '/api/settings') return json(res, 200, { ...(await settings.get()), feedback: issuesUrl })
          if (path === '/api/settings/save') {
            const r = settings.save(body.changes)
            return json(res, 200, { ...r, message: r.restart ? 'Saved. This one applies after the program restarts (use Restart in Settings, About).' : 'Saved.' })
          }
          if (path === '/api/settings/restart') {
            if (!actions) return json(res, 400, { error: 'Nothing to restart here.' })
            return json(res, 200, { message: await actions.run('restart_remote') })
          }
          if (path === '/api/settings/tool') {
            // Opens a window on the PC itself, so only the PC's own Settings page may ask (never a phone).
            if (!who.local) return json(res, 403, { error: 'Open Settings on the PC itself to use this.' })
            return json(res, 200, { message: await settings.openTool(String(body.tool ?? '')) })
          }
          // Owner decision (2026-11-18): a paired phone may add and remove apps, picking from the laptop's own Start menu list.
          if (path === '/api/settings/startapps') return json(res, 200, { names: await settings.startApps() })
          if (path === '/api/settings/apps') return json(res, 200, settings.apps(body))
          if (path === '/api/settings/sensors') return json(res, 200, { lines: await settings.sensors() })
          if (path === '/api/settings/task') return json(res, 200, { state: await settings.setTask(body.on === true) })
          if (path === '/api/settings/pin') {
            const r = settings.changePin(ip, String(body.current ?? ''), String(body.next ?? ''))
            // A new PIN ends every PIN session, including this phone's: it has to type the new one.
            return json(res, 200, { result: r, message: r === 'removed' ? 'The PIN was removed.' : 'The PIN was changed. Type it again on the phone pages.' })
          }
        } catch (err) {
          return json(res, err?.status ?? 400, { error: String(err?.message ?? err).slice(0, 200) })
        }
        return json(res, 404, { error: 'Not found.' })
      }

      if (path === '/api/avatar') return sendPicture(res, actions ? await actions.avatar() : null, 60)
      if (path === '/api/gameart') return sendPicture(res, actions ? await actions.gameArt(String(body.game ?? '').slice(0, 100)) : null, 300)

      if (path === '/api/do') {
        const action = String(body.action ?? '')
        const arg = typeof body.arg === 'string' ? body.arg.slice(0, 100) : undefined
        try {
          if (action === 'wake') {
            const pc = others()[String(body.pc ?? '').toLowerCase()]
            if (!pc?.mac) return json(res, 400, { error: 'That PC has no wake-up address.' })
            await wake(pc)
            return json(res, 200, { message: `Wake-up signal sent to ${pc.label}. Give it up to a minute.` })
          }
          if (action === 'forget_phone') {
            const n = auth.forget(String(arg ?? ''))
            return json(res, 200, { message: n ? 'That phone was forgotten.' : 'That phone was not found.' })
          }
          if (!actions) return json(res, 400, { error: 'This device only starts other PCs.' })
          if (!knownActions.has(action)) return json(res, 400, { error: 'Unknown action.' })
          return json(res, 200, { message: (await actions.run(action, arg)) ?? 'Done.' })
        } catch (err) {
          return json(res, 502, { error: String(err?.message ?? err).slice(0, 200) })
        }
      }

      return json(res, 404, { error: 'Not found.' })
    } catch (err) {
      return json(res, err?.status ?? 500, { error: err?.status ? err.message : 'Something went wrong.' })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }
}
