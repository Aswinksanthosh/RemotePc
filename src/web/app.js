'use strict'
// The main phone page. Shared helpers (key, calls, icons, themes) are in common.js.
let data = null
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
// Searches the apps this PC has (its Start menu) and adds the one you pick to the Apps list; your own added apps can be removed here too.
const appMgr = { open: false, names: null, custom: null, q: '', busy: false }
let appMgrBox = null
function appManager() {
  appMgrBox = el('div', 'appmgr')
  drawAppManager()
  return appMgrBox
}
async function loadAppManager() {
  appMgr.busy = true
  drawAppManager()
  try {
    appMgr.custom = (await call('/api/settings/apps', { op: 'list' })).apps
    appMgr.names = (await call('/api/settings/startapps')).names
  } catch (err) {
    say(err.message, true)
    appMgr.names = appMgr.names || []
  }
  appMgr.busy = false
  drawAppManager()
}
async function changeApps(body, done) {
  try {
    appMgr.custom = (await call('/api/settings/apps', body)).apps
    say(done)
    lastSig = ''
    refresh()
  } catch (err) {
    say(err.message, true)
  }
  drawAppManager()
}
function drawAppManager() {
  if (!appMgrBox) return
  appMgrBox.textContent = ''
  const toggle = btn(appMgr.open ? 'Hide add or remove' : 'Add or remove apps', () => {
    appMgr.open = !appMgr.open
    if (appMgr.open && !appMgr.names) loadAppManager()
    else drawAppManager()
  }, false, undefined, appMgr.open ? '' : 'go')
  appMgrBox.append(toggle)
  if (!appMgr.open) return
  if (appMgr.busy && !appMgr.names) {
    appMgrBox.append(el('div', 'empty', 'Asking the PC for its apps…'))
    return
  }
  const search = el('input', 'field')
  search.type = 'text'
  search.maxLength = 40
  search.placeholder = 'Search the apps on this PC'
  search.value = appMgr.q
  search.addEventListener('input', () => {
    appMgr.q = search.value
    drawAppResults(results)
  })
  const results = el('div', 'list')
  appMgrBox.append(search, results)
  drawAppResults(results)
  const mine = appMgr.custom || []
  if (mine.length) {
    appMgrBox.append(el('div', 'note', 'Apps you added:'))
    const list = el('div', 'list')
    for (const a of mine) {
      const item = el('div', 'item stack')
      item.append(el('div', 'nm', a.label))
      const acts = el('div', 'acts')
      acts.append(btn('Remove', () => confirmBox('Remove ' + a.label + '?', 'It disappears from the Apps list. The app itself stays on the PC.', 'Remove', () => changeApps({ op: 'remove', label: a.label }, a.label + ' removed.'), true)))
      item.append(acts)
      list.append(item)
    }
    appMgrBox.append(list)
  }
  // Keep typing: the box is the same element, so give it the focus back after a redraw.
  if (appMgr.q) search.focus()
}
function drawAppResults(box) {
  box.textContent = ''
  const q = appMgr.q.trim().toLowerCase()
  const have = new Set((appMgr.custom || []).map((a) => a.label.toLowerCase()))
  const found = (appMgr.names || []).filter((n) => (!q || n.toLowerCase().indexOf(q) >= 0) && !have.has(n.slice(0, 30).toLowerCase())).slice(0, 10)
  for (const n of found) {
    const item = el('div', 'item stack')
    item.append(el('div', 'nm', n))
    const acts = el('div', 'acts')
    acts.append(btn('Add', () => changeApps({ op: 'add', label: n.slice(0, 30), match: n }, n + ' added. It is in the Apps list now.'), false, undefined, 'go'))
    item.append(acts)
    box.append(item)
  }
  if (appMgr.names && !found.length) box.append(el('div', 'empty', q ? 'Nothing matches. Games belong in the Steam list, not here.' : 'No more apps to add.'))
}

