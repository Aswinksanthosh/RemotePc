'use strict'
// The phone page. All text that comes from the PC is put on the page with textContent, never as HTML.
const $ = (id) => document.getElementById(id)
let key = ''
let data = null
let timer = 0
let msgTimer = 0
let lastSig = ''
let offline = false
let fails = 0
let needPin = false
let unlock = ''
const opened = new Set()
const picked = { game: '', out: '' }
const avatars = {}
const arts = {}

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
  const h = { 'content-type': 'application/json' }
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

async function act(action, arg, extra) {
  say('Sending…')
  try {
    const j = await call('/api/do', Object.assign({ action, arg }, extra || {}))
    say(j.message || 'Done.')
  } catch (err) {
    if (err.status === 401 && err.code === 'pin') {
      unlock = ''
      pinScreen('Your PIN session ended. Enter it again.')
      return
    }
    say(err.message, true)
  }
  setTimeout(refresh, 3000)
}

// -- buttons --------------------------------------------------------------------------

const HOLD_MS = 800
function ping(b) {
  b.classList.remove('ping')
  void b.offsetWidth
  b.classList.add('ping')
}

// A button with a "sure" text must be HELD to fire; a quick tap only shows a hint.
function btn(label, fn, disabled, sure, cls) {
  const b = el('button', 'b' + (cls ? ' ' + cls : '') + (sure ? ' hold' : ''), label)
  b.type = 'button'
  b.disabled = !!disabled
  if (!sure) {
    b.addEventListener('click', () => {
      ping(b)
      fn()
    })
    return b
  }
  b.title = 'Hold to confirm'
  b.setAttribute('aria-label', label + ' (hold to confirm)')
  let t = 0
  const start = () => {
    if (b.disabled || t) return
    b.classList.add('holding')
    t = setTimeout(() => {
      t = 0
      b.classList.remove('holding')
      ping(b)
      if (navigator.vibrate) navigator.vibrate(25)
      fn()
    }, HOLD_MS)
  }
  const stop = () => {
    if (t) {
      clearTimeout(t)
      t = 0
      b.classList.remove('holding')
      say('Keep holding to confirm: ' + sure)
    }
  }
  b.addEventListener('pointerdown', (e) => {
    if (!e.button) start()
  })
  for (const n of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(n, stop)
  b.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault()
      start()
    }
  })
  b.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') stop()
  })
  b.addEventListener('blur', stop)
  b.addEventListener('contextmenu', (e) => e.preventDefault())
  b.addEventListener('click', (e) => e.preventDefault())
  return b
}

