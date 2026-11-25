'use strict'
// The main phone page. Shared helpers (key, calls, icons, themes) are in common.js.
let data = null
// The cards slide in once when the page opens, not on every refresh (see body.intro in app.css).
document.body.classList.add('intro')
setTimeout(() => document.body.classList.remove('intro'), 1500)
let timer = 0
let lastSig = ''
let offline = false
let fails = 0
let needPin = false
const opened = new Set()
const picked = { game: '', out: '' }
const avatars = {}
const arts = {}

async function act(action, arg, extra) {
  say('Sending…')
  try {
    const j = await call('/api/do', Object.assign({ action, arg }, extra || {}))
    say(j.message || 'Done.')
    // The program restarts itself after an update: bring the page back by itself once it answers again.
    if ((action === 'update' || action === 'restart_remote') && /restart/i.test(j.message || '')) {
      reloadWhenBack()
      return
    }
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

// A big square button with an icon above its label. Same hold-to-confirm rules as btn().
function tile(name, label, fn, opts) {
  const o = opts || {}
  const b = btn(label, fn, o.disabled, o.sure, 'tile' + (o.cls ? ' ' + o.cls : ''))
  b.textContent = ''
  b.append(icon(name), el('span', '', label))
  return b
}

function acc(id, title, content, iconName, onOpen) {
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
    if (o) {
      opened.add(id)
      if (onOpen) onOpen()
    } else opened.delete(id)
  })
  d.append(h, b)
  return d
}

// -- add or remove apps without leaving the home page ----------------------------------------------------------------------
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

let lastReport = null

// -- the page ---------------------------------------------------------------------------

// -- looks ---------------------------------------------------------------------------------------
// The persistent part of the page: header and footer stay on screen; only the cards between them are swapped.
let shell = null
function ensureShell() {
  const app = $('app')
  if (shell && app.contains(shell.panel)) return shell
  app.textContent = ''
  const panel = el('div', 'panel')
  shell = { panel, top: el('div', 'top-host'), content: el('div', 'content'), foot: el('div', 'foot-host') }
  panel.append(shell.top, shell.content, shell.foot)
  app.append(panel)
  return shell
}


function themeCard(pc) {
  const card = el('div', 'card')
  card.append(section('wrench', 'Theme', 'saved for this PC on this phone'))
  const g = el('div', 'themes')
  const mine = themeOf(pc)
  for (const [key, label] of THEMES) {
    const b = el('button', 'swatch' + (key === mine ? ' on' : ''))
    b.type = 'button'
    b.append(el('span', 'pv ' + key), el('span', 'lb', label))
    b.addEventListener('click', () => {
      try {
        localStorage.setItem('rsp_theme:' + pc.name, key)
      } catch (e) {
        // The choice lasts until the page is reloaded.
      }
      setTheme(key)
      for (const x of g.children) x.classList.toggle('on', x === b)
    })
    g.append(b)
  }
  card.append(g)
  return card
}

function pinScreen(message) {
  needPin = true
  data = null
  lastSig = ''
  $('banner').hidden = true
  const app = $('app')
  app.textContent = ''
  app.append(
    makePinForm(message, () => {
      needPin = false
      app.textContent = ''
      app.append(el('p', 'loading', 'Connecting to your PC…'))
      refresh()
    }),
  )
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

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return m + ' min ago'
  const h = Math.round(m / 60)
  if (h < 48) return h + ' h ago'
  return Math.round(h / 24) + ' days ago'
}

function rowOf(...kids) {
  const r = el('div', 'row')
  r.append(...kids)
  return r
}

let askedUpdate = false
let fromCache = false // true while the page shows the state saved from the last visit (the laptop has not answered yet)
// After each restart of the PC the program checks for a newer version; the first page load of that run asks once.
function offerUpdate(pc) {
  const u = pc && pc.update
  if (fromCache || askedUpdate || !u || !u.available) return
  let seen = ''
  try {
    seen = sessionStorage.getItem('updateAsked') || ''
  } catch {
    seen = ''
  }
  if (seen === u.boot) return
  askedUpdate = true
  try {
    sessionStorage.setItem('updateAsked', u.boot)
  } catch {
    // Ask again next time: harmless.
  }
  confirmBox('A new version is ready', 'Update now? The app restarts by itself and the page comes back in about 15 seconds.', 'Yes, update', () => act('update'))
}

function render() {
  const pc = data.pc
  const myTheme = themeOf(pc)
  const sh = ensureShell()
  const p = el('div', 'content')
  const helper = !pc.control
  const run = (action, arg) => () => act(action, arg)
  offerUpdate(pc)
  topBar(pc, helper, sh, run)
  if (!helper) {
    p.append(playerBar(pc))
    const steam = steamCard(pc, run)
    if (steam) p.append(steam)
    p.append(soundCard(pc), bluetoothCard(pc), modeCard(pc, run), windowsCard(), appsCard(pc))
    const mine = buttonsCard(pc)
    if (mine) p.append(mine)
    p.append(themeCard(pc))
  }
  p.append(phonesCard())
  const sys = systemCard(pc, helper, run)
  if (sys) p.append(sys)
  if (!helper) p.append(powerCard(run))
  // The footer (and its open drop-down) is kept as long as nothing in it changed.
  const footSig = (data.feedback || '') + '|' + (data.version || '')
  if (sh.foot.dataset.sig !== footSig) {
    sh.foot.dataset.sig = footSig
    sh.foot.replaceChildren(footer(data.feedback, data.version, 'main page', data.coffee))
  }
  commitContent(sh, p, myTheme)
}

// Swaps the cards (the header and footer stay).
function commitContent(sh, p, myTheme) {
  sh.content.replaceChildren(...p.childNodes)
  setTheme(myTheme)
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
    fromCache = false
    const sig = JSON.stringify(next)
    // Do not redraw under a finger or an open menu: it would replace the button being pressed.
    if (sig === lastSig || document.body.dataset.gesture || document.querySelector('.dd.open,.smenu,.b.holding,.b.busy')) return
    lastSig = sig
    // Kept for the next visit, so the page can appear at once while the laptop is still collecting its answers (never when a PIN is in use).
    try {
      if (!unlock) localStorage.setItem('rsp_last', JSON.stringify({ at: Date.now(), data: next }))
    } catch (e) {
      // Storage blocked or full: the page just waits for the laptop as before.
    }
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
        localStorage.removeItem('rsp_last')
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
  // Paint the last state we saw right away (if it is fresh enough), then let the laptop's answer replace it.
  try {
    const c = JSON.parse(localStorage.getItem('rsp_last') || 'null')
    if (c && c.data && c.data.pc && Date.now() - c.at < 6 * 3600 * 1000) {
      data = c.data
      fromCache = true
      offline = true
      $('banner').textContent = 'Updating…'
      $('banner').hidden = false
      document.body.classList.add('has-banner')
      render()
    }
  } catch (e) {
    // No saved state: the normal "Connecting…" screen stays until the first answer.
  }
  refresh()
  schedule()
}