// -- add a game Steam's files do not show (by its Steam number) --------------------------------------------------------------
// For a game that is installed but missing from the Steam drop-down (for example a library on a drive Steam does not list). The Steam number
// is in the address of the game's store page: store.steampowered.com/app/578080.
const gameMgr = { open: false, name: '', id: '' }
let gameMgrBox = null
function gameManager(pc) {
  gameMgrBox = el('div', 'gamemgr')
  drawGameManager(pc)
  return gameMgrBox
}
// -- clipboard: paste here, send to the PC; or read the PC's clipboard and copy it on the phone --------
function clipboardBox() {
  const box = el('div', 'clipbox')
  const inbox = el('textarea', 'field cliptext')
  inbox.rows = 3
  inbox.maxLength = 2000
  inbox.placeholder = 'Tap here, then tap Paste (up to 2000 characters)'
  inbox.setAttribute('aria-label', 'Text to send to the PC clipboard')
  const send = btn('Send to PC clipboard', async () => {
    if (!inbox.value) return say('Paste something first.', true)
    send.disabled = true
    try {
      const j = await call('/api/clipboard', { text: inbox.value })
      say(j.message || 'Copied.')
      inbox.value = ''
    } catch (err) {
      say(err.message, true)
    }
    send.disabled = false
  }, false, undefined, 'go')
  const outbox = el('textarea', 'field cliptext')
  outbox.rows = 3
  outbox.readOnly = true
  outbox.placeholder = "The PC's clipboard will show here"
  outbox.setAttribute('aria-label', "Text from the PC's clipboard")
  const get = btn("Get PC clipboard", async () => {
    get.disabled = true
    try {
      const j = await call('/api/clipboard', {})
      outbox.value = j.text || ''
      if (!j.text) say('The PC clipboard has no text.', true)
    } catch (err) {
      say(err.message, true)
    }
    get.disabled = false
  })
  const copy = btn('Copy on phone', async () => {
    if (!outbox.value) return say('Get the PC clipboard first.', true)
    say((await copyText(outbox.value)) ? 'Copied on your phone.' : 'Could not copy. Hold the text and choose Copy.', false)
  })
  const r1 = el('div', 'row')
  r1.append(send)
  const r2 = el('div', 'row')
  r2.append(get, copy)
  box.append(el('div', 'note', 'Phone to PC'), inbox, r1, el('div', 'note', 'PC to phone'), outbox, r2)
  return box
}

async function changeGames(action, arg) {
  await act(action, arg)
  lastSig = ''
  refresh()
}
function drawGameManager(pc) {
  if (!gameMgrBox) return
  gameMgrBox.textContent = ''
  gameMgrBox.append(btn(gameMgr.open ? 'Hide add a game' : 'Game missing? Add it', () => {
    gameMgr.open = !gameMgr.open
    drawGameManager(pc)
  }, false, undefined, gameMgr.open ? '' : 'go'))
  if (!gameMgr.open) return
  gameMgrBox.append(el('div', 'note', 'Steam shows the game as installed but it is not in the list? Add it by its Steam number (in the web address of its store page: store.steampowered.com/app/578080).'))
  gameMgrBox.append(btn('Add PUBG (578080)', () => changeGames('game_add', '578080|PUBG: BATTLEGROUNDS'), false, undefined, 'go'))
  const name = el('input', 'field')
  name.type = 'text'
  name.maxLength = 80
  name.placeholder = 'Name of the game'
  name.value = gameMgr.name
  name.addEventListener('input', () => {
    gameMgr.name = name.value
  })
  const id = el('input', 'field')
  id.type = 'text'
  id.inputMode = 'numeric'
  id.maxLength = 10
  id.placeholder = 'Steam number, for example 578080'
  id.value = gameMgr.id
  id.addEventListener('input', () => {
    gameMgr.id = id.value.replace(/\D/g, '')
    id.value = gameMgr.id
  })
  gameMgrBox.append(name, id, btn('Add this game', async () => {
    await changeGames('game_add', gameMgr.id + '|' + gameMgr.name)
    gameMgr.name = ''
    gameMgr.id = ''
    drawGameManager(pc)
  }))
  const mine = (pc && pc.customGames) || []
  if (mine.length) {
    gameMgrBox.append(el('div', 'note', 'Games you added:'))
    const list = el('div', 'list')
    for (const g of mine) {
      const item = el('div', 'item stack')
      const nm = el('div', 'nm', g.name)
      nm.append(el('small', '', 'Steam number ' + g.appid))
      item.append(nm)
      const acts = el('div', 'acts')
      acts.append(btn('Remove', () => confirmBox('Remove ' + g.name + '?', 'It disappears from the game list. The game itself stays installed.', 'Remove', () => changeGames('game_remove', g.name), true)))
      item.append(acts)
      list.append(item)
    }
    gameMgrBox.append(list)
  }
}