// Press and hold, then slide to an option and let go to pick it. A quick tap opens the menu so you can tap an option.
function slideMenu(trigger, getItems) {
  const HOLD = 260
  let t = 0
  let mode = ''
  let menu = null
  let dim = null
  let els = []
  let items = []
  let hi = -1
  function mark(i) {
    if (i === hi) return
    hi = i
    els.forEach((x, j) => x.classList.toggle('on', j === i))
    if (i >= 0 && navigator.vibrate) navigator.vibrate(8)
  }
  function hit(x, y) {
    const n = document.elementFromPoint(x, y)
    const it = n && n.closest ? n.closest('.sm-item') : null
    return it && menu && menu.contains(it) ? els.indexOf(it) : -1
  }
  function close() {
    clearTimeout(t)
    t = 0
    if (menu) menu.remove()
    if (dim) dim.remove()
    menu = null
    dim = null
    els = []
    items = []
    hi = -1
    mode = ''
    trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onOutside, true)
  }
  function choose(i) {
    const it = items[i]
    close()
    if (it && it.run) it.run()
  }
  function onKey(e) {
    if (!menu) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      trigger.focus()
      return
    }
    const k = els.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      els[(k + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length].focus()
    }
    if ((e.key === 'Enter' || e.key === ' ') && k >= 0) {
      e.preventDefault()
      choose(k)
    }
  }
  function onOutside(e) {
    if (mode === 'tap' && menu && !menu.contains(e.target) && !trigger.contains(e.target)) close()
  }
  function build(m) {
    items = getItems()
    if (!items.length) return
    mode = m
    dim = el('div', 'sm-dim')
    menu = el('div', 'smenu')
    menu.setAttribute('role', 'menu')
    items.forEach((it, i) => {
      const x = el('div', 'sm-item' + (it.danger ? ' danger' : ''))
      x.setAttribute('role', 'menuitem')
      x.tabIndex = -1
      x.append(el('span', '', it.label))
      if (it.hint) x.append(el('small', '', it.hint))
      x.addEventListener('click', () => {
        if (mode === 'tap') choose(i)
      })
      els.push(x)
      menu.append(x)
    })
    document.body.append(dim, menu)
    const r = trigger.getBoundingClientRect()
    const w = menu.offsetWidth
    const h = menu.offsetHeight
    const left = Math.min(Math.max(12, r.right - w), window.innerWidth - w - 12)
    let top = r.bottom + 8
    if (top + h > window.innerHeight - 20) top = Math.max(12, r.top - h - 8)
    menu.style.left = left + 'px'
    menu.style.top = top + 'px'
    trigger.setAttribute('aria-expanded', 'true')
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onOutside, true)
    if (navigator.vibrate) navigator.vibrate(12)
  }
  trigger.classList.add('sm-trig')
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.addEventListener('pointerdown', (e) => {
    if (e.button || trigger.disabled) return
    if (menu && mode === 'tap') {
      close()
      return
    }
    try {
      trigger.setPointerCapture(e.pointerId)
    } catch (x) {
      // Not every browser allows it.
    }
    document.body.dataset.gesture = '1'
    t = setTimeout(() => {
      t = 0
      build('hold')
    }, HOLD)
  })
  trigger.addEventListener('pointermove', (e) => {
    if (menu && mode === 'hold') mark(hit(e.clientX, e.clientY))
  })
  trigger.addEventListener('pointerup', (e) => {
    delete document.body.dataset.gesture
    if (t) {
      clearTimeout(t)
      t = 0
      build('tap')
      return
    }
    if (menu && mode === 'hold') choose(hit(e.clientX, e.clientY))
  })
  trigger.addEventListener('pointercancel', () => {
    delete document.body.dataset.gesture
    clearTimeout(t)
    t = 0
    if (mode === 'hold') close()
  })
  trigger.addEventListener('contextmenu', (e) => e.preventDefault())
  trigger.addEventListener('click', (e) => {
    if (e.detail === 0 && !trigger.disabled) {
      build('tap')
      if (els[0]) els[0].focus()
    }
  })
  return trigger
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
  gamepad: ['M6 9h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5 2l-1-2H8l-1 2a3 3 0 0 1-5-2v-2a4 4 0 0 1 4-4z', 'M8 11v3', 'M6.5 12.5h3'],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  terminal: ['M4 5h16v14H4z', 'M7 10l3 2-3 2', 'M12 15h5'],
  phone: ['M8 3h8v18H8z', 'M11 18h2'],
  laptop: ['M5 6h14v9H5z', 'M3 19h18'],
  pulse: ['M3 12h4l2-6 4 12 2-6h4'],
  wrench: ['M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z'],
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

// A big square button with an icon above its label. Same hold-to-confirm rules as btn().
function tile(name, label, fn, opts) {
  const o = opts || {}
  const b = btn(label, fn, o.disabled, o.sure, 'tile' + (o.cls ? ' ' + o.cls : ''))
  b.textContent = ''
  b.append(icon(name), el('span', '', label))
  return b
}

function section(iconName, title, hint) {
  const h = el('div', 'sec-h')
  h.append(icon(iconName), el('span', '', title))
  if (hint) h.append(el('small', '', hint))
  return h
}

