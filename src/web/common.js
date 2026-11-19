'use strict'
// Shared by the main page and the Settings page: the pairing key and PIN session, calls to the PC, icons, looks.
// All text from the PC is put on the page with textContent, never as HTML.
const $ = (id) => document.getElementById(id)
let key = ''
let unlock = ''
let msgTimer = 0

try {
  const fromUrl = new URLSearchParams(location.search).get('k')
  if (fromUrl && /^[A-Za-z0-9_-]{20,64}$/.test(fromUrl)) {
    key = fromUrl
    localStorage.setItem('rsp_k', key)
  } else key = localStorage.getItem('rsp_k') || ''
} catch (e) {
  // Storage can be blocked (private mode); the key in the address still works.
  key = key || ''
}
try {
  unlock = localStorage.getItem('rsp_u') || ''
} catch (e) {
  unlock = ''
}

if (key) {
  // The home-screen shortcut must keep the key, so the manifest is asked for with it.
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/manifest.webmanifest?k=' + encodeURIComponent(key)
  document.head.append(link)
}

async function call(path, body) {
  // This header marks a call from our own page; the PC accepts the settings calls from itself without a key only with it.
  const h = { 'content-type': 'application/json', 'x-rsp-local': '1' }
  if (key) h.authorization = 'Bearer ' + key
  if (unlock) h['x-unlock'] = unlock
  const r = await fetch(path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) })
  if (r.status === 204) return null
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('json')) {
    if (!r.ok) throw Object.assign(new Error('Something went wrong'), { status: r.status })
    return r.blob()
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status, code: j.code })
  return j
}

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function say(text, bad) {
  const m = $('msg')
  m.textContent = text
  m.className = 'msg show' + (bad ? ' err' : '')
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => {
    m.className = 'msg' + (bad ? ' err' : '')
  }, bad ? 6000 : 3500)
}

// Small line icons, drawn here (no pictures to download).
const ICONS = {
  power: ['M12 3v8', 'M6.6 6.6a8 8 0 1 0 10.8 0'],
  lock: ['M5 11h14v9H5z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  screen: ['M3 5h18v11H3z', 'M9 20h6', 'M12 16v4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  restart: ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'],
  stop: ['M6 6l12 12', 'M18 6L6 18'],
  play: ['M8 5l11 7-11 7z'],
  prev: ['M6 5v14', 'M18 5l-9 7 9 7z'],
  next: ['M18 5v14', 'M6 5l9 7-9 7z'],
  voldown: ['M4 9h4l5-4v14l-5-4H4z', 'M16 10a3 3 0 0 1 0 4'],
  volup: ['M4 9h4l5-4v14l-5-4H4z', 'M16 10a3 3 0 0 1 0 4', 'M18.5 7.5a7 7 0 0 1 0 9'],
  mute: ['M4 9h4l5-4v14l-5-4H4z', 'M16 9l5 6', 'M21 9l-5 6'],
  bluetooth: ['M7 7l10 10-5 4V3l5 4L7 17'],
  speaker: ['M5 10v4h3l5 4V6L8 10z', 'M16 9.5a4 4 0 0 1 0 5'],
  leaf: ['M5 19c0-8 4-14 15-14 0 10-6 14-14 14z', 'M5 19l7-7'],
  balance: ['M12 4v16', 'M6 20h12', 'M5 8h14', 'M5 8l-3 7a3.5 3.5 0 0 0 6 0z', 'M19 8l-3 7a3.5 3.5 0 0 0 6 0z'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  download: ['M12 3v12', 'M7 11l5 5 5-5', 'M5 21h14'],
  gamepad: ['M6 9h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5 2l-1-2H8l-1 2a3 3 0 0 1-5-2v-2a4 4 0 0 1 4-4z', 'M8 11v3', 'M6.5 12.5h3'],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  terminal: ['M4 5h16v14H4z', 'M7 10l3 2-3 2', 'M12 15h5'],
  phone: ['M8 3h8v18H8z', 'M11 18h2'],
  laptop: ['M5 6h14v9H5z', 'M3 19h18'],
  pulse: ['M3 12h4l2-6 4 12 2-6h4'],
  wrench: ['M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z'],
  gear: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  back: ['M15 5l-7 7 7 7'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  chat: ['M4 5h16v11H9l-5 4z'],
  bug: ['M9 8a3 3 0 0 1 6 0v1H9z', 'M7 9h10v5a5 5 0 0 1-10 0z', 'M3 12h4', 'M17 12h4', 'M5 6l3 3', 'M19 6l-3 3', 'M5 19l3-3', 'M19 19l-3-3'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 20a8 8 0 0 1 16 0'],
}
function icon(name) {
  const ns = 'http:' + '//www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'i')
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    svg.append(p)
  }
  if (name === 'play') svg.firstChild.setAttribute('fill', 'currentColor')
  return svg
}

function section(iconName, title, hint) {
  const h = el('div', 'sec-h')
  h.append(icon(iconName), el('span', '', title))
  if (hint) h.append(el('small', '', hint))
  return h
}

const THEMES = [['neon', 'Neon'], ['tactical', 'Tactical'], ['clean', 'Clean']]
const ACCENT_THEME = { pink: 'neon', purple: 'neon', amber: 'tactical', red: 'tactical' }
function guessTheme(text) {
  return /ROG/i.test(text || '') ? 'neon' : /TUF/i.test(text || '') ? 'tactical' : 'clean'
}
// The choice of this phone for this PC wins, then the PC's setting, then what its model name suggests.
function themeOf(pc) {
  try {
    const mine = localStorage.getItem('rsp_theme:' + pc.name)
    if (THEMES.some((t) => t[0] === mine)) return mine
  } catch (e) {
    // Storage blocked: no saved choice.
  }
  if (THEMES.some((t) => t[0] === pc.theme)) return pc.theme
  if (ACCENT_THEME[pc.accent]) return ACCENT_THEME[pc.accent]
  return guessTheme(pc.model || pc.name)
}
function setTheme(name) {
  document.body.dataset.theme = name
}


// The PIN form, used by the main page and by the Settings page. `done()` runs after a correct PIN.
function makePinForm(message, done) {
  const box = el('form', 'pair panel')
  box.autocomplete = 'off'
  box.append(el('h1', '', 'Enter your PIN'))
  box.append(el('p', 'hint', 'The PIN you chose when you installed Remote Start PC on the PC.'))
  const input = el('input', 'pin')
  input.type = 'password'
  input.inputMode = 'numeric'
  input.pattern = '[0-9]*'
  input.maxLength = 8
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'PIN')
  const err = el('p', 'pinerr', message || '')
  const go = el('button', 'b go', 'Unlock')
  go.type = 'submit'
  box.append(input, go, err)
  box.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    go.disabled = true
    try {
      const j = await call('/api/unlock', { pin: input.value })
      unlock = j.token || ''
      try {
        localStorage.setItem('rsp_u', unlock)
      } catch (x) {
        // The PIN is asked again next time.
      }
      done()
    } catch (x) {
      input.value = ''
      err.textContent = x.message
    }
    go.disabled = false
  })
  setTimeout(() => input.focus(), 60)
  return box
}