// -- the Windows list: what is open on the PC, switch to it or close it ------------------------------------------------
// Loaded only when the drop-down is opened (asking Windows takes a moment), kept here so a redraw of the page does not lose it.
const winState = { list: null, loading: false, error: '' }
let winBox = null
async function loadWindows() {
  if (winState.loading) return
  winState.loading = true
  winState.error = ''
  drawWindows()
  try {
    winState.list = (await call('/api/windows')).windows
  } catch (err) {
    winState.error = err.message
  }
  winState.loading = false
  drawWindows()
}
function drawWindows() {
  if (!winBox) return // drawn even before it is on the page, so a redraw of the page keeps the list
  winBox.textContent = ''
  const bar = el('div', 'winbar')
  const refresh = btn(winState.loading ? 'Looking…' : 'Refresh', () => loadWindows(), winState.loading, undefined, winState.loading ? 'busy' : '')
  bar.append(refresh, btn('Show desktop', () => act('desktop_toggle')))
  winBox.append(bar)
  if (winState.error) winBox.append(el('div', 'empty', winState.error))
  else if (!winState.list) winBox.append(el('div', 'empty', winState.loading ? 'Asking the PC…' : 'Press Refresh to see the open windows.'))
  else if (!winState.list.length) winBox.append(el('div', 'empty', 'No windows are open.'))
  const list = el('div', 'list')
  for (const w of winState.list || []) {
    const item = el('div', 'item stack')
    const nm = el('div', 'nm', w.title)
    nm.append(el('small', '', (w.name || 'app') + (w.minimized ? ' · minimized' : '')))
    item.append(nm)
    const acts = el('div', 'acts')
    acts.append(
      btn('Switch', async () => {
        await act('window_focus', w.id)
      }, false, undefined, 'go'),
      btn('Close', () => confirmBox('Close this window?', '"' + w.title + '" is asked to close. If it has unsaved work it may ask you first. If it is the window that runs this remote, the remote stops.', 'Close', async () => {
        await act('window_close', w.id)
        setTimeout(loadWindows, 1200)
      }, true)),
    )
    item.append(acts)
    list.append(item)
  }
  winBox.append(list)
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

// A star that marks a Bluetooth device or a sound output as a favourite (kept on the PC, so every phone sees it).
function starBtn(kind, name, isFav) {
  const b = el('button', 'star' + (isFav ? ' on' : ''))
  b.type = 'button'
  b.title = isFav ? 'Remove from favourites' : 'Add to favourites'
  b.setAttribute('aria-label', b.title + ': ' + name)
  b.setAttribute('aria-pressed', isFav ? 'true' : 'false')
  b.append(icon('star'))
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    await act('favorite_set', kind + '|' + (isFav ? '0' : '1') + '|' + name)
    lastSig = ''
    refresh()
  })
  return b
}

// Favourites: starred Bluetooth devices and sound outputs, one tap each, shown without opening the drop-downs.
// A Bluetooth favourite connects (or disconnects when it is connected); an output favourite switches the sound to it.
function favoritesStrip(pc) {
  const fav = pc.favorites || { bt: [], out: [] }
  const heads = pc.headphones || []
  const outs = pc.outputs || []
  const on = pc.btConnected || []
  const chips = []
  for (const name of fav.bt) {
    if (!heads.includes(name)) continue
    const isOn = on.includes(name)
    const c = btn(name, () => act(isOn ? 'bt_disconnect' : 'bt_connect', name), false, undefined, 'chip' + (isOn ? ' on' : ''))
    c.textContent = ''
    c.title = isOn ? 'Connected: tap to disconnect' : 'Tap to connect'
    const pct = (pc.btBattery || {})[name]
    c.append(icon('bluetooth'), el('span', 'chip-t', name), el('small', '', isOn ? 'connected' + (pct ? ' · ' + pct + '%' : '') : 'connect'))
    chips.push(c)
  }
  for (const name of fav.out) {
    if (!outs.includes(name)) continue
    const isOn = picked.out === name
    const c = btn(name, () => {
      picked.out = name
      act('audio_set', name)
    }, false, undefined, 'chip' + (isOn ? ' on' : ''))
    c.textContent = ''
    c.title = 'Play the sound here'
    c.append(icon('speaker'), el('span', 'chip-t', name), el('small', '', isOn ? 'playing here' : 'play here'))
    chips.push(c)
  }
  if (!chips.length) return null
  const box = el('div', 'card favs')
  box.append(section('star', 'Favourites'))
  const row = el('div', 'chips')
  row.append(...chips)
  box.append(row)
  return box
}