function acc(id, title, content, iconName) {
  const d = el('div', 'acc' + (opened.has(id) ? ' open' : ''))
  const h = el('button', 'acc-h')
  h.type = 'button'
  if (iconName) h.append(icon(iconName))
  h.append(el('span', '', title), el('span', 'chev'))
  h.setAttribute('aria-expanded', opened.has(id) ? 'true' : 'false')
  const b = el('div', 'acc-b')
  const inner = el('div', 'acc-in')
  inner.append(content)
  b.append(inner)
  h.addEventListener('click', () => {
    const o = d.classList.toggle('open')
    h.setAttribute('aria-expanded', o ? 'true' : 'false')
    if (o) opened.add(id)
    else opened.delete(id)
  })
  d.append(h, b)
  return d
}

function dropdown(options, value, onPick, disabled, keepLabel, onOpen) {
  const dd = el('div', 'dd')
  const b = el('button', 'dd-btn')
  b.type = 'button'
  b.disabled = !!disabled
  const label = el('span', '', value || 'Nothing here yet')
  b.append(label, el('span', 'chev'))
  const ul = el('ul', 'dd-list')
  ul.setAttribute('role', 'listbox')
  for (const o of options) {
    const li = el('li', o === value ? 'sel' : '')
    li.setAttribute('role', 'option')
    li.append(el('span', '', o))
    li.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!keepLabel) {
        label.textContent = o
        for (const x of ul.children) x.classList.remove('sel')
        li.classList.add('sel')
      }
      dd.classList.remove('open')
      onPick(o)
    })
    ul.append(li)
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    const o = !dd.classList.contains('open')
    for (const x of document.querySelectorAll('.dd.open')) x.classList.remove('open')
    if (o) {
      dd.classList.add('open')
      if (onOpen) onOpen()
    }
  })
  dd.append(b, ul)
  return dd
}
document.addEventListener('click', () => {
  for (const x of document.querySelectorAll('.dd.open')) x.classList.remove('open')
})

// -- confirm box ------------------------------------------------------------------------

let askFn = null
function confirmBox(title, text, label, fn, danger) {
  $('asktitle').textContent = title
  $('asktext').textContent = text
  $('askgo').textContent = label
  $('askgo').classList.toggle('danger', !!danger)
  askFn = fn
  $('ask').hidden = false
  setTimeout(() => $('askcancel').focus(), 60)
}
function closeAsk() {
  $('ask').hidden = true
  askFn = null
}
$('askcancel').addEventListener('click', closeAsk)
$('askgo').addEventListener('click', () => {
  const f = askFn
  closeAsk()
  if (f) f()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('ask').hidden) closeAsk()
})

// -- pictures (fetched with the key, shown as local blobs, so no outside request is ever made) --

async function ensureAvatar(av, id) {
  if (avatars[id]) {
    av.style.backgroundImage = 'url("' + avatars[id] + '")'
    av.textContent = ''
    return
  }
  if (avatars[id] !== undefined) return
  avatars[id] = ''
  try {
    const blob = await call('/api/avatar')
    if (blob) {
      avatars[id] = URL.createObjectURL(blob)
      for (const a of document.querySelectorAll('.avatar')) {
        a.style.backgroundImage = 'url("' + avatars[id] + '")'
        a.textContent = ''
      }
    }
  } catch (e) {
    delete avatars[id]
  }
}
async function ensureGameArt(node, game, has) {
  if (!has) return
  if (arts[game]) {
    node.style.backgroundImage = 'url("' + arts[game] + '")'
    return
  }
  if (arts[game] !== undefined) return
  arts[game] = ''
  try {
    const blob = await call('/api/gameart', { game })
    if (blob) {
      arts[game] = URL.createObjectURL(blob)
      node.style.backgroundImage = 'url("' + arts[game] + '")'
    }
  } catch (e) {
    delete arts[game]
  }
}

// -- the page ---------------------------------------------------------------------------

function accentOf(pc) {
  if (pc.accent) return pc.accent
  const m = pc.model || ''
  return /ROG/i.test(m) ? 'pink' : /TUF/i.test(m) ? 'amber' : 'blue'
}

function pinScreen(message) {
  needPin = true
  data = null
  lastSig = ''
  $('banner').hidden = true
  const app = $('app')
  app.textContent = ''
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
      needPin = false
      $('app').textContent = ''
      $('app').append(el('p', 'loading', 'Connecting to your PC…'))
      refresh()
    } catch (x) {
      input.value = ''
      err.textContent = x.message
    }
    go.disabled = false
  })
  app.append(box)
  setTimeout(() => input.focus(), 60)
}