// -- footer: ideas and feedback, and the copyright line ---------------------------------------------
// The drop-down opens a new GitHub issue with a few words already filled in (no personal information).
function footer(feedbackUrl, version, where) {
  const f = el('footer', 'foot')
  if (feedbackUrl && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/new$/.test(feedbackUrl)) {
    const box = el('div', 'fb')
    const head = el('button', 'fb-h')
    head.type = 'button'
    head.setAttribute('aria-expanded', 'false')
    head.append(icon('bulb'), el('span', '', 'Ideas, feedback or a bug?'), el('span', 'chev'))
    const list = el('div', 'fb-list')
    const choices = [
      ['bulb', 'Share an idea', 'enhancement', 'Idea: '],
      ['chat', 'Give feedback', 'feedback', 'Feedback: '],
      ['bug', 'Report a bug or glitch', 'bug', 'Bug: '],
    ]
    for (const [ic, label, tag, prefix] of choices) {
      const b = el('button', 'fb-i')
      b.type = 'button'
      b.append(icon(ic), el('span', '', label))
      b.addEventListener('click', () => {
        const body = '(Write here what you would like, or what went wrong and what you pressed.)\n\n---\nRemote PC version: ' + (version || 'unknown') + '\nPage: ' + where + '\nPlease do not paste your pairing link, PIN or any password.'
        const url = feedbackUrl + '?labels=' + encodeURIComponent(tag) + '&title=' + encodeURIComponent(prefix) + '&body=' + encodeURIComponent(body)
        window.open(url, '_blank', 'noopener')
      })
      list.append(b)
    }
    list.append(el('div', 'fb-note', 'Opens a form on GitHub (a free GitHub account is needed to send it).'))
    head.addEventListener('click', () => {
      const open = box.classList.toggle('open')
      head.setAttribute('aria-expanded', open ? 'true' : 'false')
    })
    box.append(head, list)
    f.append(box)
  }
  f.append(el('p', 'copy', '© 2026 Aswin K Santhosh. Open source under the MIT licence: free to use and share, with this copyright notice kept.'))
  return f
}

// After "Update App": wait 5 seconds, then reload as soon as the program answers again (it takes about 15 seconds to come back).
function reloadWhenBack() {
  say('Updating… the page refreshes by itself in about 5 seconds.')
  const started = Date.now()
  const poll = async () => {
    try {
      const r = await fetch('/health', { cache: 'no-store' })
      if (r.ok) {
        location.reload()
        return
      }
    } catch {
      // Still restarting: try again.
    }
    if (Date.now() - started < 90_000) setTimeout(poll, 2000)
    else say('Still restarting. Reload the page in a moment.', true)
  }
  setTimeout(poll, 5000)
}

// Copies text. The page is plain http (over Tailscale), where the modern clipboard call is not allowed, so a hidden text box and the old
// copy command are the fallback. Returns true when it worked.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) {
    // Fall through to the old way.
  }
  const t = document.createElement('textarea')
  t.value = text
  t.setAttribute('readonly', '')
  t.style.position = 'fixed'
  t.style.top = '0'
  t.style.left = '0'
  t.style.opacity = '0'
  document.body.append(t)
  t.focus()
  t.select()
  t.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch (e) {
    ok = false
  }
  t.remove()
  return ok
}