// The player bar: always at the top (it stays on screen while you scroll). Previous, play or pause, next, mute and the volume slider in ONE row.
// A PC that cannot report its volume level keeps three small volume keys instead of the slider.
// -- now playing (read only: what Windows shows in its own media pop-up) -------------------------
const nowState = { media: null, key: '', cover: '', at: 0, busy: false }
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}
function nowPos() {
  const m = nowState.media
  return m ? Math.min(m.end || 0, m.pos + (m.playing ? (Date.now() - nowState.at) / 1000 : 0)) : 0
}
function drawNow() {
  const row = document.querySelector('.nowrow')
  if (!row) return
  const m = nowState.media
  if (!m) {
    row.hidden = true
    row.dataset.key = ''
    return
  }
  row.hidden = false
  const key = m.title + '|' + m.artist
  if (row.dataset.key !== key) {
    row.dataset.key = key
    row.textContent = ''
    const art = el('div', 'nowart')
    art.append(icon('note'))
    const txt = el('div', 'nowtxt')
    txt.append(el('div', 'nowtitle', m.title), el('div', 'nowartist', m.artist))
    const prog = el('div', 'nowprog')
    const meter = el('div', 'nowmeter')
    meter.setAttribute('role', 'progressbar')
    meter.setAttribute('aria-label', 'Song progress')
    meter.append(el('i'))
    prog.append(el('span', 'nowt1', '0:00'), meter, el('span', 'nowt2', '0:00'))
    txt.append(prog)
    row.append(art, txt)
  }
  row.classList.toggle('playing', m.playing)
  const art = row.querySelector('.nowart')
  if (nowState.cover && art.dataset.cover !== nowState.cover) {
    art.dataset.cover = nowState.cover
    art.style.backgroundImage = 'url("' + nowState.cover + '")'
    art.textContent = ''
  } else if (!nowState.cover && art.dataset.cover) {
    delete art.dataset.cover
    art.style.backgroundImage = ''
    art.append(icon('note'))
  }
  const pos = nowPos()
  row.querySelector('.nowt1').textContent = fmtTime(pos)
  row.querySelector('.nowt2').textContent = m.end ? fmtTime(m.end) : ''
  const meterEl = row.querySelector('.nowmeter')
  meterEl.setAttribute('aria-valuenow', String(Math.round(m.end ? Math.min(100, (pos / m.end) * 100) : 0)))
  meterEl.setAttribute('aria-valuetext', fmtTime(pos) + (m.end ? ' of ' + fmtTime(m.end) : ''))
  row.querySelector('.nowmeter i').style.width = (m.end ? Math.min(100, (pos / m.end) * 100) : 0) + '%'
}
async function pollNow() {
  if (document.hidden || nowState.busy || !data || !data.pc || !data.pc.control) return
  nowState.busy = true
  try {
    const j = await call('/api/media')
    nowState.media = j && j.media ? j.media : null
    nowState.at = Date.now()
    const key = nowState.media ? nowState.media.title + '|' + nowState.media.artist : ''
    if (key !== nowState.key) {
      nowState.key = key
      if (nowState.cover) URL.revokeObjectURL(nowState.cover)
      nowState.cover = ''
      if (key) {
        try {
          const blob = await call('/api/cover')
          if (blob && nowState.key === key) nowState.cover = URL.createObjectURL(blob)
        } catch (e) {
          // No cover: a note symbol is shown.
        }
      }
    }
  } catch (e) {
    nowState.media = null
  }
  nowState.busy = false
  drawNow()
}
setInterval(pollNow, 4000)
setInterval(drawNow, 1000)
setTimeout(pollNow, 800)