function pairScreen(bad) {
  const app = $('app')
  app.textContent = ''
  const box = el('div', 'pair panel')
  box.append(el('h1', '', bad ? 'Pair this phone again' : 'Pair this phone'))
  box.append(el('p', '', bad ? 'This phone is not paired any more, or its link is old.' : 'This phone is not paired with a PC yet.'))
  const ol = el('ol')
  ol.append(el('li', '', 'On your PC, double-click Pair-Phone (it is in the RemortStartPc folder, or search for it in the Start menu).'))
  ol.append(el('li', '', 'Scan the QR code it shows with this phone’s camera.'))
  ol.append(el('li', '', 'Tap the link. This page opens and stays paired.'))
  box.append(ol)
  box.append(el('p', 'hint', 'Phone and PC must both be signed in to Tailscale (or on the same Wi-Fi if you chose that).'))
  app.append(box)
}

function unreachableScreen() {
  const app = $('app')
  app.textContent = ''
  const box = el('div', 'pair panel')
  box.append(el('h1', '', 'Cannot reach the PC'))
  const ol = el('ol')
  ol.append(el('li', '', 'Is the PC on, and signed in to Windows? A sleeping or turned-off PC cannot answer.'))
  ol.append(el('li', '', 'Is Tailscale turned on, on this phone?'))
  ol.append(el('li', '', 'Still stuck? On the PC, double-click Fix-It. It tells you what is wrong.'))
  box.append(ol)
  const row = el('div', 'row')
  row.append(btn('Try again', refresh, false, undefined, 'go'))
  box.append(row)
  app.append(box)
}

function rowOf(...kids) {
  const r = el('div', 'row')
  r.append(...kids)
  return r
}

