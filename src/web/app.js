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

// -- looks ---------------------------------------------------------------------------------------
// -- several PCs: a swipe card and a hand-over between their pages ---------------------------------
let enterInfo = null
try {
  const h = new URLSearchParams(location.hash.slice(1))
  if (h.get('from') === 'left' || h.get('from') === 'right') enterInfo = { dir: h.get('from'), t: h.get('t') || '' }
} catch (e) {
  // No hand-over.
}

function pcsInOrder(pc, others) {
  const list = [{ name: pc.name, theme: themeOf(pc), order: pc.order || 0, self: true }]
  for (const o of others) if (o.page) list.push({ name: o.name, theme: o.theme || guessTheme(o.name), order: o.order || 0, page: o.page })
  return list.sort((x, y) => x.order - y.order || x.name.localeCompare(y.name))
}

let going = false
// Slides this page away while the colours change into the next PC's look, then opens that PC's page, which slides in.
function go(target, dir) {
  if (going || !target || target.self) return
  going = true
  const from = document.body.dataset.theme
  const panel = document.querySelector('.panel')
  if (panel) panel.classList.add(dir > 0 ? 'leave-left' : 'leave-right')
  setTheme(target.theme)
  if (navigator.vibrate) navigator.vibrate(15)
  setTimeout(() => {
    going = false
    if (window.__navigate) window.__navigate(target, dir, from)
    else location.href = target.page + '#from=' + (dir > 0 ? 'right' : 'left') + '&t=' + encodeURIComponent(from)
  }, 340)
}

function pagerCard(list, meIndex) {
  const card = el('div', 'card pager')
  const prev = el('button', 'arrow')
  prev.type = 'button'
  prev.setAttribute('aria-label', 'Previous PC')
  const left = icon('next')
  left.style.transform = 'scaleX(-1)'
  prev.append(left)
  prev.disabled = meIndex === 0
  const next = el('button', 'arrow')
  next.type = 'button'
  next.setAttribute('aria-label', 'Next PC')
  next.append(icon('next'))
  next.disabled = meIndex === list.length - 1
  const mid = el('div', 'mid')
  const pills = el('div', 'pills')
  list.forEach((x, i) => {
    const b = el('button', 'pill' + (i === meIndex ? ' on' : ''))
    b.type = 'button'
    b.append(icon('laptop'), el('span', '', x.name))
    b.addEventListener('click', () => go(list[i], i - meIndex))
    pills.append(b)
  })
  mid.append(pills, el('div', 'hint', 'swipe to change PC'))
  card.append(prev, mid, next)
  prev.addEventListener('click', () => go(list[meIndex - 1], -1))
  next.addEventListener('click', () => go(list[meIndex + 1], 1))
  // Swipe: a sideways drag of this card.
  let x0 = 0
  let y0 = 0
  let on = false
  card.addEventListener('pointerdown', (e) => {
    if (e.button) return
    on = true
    x0 = e.clientX
    y0 = e.clientY
  })
  card.addEventListener('pointerup', (e) => {
    if (!on) return
    on = false
    const dx = e.clientX - x0
    const dy = e.clientY - y0
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const to = meIndex + (dx < 0 ? 1 : -1)
      if (list[to]) go(list[to], dx < 0 ? 1 : -1)
    }
  })
  card.addEventListener('pointercancel', () => {
    on = false
  })
  return card
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

function render() {
  const pc = data.pc
  const app = $('app')
  const myTheme = themeOf(pc)
  app.textContent = ''
  const p = el('div', 'panel')
  const helper = !pc.control
  const others0 = data.others || []
  const order = pcsInOrder(pc, others0)
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
  const gear = el('button', 'b pwr')
  gear.type = 'button'
  gear.title = 'Settings'
  gear.setAttribute('aria-label', 'Settings')
  gear.append(icon('gear'))
  gear.addEventListener('click', () => {
    location.href = '/settings?k=' + encodeURIComponent(key)
  })
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
  p.append(top)
  if (!helper && order.length > 1) p.append(pagerCard(order, order.findIndex((x) => x.self)))
  let powerCard = null
  let mediaCard = null

  if (!helper) {
    // -- power and lock (shown last: used the least) -------------------------------------------------------------------
    const quick = el('div', 'card')
    quick.append(section('power', 'Power'))
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
    powerCard = quick

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
    mediaCard = media

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
    const btCard = bt

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
    p.append(btCard)

    p.append(mediaCard)

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

  if (!helper) p.append(themeCard(pc))

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
  p.append(footer(data.feedback, data.version, 'main page'))
  app.append(p)

  // First page after a hand-over from another PC: start in its look and slide in, while the colours settle into this PC's look.
  if (enterInfo) {
    const e = enterInfo
    enterInfo = null
    if (e.t) setTheme(e.t)
    p.classList.add('enter-' + e.dir)
    setTimeout(() => setTheme(myTheme), 90)
  } else setTheme(myTheme)
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