function playerBar(pc) {
  const bar = el('div', 'card player')
  bar.setAttribute('role', 'region')
  bar.setAttribute('aria-label', 'Media and volume')
  const now = el('div', 'nowrow')
  now.hidden = true
  bar.append(now)
  const mk = (name, action, label, cls) => {
    const b = btn(label, () => {
      act(action)
      setTimeout(pollNow, 1000)
    }, false, undefined, 'pbtn' + (cls ? ' ' + cls : ''))
    b.textContent = ''
    b.append(icon(name))
    b.title = label
    b.setAttribute('aria-label', label)
    return b
  }
  bar.append(mk('prev', 'media_prev', 'Previous'), mk('play', 'media_playpause', 'Play or pause', 'go'), mk('next', 'media_next', 'Next'))
  if (pc.volume) {
    const mute = btn(pc.volume.muted ? 'Sound is muted: tap to turn it on' : 'Mute', () => act('mute_set', pc.volume.muted ? 'off' : 'on'), false, undefined, 'pbtn' + (pc.volume.muted ? ' on' : ''))
    mute.textContent = ''
    mute.setAttribute('aria-label', pc.volume.muted ? 'Sound is muted: tap to turn it on' : 'Mute')
    mute.setAttribute('aria-pressed', pc.volume.muted ? 'true' : 'false')
    mute.append(icon(pc.volume.muted ? 'mute' : 'volup'))
    const slider = el('input', 'slider')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '100'
    slider.step = '1'
    slider.value = String(pc.volume.level)
    slider.setAttribute('aria-label', 'Volume')
    const label = el('div', 'vollabel', pc.volume.muted ? 'Muted' : pc.volume.level + '%')
    const fill = () => {
      slider.style.setProperty('--fill', slider.value + '%')
      slider.setAttribute('aria-valuetext', slider.value + ' percent')
    }
    fill()
    slider.addEventListener('pointerdown', () => {
      document.body.dataset.gesture = 'volume'
    })
    const stop = () => {
      if (document.body.dataset.gesture === 'volume') delete document.body.dataset.gesture
    }
    slider.addEventListener('pointerup', stop)
    slider.addEventListener('pointercancel', stop)
    slider.addEventListener('input', () => {
      label.textContent = slider.value + '%'
      fill()
    })
    // Sent when the finger lifts (and while dragging, at most every 400 ms; the PC keeps only the newest level), so the PC is not flooded.
    let last = 0
    slider.addEventListener('input', () => {
      const now = Date.now()
      if (now - last < 400) return
      last = now
      call('/api/do', { action: 'volume_set', arg: String(slider.value) }).catch(() => {})
    })
    slider.addEventListener('change', () => {
      act('volume_set', String(slider.value))
      stop()
    })
    bar.append(mute, slider, label)
  } else {
    bar.append(mk('voldown', 'volume_down', 'Volume down'), mk('mute', 'mute', 'Mute'), mk('volup', 'volume_up', 'Volume up'))
  }
  setTimeout(drawNow, 0)
  return bar
}