function render() {
  const pc = data.pc
  const app = $('app')
  document.body.dataset.accent = accentOf(pc)
  app.textContent = ''
  const p = el('div', 'panel')
  const helper = !pc.control
  const run = (action, arg) => () => act(action, arg)

  // -- top: name, status, power menu ----------------------------------------------------
  const top = el('div', 'top on')
  const txt = el('div', 'txt')
  txt.append(el('h1', '', pc.name))
  const chip = el('div', 'chip')
  chip.append(el('span', 'dot'), el('span', '', helper ? 'helper (starts other PCs)' : 'online'))
  txt.append(chip)
  const bits = [pc.model, data.version ? 'version ' + data.version : ''].filter(Boolean).join('  ·  ')
  if (bits) txt.append(el('div', 'model', bits))
  top.append(txt)
  if (!helper) {
    const pwr = el('button', 'b pwr')
    pwr.type = 'button'
    pwr.title = 'Power: hold and slide, or tap'
    pwr.setAttribute('aria-label', 'Power menu')
    pwr.append(icon('power'))
    slideMenu(pwr, () => [
      { label: 'Lock', run: run('lock') },
      { label: 'Screen off', run: run('screen_off') },
      { label: 'Cancel turn off', hint: 'stops a waiting turn off or restart', run: run('shutdown_cancel') },
      { label: 'Sleep', hint: 'unreachable until woken', run: () => confirmBox('Sleep the PC?', 'A sleeping PC cannot be reached from the phone until you wake it.', 'Sleep', run('sleep')) },
      { label: 'Restart', hint: 'comes back by itself', run: () => confirmBox('Restart the PC?', 'It restarts in 10 seconds and comes back by itself.', 'Restart', run('restart'), true) },
      { label: 'Turn off', hint: 'stays off until started', danger: true, run: () => confirmBox('Turn off the PC?', 'It turns off in 15 seconds and stays off until you start it again.', 'Turn off', run('shutdown'), true) },
    ])
    top.append(pwr)
  }
  p.append(top)

  if (!helper) {
    // -- quick actions -------------------------------------------------------------------
    const quick = el('div', 'card')
    quick.append(section('power', 'Quick actions'))
    const g = el('div', 'grid3')
    g.append(
      tile('lock', 'Lock', run('lock')),
      tile('screen', 'Screen off', run('screen_off')),
      tile('moon', 'Sleep', run('sleep'), { sure: 'Sleep the PC?' }),
      tile('restart', 'Restart', run('restart'), { sure: 'Restart the PC?' }),
      tile('power', 'Turn off', run('shutdown'), { sure: 'Turn off the PC?', cls: 'dangerous' }),
      tile('stop', 'Cancel off', run('shutdown_cancel')),
    )
    quick.append(g)
    p.append(quick)

    // -- steam ---------------------------------------------------------------------------
    const games = pc.games || []
    const st = pc.steam
    if (st || games.length) {
      if (!games.includes(picked.game)) picked.game = games[0] || ''
      const steam = el('div', 'steam')
      steam.append(section('gamepad', 'Steam'))
      const head = el('div', 'sh')
      const t = el('div', 'txt')
      if (st && st.user) {
        const av = el('div', 'avatar', st.user.charAt(0).toUpperCase())
        head.append(av)
        if (st.avatar) ensureAvatar(av, st.id)
        t.append(el('div', 'who', st.user), el('div', 'unk', 'Steam profile'))
      } else t.append(el('div', 'unk', 'No Steam user found'))
      if (st && st.playing) t.append(el('div', 'now', 'Now playing: ' + st.playing))
      head.append(t)
      steam.append(head)
      const accs = (st && st.accounts) || []
      if (accs.length > 1) {
        const labels = accs.map((a) => a.name + (a.id === st.id ? ' (signed in)' : ''))
        const uniq = labels.map((l, i) => (labels.indexOf(l) === i ? l : l + ' · ' + accs[i].id.slice(-4)))
        steam.append(
          dropdown(uniq, 'Switch Steam account', (v) => {
            const a = accs[uniq.indexOf(v)]
            if (!a || a.id === st.id) return
            confirmBox('Switch Steam account?', 'Steam closes and starts again as ' + a.name + '. A running game closes.', 'Switch', () => act('steam_switch', a.id))
          }, false, true),
        )
      }
      const ban = el('div', 'gbanner')
      const img = el('div', 'gimg')
      const gdd = dropdown(games, picked.game, (v) => {
        picked.game = v
        img.style.backgroundImage = ''
        ensureGameArt(img, v, (pc.gameArt || []).includes(v))
      })
      gdd.classList.add('gdd')
      ban.append(img, gdd)
      ensureGameArt(img, picked.game, (pc.gameArt || []).includes(picked.game))
      steam.append(ban)
      steam.append(rowOf(btn('Start game', () => act('steam_game', picked.game), !games.length, undefined, 'go'), btn('Close game', run('close_game'), false, 'Close the running game?')))
      steam.append(rowOf(btn('Open Steam', run('steam_open')), btn('Big Picture', run('steam_bigpicture'))))
      p.append(steam)
    }

    // -- media ---------------------------------------------------------------------------
    const media = el('div', 'card')
    media.append(section('play', 'Media'))
    const tr = el('div', 'transport')
    const mk = (name, action, cls, label) => {
      const b = btn(label, run(action), false, undefined, cls)
      b.textContent = ''
      b.append(icon(name))
      return b
    }
    tr.append(mk('prev', 'media_prev', '', 'Previous'), mk('play', 'media_playpause', 'go main', 'Play or pause'), mk('next', 'media_next', '', 'Next'))
    media.append(tr)
    const vol = el('div', 'vol')
    vol.append(tile('voldown', 'Vol -', run('volume_down'), { cls: 'small' }), tile('mute', 'Mute', run('mute'), { cls: 'small' }), tile('volup', 'Vol +', run('volume_up'), { cls: 'small' }))
    media.append(vol)
    p.append(media)

    // -- bluetooth devices -----------------------------------------------------------------
    const heads = pc.headphones || []
    const bt = el('div', 'card')
    bt.append(section('bluetooth', 'Bluetooth devices', heads.length ? 'paired with this PC' : ''))
    if (!heads.length) bt.append(el('div', 'empty', 'No paired Bluetooth devices found. Pair your earbuds with this PC in Windows first.'))
    else {
      const list = el('div', 'list')
      for (const name of heads) {
        const item = el('div', 'item stack')
        const ic = el('div', 'ic')
        ic.append(icon('bluetooth'))
        item.append(ic, el('div', 'nm', name))
        const acts = el('div', 'acts')
        acts.append(btn('Connect', () => act('bt_connect', name), false, undefined, 'go'), btn('Disconnect', () => act('bt_disconnect', name)))
        item.append(acts)
        list.append(item)
      }
      bt.append(list)
      bt.append(el('div', 'note', 'Earbuds must be in range and not busy with another device. Disconnect frees them for your phone.'))
    }
    p.append(bt)

    // -- sound output ----------------------------------------------------------------------
    const outs = pc.outputs || []
    const snd = el('div', 'card')
    snd.append(section('speaker', 'Sound output', 'where sound plays'))
    if (!outs.length) snd.append(el('div', 'empty', 'No sound outputs found.'))
    else {
      const list = el('div', 'list')
      for (const name of outs) {
        const o = el('button', 'opt' + (picked.out === name ? ' on' : ''))
        o.type = 'button'
        const ic = el('span', 'ic')
        ic.append(icon(/blue|buds|pods|head/i.test(name) ? 'bluetooth' : 'speaker'))
        o.append(ic, el('span', 'nm', name), el('span', 'tick'))
        o.addEventListener('click', () => {
          picked.out = name
          for (const x of list.children) x.classList.toggle('on', x === o)
          act('audio_set', name)
        })
        list.append(o)
      }
      snd.append(list)
      snd.append(el('div', 'note', 'Bluetooth earbuds appear here once they are connected.'))
    }
    p.append(snd)

    // -- power mode ------------------------------------------------------------------------
    const mode = el('div', 'card')
    mode.append(section('bolt', 'Power mode', 'Windows'))
    const seg = el('div', 'seg')
    for (const [k, label, ic] of [['saver', 'Efficiency', 'leaf'], ['balanced', 'Balanced', 'balance'], ['gaming', 'Performance', 'bolt']]) {
      seg.append(tile(ic, label, run('mode_' + k), { cls: pc.mode === k ? 'on' : '' }))
    }
    mode.append(seg)
    mode.append(el('div', 'note', 'Efficiency for downloads, Performance for games.'))
    p.append(mode)

    // -- apps and your own buttons ---------------------------------------------------------
    const apps = pc.apps || []
    if (apps.length) {
      const card = el('div', 'card')
      card.append(section('grid', 'Apps'))
      const g2 = el('div', 'apps')
      for (const name of apps) {
        const b = btn(name, () => act('app', name), false, undefined, 'tile')
        b.textContent = ''
        b.append(el('div', 'letter', name.charAt(0).toUpperCase()), el('span', '', name))
        g2.append(b)
      }
      card.append(g2)
      p.append(card)
    }
    if ((pc.buttons || []).length) {
      const card = el('div', 'card')
      card.append(section('terminal', 'My buttons', 'hold to run'))
      const g2 = el('div', 'grid2')
      for (const name of pc.buttons) g2.append(tile('terminal', name, () => act('button', name), { sure: 'Run "' + name + '"?', cls: 'small' }))
      card.append(g2)
      p.append(card)
    }
  }

  // -- system, other PCs, phones -----------------------------------------------------------
  const sys = el('div', 'card')
  sys.append(section('wrench', 'System'))
  const parts = []
  if (!helper) {
    const g = el('div', 'grid3')
    g.append(tile('pulse', 'Status', run('status'), { cls: 'small' }), tile('restart', 'Restart remote', run('restart_remote'), { sure: 'Restart the remote on this PC?', cls: 'small' }), tile('bolt', 'Update', run('update'), { sure: 'Update this app and restart it?', cls: 'small' }))
    sys.append(g)
  }
  const others = data.others || []
  if (others.length) {
    const list = el('div', 'list')
    for (const o of others) {
      const item = el('div', 'item')
      const ic = el('div', 'ic')
      ic.append(icon('laptop'))
      const nm = el('div', 'nm', o.name)
      nm.append(el('small', '', o.online === true ? 'on' : o.online === false ? 'not answering' : ''))
      item.append(ic, nm)
      const acts = el('div', 'acts')
      if (o.canWake) acts.append(btn('Start', () => act('wake', undefined, { pc: o.key }), false, undefined, 'go'))
      if (o.page) acts.append(btn('Open', () => { location.href = o.page }))
      item.append(acts)
      list.append(item)
    }
    parts.push(acc('others', 'Other PCs', list, 'laptop'))
  }
  const phones = data.phones || []
  const plist = el('div', 'list')
  for (const ph of phones) {
    const item = el('div', 'item')
    const ic = el('div', 'ic')
    ic.append(icon('phone'))
    item.append(ic, el('div', 'nm', ph.label + (ph.current ? ' (this phone)' : '')))
    const acts = el('div', 'acts')
    acts.append(btn('Forget', () => act('forget_phone', ph.id), false, 'Forget ' + ph.label + '?'))
    item.append(acts)
    plist.append(item)
  }
  plist.append(el('div', 'note', 'To add another phone, double-click Pair-Phone on the PC and scan its QR code.'))
  parts.push(acc('phones', 'Paired phones', plist, 'phone'))
  for (const x of parts) sys.append(x)
  p.append(sys)
  app.append(p)

  // -- the switch bar: only when other PCs have a page of their own (your friend, with one PC, never sees it) --
  const nav = $('nav')
  const withPage = others.filter((o) => o.page)
  nav.textContent = ''
  nav.hidden = !withPage.length
  document.body.classList.toggle('has-nav', withPage.length > 0)
  if (withPage.length) {
    const me = btn(pc.name, () => {}, false, undefined, 'on')
    me.textContent = ''
    me.append(icon('laptop'), el('span', '', pc.name))
    nav.append(me)
    for (const o of withPage) {
      const b = btn(o.name, () => { location.href = o.page }, false, undefined, '')
      b.textContent = ''
      b.append(icon('laptop'), el('span', '', o.name))
      nav.append(b)
    }
  }
}

async function refresh() {
  if (!key || needPin) return
  try {
    const next = await call('/api/state')
    fails = 0
    if (offline) {
      offline = false
      $('banner').hidden = true
      document.body.classList.remove('has-banner')
    }
    data = next
    const sig = JSON.stringify(next)
    // Do not redraw under a finger or an open menu: it would replace the button being pressed.
    if (sig === lastSig || document.body.dataset.gesture || document.querySelector('.dd.open,.smenu,.b.holding')) return
    lastSig = sig
    render()
  } catch (err) {
    if (err.status === 429) {
      // Too many wrong tries from this address: the key is probably fine, so keep it and wait.
      say(err.message, true)
      return
    }
    if (err.status === 401 && err.code === 'pin') {
      unlock = ''
      try {
        localStorage.removeItem('rsp_u')
      } catch (e) {
        // Ignore.
      }
      pinScreen('')
      return
    }
    if (err.status === 401) {
      try {
        localStorage.removeItem('rsp_k')
      } catch (e) {
        // Ignore.
      }
      data = null
      pairScreen(true)
      return
    }
    fails++
    if (!data) {
      unreachableScreen()
      return
    }
    offline = true
    $('banner').textContent = 'Waiting for the PC to answer…'
    $('banner').hidden = false
  }
}

// Polling is gentle: nothing while the page is hidden, every 15 s normally, every 45 s while a game runs.
function schedule() {
  clearTimeout(timer)
  if (!key) return
  const playing = data && data.pc && data.pc.steam && data.pc.steam.playing
  const wait = offline || !data ? 5000 : playing ? 45000 : 15000
  timer = setTimeout(async () => {
    if (!document.hidden) await refresh()
    schedule()
  }, wait)
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && key) refresh()
})

if (!key) pairScreen(false)
else {
  refresh()
  schedule()
}