function render() {
  const pc = data.pc
  const myTheme = themeOf(pc)
  const sh = ensureShell()
  const p = el('div', 'content')
  const helper = !pc.control
  const run = (action, arg) => () => act(action, arg)
  offerUpdate(pc)

  // -- top: name, status, power menu ----------------------------------------------------
  const top = el('div', 'top on')
  const txt = el('div', 'txt')
  txt.append(el('h1', '', pc.name))
  const chip = el('div', 'chip')
  chip.append(el('span', 'dot'), el('span', '', helper ? 'helper (starts other PCs)' : 'online'))
  txt.append(chip)
  // The laptop's own battery (nothing on a PC that has none).
  const bits = [pc.model, data.version ? 'version ' + data.version : ''].filter(Boolean).join('  ·  ')
  if (bits) txt.append(el('div', 'model', bits))
  top.append(txt)
  const gear = el('button', 'b pwr')
  gear.type = 'button'
  gear.title = 'Settings'
  gear.setAttribute('aria-label', 'Settings')
  gear.append(icon('gear'))
  gear.addEventListener('click', () => {
    location.href = '/settings?k=' + encodeURIComponent(key)
  })
  if (!helper) {
    const upd = el('button', 'b pwr')
    upd.type = 'button'
    upd.title = 'Update App'
    upd.setAttribute('aria-label', 'Update App')
    upd.append(icon('download'))
    upd.addEventListener('click', () => confirmBox('Update App?', 'It downloads the newest version and restarts by itself. The page refreshes in a few seconds.', 'Update', () => act('update')))
    top.append(upd)
  }
  top.append(gear)
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
  sh.top.replaceChildren(top)
  let powerCard = null

  if (!helper) {
    // -- power and lock (shown last: used the least) -------------------------------------------------------------------
    const quick = el('div', 'card')
    quick.append(section('power', 'Power'))
    const g = el('div', 'grid3')
    g.append(
      tile('lock', 'Lock', run('lock')),
      tile('screen', 'Screen off', run('screen_off')),
      tile('moon', 'Sleep', () => confirmBox('Sleep the PC?', 'A sleeping PC cannot be reached from the phone until you wake it.', 'Sleep', run('sleep'))),
      tile('restart', 'Restart', () => confirmBox('Restart the PC?', 'It restarts in 10 seconds and comes back by itself.', 'Restart', run('restart'), true)),
      tile('power', 'Turn off', () => confirmBox('Turn off the PC?', 'It turns off in 15 seconds and stays off until you start it again.', 'Turn off', run('shutdown'), true), { cls: 'dangerous' }),
      tile('stop', 'Cancel off', run('shutdown_cancel')),
    )
    quick.append(g)
    powerCard = quick

    p.append(playerBar(pc))
    const favBox = favoritesStrip(pc)
    if (favBox) p.append(favBox)

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
      steam.append(rowOf(btn('Start game', () => confirmBox('Start ' + picked.game + '?', 'The game opens on this PC.', 'Start', () => act('steam_game', picked.game)), !games.length, undefined, 'go'), btn('Close game', run('close_game'), false, 'Close the running game?')))
      steam.append(rowOf(btn('Open Steam', () => confirmBox('Open Steam?', 'Steam opens on this PC.', 'Open', run('steam_open'))), btn('Big Picture', () => confirmBox('Open Steam Big Picture?', 'The full-screen Steam opens on this PC.', 'Open', run('steam_bigpicture')))))
      p.append(steam)
    }

    // -- bluetooth devices -----------------------------------------------------------------
    const heads = pc.headphones || []
    const bt = el('div', 'card')
    const btIn = el('div', '')
    if (!heads.length) btIn.append(el('div', 'empty', 'No paired Bluetooth devices found. Pair your earbuds with this PC in Windows first.'))
    else {
      const list = el('div', 'list')
      const on = pc.btConnected || []
      for (const name of heads) {
        const isOn = on.includes(name)
        const item = el('div', 'item stack' + (isOn ? ' connected' : ''))
        const ic = el('div', 'ic')
        ic.append(icon('bluetooth'))
        item.append(starBtn('bt', name, ((pc.favorites || {}).bt || []).includes(name)))
        const nm = el('div', 'nm', name)
        const pct = (pc.btBattery || {})[name]
        nm.append(el('small', 'btstat' + (isOn ? ' on' : ''), (isOn ? 'Connected' : 'Not connected') + (isOn && pct ? ' · battery ' + pct + '%' : '')))
        item.append(ic, nm)
        const acts = el('div', 'acts')
        acts.append(btn('Connect', () => act('bt_connect', name), false, undefined, isOn ? '' : 'go'), btn('Disconnect', () => act('bt_disconnect', name), false, undefined, isOn ? 'go' : ''))
        item.append(acts)
        list.append(item)
      }
      // Clear sound: keeps the earbuds in music quality when a program turns the mic on (the earbuds' own mic is then not used).
      const hf = pc.handsFree
      if (hf && hf.found) {
        const row = el('div', 'hfrow')
        row.append(el('div', 'nm', 'Clear sound' + (hf.cleared ? ': on' : ': off')), btn(hf.cleared ? 'Turn off' : 'Turn on', () => act('handsfree_set', hf.cleared ? 'off' : 'on'), false, undefined, hf.cleared ? '' : 'go'))
        btIn.append(row)
        btIn.append(el('div', 'note', hf.ready ? 'On: no more bad sound when the mic is used. The earbuds own mic stops working. Turn off for calls.' : 'First run Bluetooth-Sound-Setup on this PC once (Start menu, asks for administrator rights).'))
      }
      btIn.append(list)
      btIn.append(el('div', 'note', 'Earbuds must be in range and not busy with another device. Disconnect frees them for your phone.'))
    }
    bt.append(acc('bt', heads.length ? 'Bluetooth devices (' + ((pc.btConnected || []).length ? (pc.btConnected || []).length + ' connected of ' : '') + heads.length + ')' : 'Bluetooth devices', btIn, 'bluetooth'))
    const btCard = bt

    // -- sound output (a drop-down, like the Bluetooth devices) ----------------------------
    const outs = pc.outputs || []
    const snd = el('div', 'card')
    const sndIn = el('div', '')
    if (!outs.length) sndIn.append(el('div', 'empty', 'No sound outputs found.'))
    else {
      const list = el('div', 'list')
      for (const name of outs) {
        const o = el('button', 'opt' + (picked.out === name ? ' on' : ''))
        o.type = 'button'
        const ic = el('span', 'ic')
        ic.append(icon(/blue|buds|pods|head/i.test(name) ? 'bluetooth' : 'speaker'))
        o.append(ic, el('span', 'nm', name), el('span', 'tick'))
        const row = el('div', 'optrow')
        o.addEventListener('click', () => {
          picked.out = name
          for (const x of list.querySelectorAll('.opt')) x.classList.toggle('on', x === o)
          act('audio_set', name)
        })
        row.append(o, starBtn('out', name, ((pc.favorites || {}).out || []).includes(name)))
        list.append(row)
      }
      sndIn.append(list)
      sndIn.append(el('div', 'note', 'Bluetooth earbuds appear here once they are connected.'))
    }
    const sndName = picked.out ? (picked.out.length > 26 ? picked.out.slice(0, 25) + '…' : picked.out) : ''
    snd.append(acc('sound', sndName ? 'Sound output: ' + sndName : 'Sound output', sndIn, 'speaker'))
    p.append(snd)
    p.append(btCard)

    // -- power mode (the Windows power mode slider) ----------------------------------------
    const mode = el('div', 'card')
    mode.append(section('bolt', 'Power mode', 'Windows'))
    const seg = el('div', 'seg')
    for (const [k, label, ic] of [['saver', 'Efficiency', 'leaf'], ['balanced', 'Balanced', 'balance'], ['gaming', 'Performance', 'bolt']]) {
      seg.append(tile(ic, label, run('mode_' + k), { cls: pc.mode === k ? 'on' : '' }))
    }
    // Battery and plug status, right with the power mode.
    if (pc.battery) {
      const b = pc.battery
      const bar = el('div', 'batt' + (b.onBattery ? '' : ' plugged') + (b.percent <= 20 && b.onBattery ? ' low' : ''))
      bar.append(icon(b.onBattery ? 'bat' : 'plug'))
      const meter = el('div', 'meter')
      const fill = el('i')
      fill.style.width = Math.max(0, Math.min(100, b.percent)) + '%'
      meter.append(fill)
      bar.append(el('b', '', b.percent + '%'), meter, el('span', '', b.onBattery ? 'On battery' : 'Plugged in'))
      mode.append(bar)
    }
    mode.append(seg)
    mode.append(el('div', 'note', 'Efficiency for downloads, Performance for games.'))
    // The two Windows timers, always here: when the screen turns off by itself and when the PC goes to sleep by itself.
    if (pc.timers && pc.timerChoices) {
      const label = (m) => (m ? (m >= 60 && m % 60 === 0 ? m / 60 + (m === 60 ? ' hour' : ' hours') : m + (m === 1 ? ' minute' : ' minutes')) : 'Never')
      for (const [kind, title] of [['screen', 'Screen off after'], ['sleep', 'Sleep after']]) {
        const now = pc.timers[kind]
        if (now === null || now === undefined) continue
        const choices = pc.timerChoices[kind]
        const row = el('div', 'timer')
        row.append(el('div', 'timer-t', title))
        row.append(dropdown(choices.map(label), label(now), (v) => act('timer_set', kind + ':' + choices[choices.map(label).indexOf(v)])))
        mode.append(row)
      }
      mode.append(el('div', 'note', 'These are the Windows timers. A sleeping PC cannot be reached from the phone.'))
    }
    p.append(mode)

    // -- windows open on the PC --------------------------------------------------------------
    winBox = el('div', 'winbox')
    const winCard = el('div', 'card')
    winCard.append(acc('windows', 'Windows', winBox, 'laptop', () => loadWindows()))
    drawWindows()
    p.append(winCard)

    // -- apps and your own buttons ---------------------------------------------------------
    const apps = pc.apps || []
    {
      const card = el('div', 'card')
      const appsIn = el('div', '')
      const g2 = el('div', 'apps')
      for (const name of apps) {
        const b = btn(name, () => confirmBox('Open ' + name + '?', name + ' opens on this PC.', 'Open', () => act('app', name)), false, undefined, 'tile')
        b.textContent = ''
        b.append(el('div', 'letter', name.charAt(0).toUpperCase()), el('span', '', name))
        g2.append(b)
      }
      if (!apps.length) appsIn.append(el('div', 'empty', 'No apps yet. Press "Add or remove apps" below.'))
      appsIn.append(g2)
      appsIn.append(appManager())
      card.append(acc('apps', apps.length ? 'Apps (' + apps.length + ')' : 'Apps', appsIn, 'grid'))
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

  if (!helper) p.append(themeCard(pc))

  // -- system, other PCs, phones -----------------------------------------------------------
  const sys = el('div', 'card')
  sys.append(section('wrench', 'System'))
  const parts = []
  if (!helper) {
    const g = el('div', 'grid3')
    g.append(tile('pulse', 'Status', run('status'), { cls: 'small' }))
    const dt = tile('wrench', 'Diagnostics', async () => {
      // A spinner and "Checking…" while the PC looks at itself (it takes a few seconds).
      const label = dt.querySelector('span')
      const was = label.textContent
      dt.classList.add('busy')
      dt.disabled = true
      label.textContent = 'Checking…'
      say('Checking this PC…')
      try {
        const j = await call('/api/diagnostics')
        lastReport = j.lines.join('\n')
        say(j.problems ? j.problems + ' thing' + (j.problems === 1 ? '' : 's') + ' to fix. The report is under System.' : 'Everything looks fine. The report is under System.')
      } catch (err) {
        lastReport = null
        say(err.message, true)
      }
      dt.classList.remove('busy')
      dt.disabled = false
      label.textContent = was
      lastSig = ''
      refresh()
    }, { cls: 'small' })
    g.append(dt)
    sys.append(g)
    sys.append(clipboardBox())
    sys.append(gameManager(pc))
    if (lastReport) {
      const box = el('div', 'sensor-out', lastReport)
      sys.append(box, rowOf(
        btn('Copy report', async () => {
          if (await copyText(lastReport)) say('Report copied.')
          else say('Could not copy: touch and hold the text to select it instead.', true)
        }),
        btn('Close report', () => {
          lastReport = null
          lastSig = ''
          refresh()
        }),
      ))
    }
  }
  const others = (data.others || []).filter((o) => o.canWake)
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
      item.append(acts)
      list.append(item)
    }
    parts.push(acc('others', 'Other PCs', list, 'laptop'))
  }
  const phones = data.phones || []
  const pcard = el('div', 'card')
  const nowOn = phones.filter((x) => x.connected).length
  pcard.append(section('phone', 'Phones', nowOn + ' connected now'))
  const plist = el('div', 'list')
  for (const ph of phones) {
    const item = el('div', 'item')
    const ic = el('div', 'ic')
    ic.append(icon('phone'))
    const nm = el('div', 'nm', ph.label + (ph.current ? ' (this phone)' : ''))
    const st = el('small', ph.connected ? 'live' : '', ph.connected ? 'connected now' : ph.lastSeen ? 'last seen ' + ago(ph.lastSeen) : 'not seen yet')
    nm.append(st)
    item.append(ic, nm)
    const acts = el('div', 'acts')
    acts.append(btn('Forget', () => act('forget_phone', ph.id), false, 'Forget ' + ph.label + '?'))
    item.append(acts)
    plist.append(item)
  }
  plist.append(el('div', 'note', 'To add another phone, double-click Pair-Phone on the PC and scan its QR code. Phones count as connected while the page is open.'))
  pcard.append(plist)
  p.append(pcard)
  for (const x of parts) sys.append(x)
  if (!helper || parts.length) p.append(sys)
  if (powerCard) p.append(powerCard)
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
