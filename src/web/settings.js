'use strict'
// The Settings page. Every change is saved at once; the PC checks each one again before it keeps it.
// Shared helpers (key, calls, icons, looks, PIN form) are in common.js.
let state = null
let appsHost = null
const onThePc = ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) >= 0

function say2(text, bad) {
  say(text, bad)
}

async function save(changes) {
  try {
    const j = await call('/api/settings/save', { changes })
    say2(j.message || 'Saved.')
    return true
  } catch (err) {
    say2(err.message, true)
    return false
  }
}

// A row with a title, a small explanation and one control on the right.
function row(title, hint, control) {
  const r = el('div', 'set-row')
  const t = el('div', 'set-t')
  t.append(el('div', 'set-name', title))
  if (hint) t.append(el('div', 'set-hint', hint))
  r.append(t, control)
  return r
}

function sw(checked, onChange, disabled) {
  const i = el('input', 'switch')
  i.type = 'checkbox'
  i.checked = !!checked
  i.disabled = !!disabled
  i.addEventListener('change', async () => {
    i.disabled = true
    const ok = await onChange(i.checked)
    if (!ok) i.checked = !i.checked
    i.disabled = !!disabled
  })
  return i
}

function select(options, value, onChange) {
  const s = el('select', 'field')
  for (const [v, label] of options) {
    const o = el('option', '', label)
    o.value = v
    s.append(o)
  }
  s.value = value
  s.addEventListener('change', () => onChange(s.value))
  return s
}

function number(value, min, max, onChange) {
  const i = el('input', 'field num')
  i.type = 'number'
  i.inputMode = 'numeric'
  i.min = String(min)
  i.max = String(max)
  i.value = String(value)
  i.addEventListener('change', () => {
    const n = Number.parseInt(i.value, 10)
    if (Number.isInteger(n) && n >= min && n <= max) onChange(n)
    else {
      i.value = String(value)
      say2('Enter a number from ' + min + ' to ' + max + '.', true)
    }
  })
  return i
}

function card(iconName, title, ...rows) {
  const c = el('div', 'card')
  c.append(section(iconName, title))
  c.append(...rows)
  return c
}



function rowOnly(...kids) {
  const r = el('div', 'set-col')
  r.append(...kids)
  return r
}

async function appsCard() {
  const c = el('div', 'card')
  c.append(section('grid', 'My apps', 'show up in Open apps'))
  const list = el('div', 'list')
  const draw = async (answer) => {
    let apps = answer
    if (!apps) {
      try {
        apps = (await call('/api/settings/apps', { op: 'list' })).apps
      } catch (err) {
        list.textContent = err.message
        return
      }
    }
    list.textContent = ''
    if (!apps.length) list.append(el('div', 'empty', 'No apps added yet. Pick one below.'))
    for (const a of apps) {
      const item = el('div', 'item')
      const ic = el('div', 'ic')
      ic.append(el('span', 'letter', a.label.charAt(0).toUpperCase()))
      const nm = el('div', 'nm', a.label)
      nm.append(el('small', '', 'Start menu: ' + a.match))
      item.append(ic, nm)
      const acts = el('div', 'acts')
      acts.append(btn('Remove', async () => {
        try {
          draw((await call('/api/settings/apps', { op: 'remove', label: a.label })).apps)
        } catch (err) {
          say2(err.message, true)
        }
      }, false, 'Remove ' + a.label + '?'))
      item.append(acts)
      list.append(item)
    }
  }
  c.append(list)
  c.append(pickerBox(draw))
  draw()
  return c
}

// On the PC only: pick from every app this laptop has, or drop an app's shortcut on the box. A web page never learns
// where a dropped file lives, only its name, so the name is matched against the Start menu list the laptop gives us.
function pickerBox(draw) {
  const box = el('div', 'pinform')
  const zone = el('div', 'drop', onThePc ? 'Drop an app shortcut here, or pick from the list' : 'Pick an app from this laptop below')
  const search = el('input', 'field')
  search.type = 'text'
  search.maxLength = 40
  search.placeholder = 'Search the apps on this laptop'
  const results = el('div', 'list')
  let names = null
  const add = async (name) => {
    try {
      draw((await call('/api/settings/apps', { op: 'add', label: name.slice(0, 30), match: name })).apps)
      say2('Added ' + name + '. It shows in Open apps.')
    } catch (err) {
      say2(err.message, true)
    }
  }
  const show = () => {
    results.textContent = ''
    const q = search.value.trim().toLowerCase()
    for (const n of (names || []).filter((x) => !q || x.toLowerCase().indexOf(q) >= 0).slice(0, 12)) {
      const item = el('div', 'item')
      item.append(el('div', 'nm', n))
      const acts = el('div', 'acts')
      acts.append(btn('Add', () => add(n), false, undefined, 'go'))
      item.append(acts)
      results.append(item)
    }
    if (names && !results.childNodes.length) results.append(el('div', 'empty', 'Nothing matches. Games belong in the Steam list, not here.'))
  }
  const load = async () => {
    if (names) return
    try {
      names = (await call('/api/settings/startapps')).names
    } catch (err) {
      say2(err.message, true)
      names = []
    }
    show()
  }
  search.addEventListener('focus', load)
  search.addEventListener('input', () => load().then(show))
  if (onThePc) zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('over'))
  zone.addEventListener('drop', async (e) => {
    e.preventDefault()
    zone.classList.remove('over')
    await load()
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (!f) return say2('Drop the shortcut file itself (from the Desktop or Start menu folder).', true)
    const base = f.name.replace(/\.(lnk|exe|url|appref-ms)$/i, '').toLowerCase()
    const hit = names.find((n) => n.toLowerCase() === base) || names.find((n) => n.toLowerCase().indexOf(base) >= 0 || base.indexOf(n.toLowerCase()) >= 0)
    if (hit) add(hit)
    else {
      search.value = base
      show()
      say2('Could not match "' + base + '" for sure. Pick it from the list below.', true)
    }
  })
  box.append(zone, search, results)
  return box
}

function addPhoneCard() {
  const c = el('div', 'card')
  c.append(section('phone', 'Add a phone', 'only on this PC'))
  const out = el('div', 'qrbox')
  c.append(btn('Show a new QR code', async () => {
    out.textContent = ''
    try {
      const j = await call('/api/local/pair')
      const img = document.createElement('img')
      img.alt = 'QR code: scan it with the phone camera'
      img.className = 'qr'
      img.src = URL.createObjectURL(new Blob([j.svg], { type: 'image/svg+xml' }))
      out.append(img, el('div', 'note', j.label + ': scan this with the phone camera and tap the link. Do not share this picture: it is the key to your PC.'))
    } catch (err) {
      out.textContent = err.message
    }
  }, false, undefined, 'go'), out)
  return c
}

function pinCard(v) {
  const c = el('div', 'card')
  c.append(section('lock', 'Security'))
  c.append(row('PIN', v.hasPin ? 'A PIN is set. Phones type it when they open the remote.' : 'No PIN is set. A paired phone opens the remote without asking.', el('span')))
  const form = el('div', 'pinform')
  const cur = el('input', 'field')
  cur.type = 'password'
  cur.inputMode = 'numeric'
  cur.maxLength = 8
  cur.placeholder = 'Current PIN'
  cur.autocomplete = 'off'
  cur.hidden = !v.hasPin
  const nw = el('input', 'field')
  nw.type = 'password'
  nw.inputMode = 'numeric'
  nw.maxLength = 8
  nw.placeholder = 'New PIN (4 to 8 digits)'
  nw.autocomplete = 'off'
  const again = el('input', 'field')
  again.type = 'password'
  again.inputMode = 'numeric'
  again.maxLength = 8
  again.placeholder = 'New PIN again'
  again.autocomplete = 'off'
  const go = btn(v.hasPin ? 'Change PIN' : 'Set PIN', async () => {
    if (nw.value !== again.value) return say2('The two new PINs are different.', true)
    try {
      const j = await call('/api/settings/pin', { current: cur.value, next: nw.value })
      say2(j.message)
      setTimeout(() => location.reload(), 900)
    } catch (err) {
      say2(err.message, true)
    }
  }, false, undefined, 'go')
  const rm = btn('Remove PIN', async () => {
    try {
      const j = await call('/api/settings/pin', { current: cur.value, next: '' })
      say2(j.message)
      setTimeout(() => location.reload(), 900)
    } catch (err) {
      say2(err.message, true)
    }
  }, !v.hasPin, 'Remove the PIN? Anyone with a paired phone could then use the remote.')
  const buttons = el('div', 'row')
  buttons.append(go)
  if (v.hasPin) buttons.append(rm)
  form.append(cur, nw, again, buttons)
  c.append(form)
  c.append(row('PIN stays valid for', 'hours, on each phone', number(v.values.pinHours, 1, 720, (n) => save({ pinHours: n }))))
  c.append(row('Allow my home Wi-Fi', 'Normally only Tailscale can connect. Turn this on only on a network you trust. Applies after the program restarts.', sw(v.values.lan, (on) => save({ lan: on }))))
  return c
}

function render() {
  const v = state
  const app = $('app')
  app.textContent = ''
  const name = v.values.name || v.host || 'This PC'
  setTheme(themeOf({ name, theme: v.values.theme, accent: v.values.accent, model: v.host }))
  const p = el('div', 'panel')

  const top = el('div', 'top')
  const back = el('button', 'b pwr')
  back.type = 'button'
  back.setAttribute('aria-label', 'Back')
  back.append(icon('back'))
  back.addEventListener('click', () => {
    location.href = '/'
  })
  const txt = el('div', 'txt')
  txt.append(el('h1', '', 'Settings'), el('div', 'model', name + (v.version ? '  ·  version ' + v.version : '')))
  top.append(back, txt)
  p.append(top)

  // -- startup ----------------------------------------------------------------------------
  const startup = []
  if (v.windows) {
    startup.push(
      row('Start with Windows', v.startupTask === 'missing' ? 'There is no automatic start yet. Run Install.cmd on the PC.' : 'Starts the remote when you sign in to Windows. If you turn it off here, you must turn it on again on the PC.', sw(v.startupTask === 'on', async (on) => {
        try {
          const j = await call('/api/settings/task', { on })
          say2(j.state === 'on' ? 'The remote starts with Windows.' : 'The remote no longer starts with Windows.')
          return true
        } catch (err) {
          say2(err.message, true)
          return false
        }
      }, v.startupTask === 'missing')),
    )
    startup.push(row('Open Steam Big Picture at startup', 'Once per boot, as soon as the remote starts. Works in Xbox full screen mode too.', sw(v.values.steamAtStart, (on) => save({ steamAtStart: on }))))
    startup.push(row('Wait before opening it', 'seconds (0 is at once)', number(v.values.steamDelay, 0, 300, (n) => save({ steamDelay: n }))))
    startup.push(row('Power mode at startup', 'Set once per boot. Efficiency is good while downloading.', select([['', 'Leave as it is'], ['saver', 'Efficiency'], ['balanced', 'Balanced'], ['gaming', 'Performance']], v.values.startMode, (m) => save({ startMode: m }))))
  } else startup.push(el('div', 'empty', 'Startup options are for Windows PCs.'))
  p.append(card('power', 'Startup', ...startup))

  // -- look -------------------------------------------------------------------------------
  p.append(
    card('wrench', 'Look and name',
      row('Name on the page', 'empty uses the PC name', (() => {
        const i = el('input', 'field')
        i.type = 'text'
        i.maxLength = 30
        i.value = v.values.name
        i.placeholder = v.host || ''
        i.addEventListener('change', () => save({ name: i.value.trim() }))
        return i
      })()),
      row('Starting theme', 'Each phone can still pick its own on the main page.', select([['', 'Automatic'], ['neon', 'Neon'], ['tactical', 'Tactical'], ['clean', 'Clean']], v.values.theme, async (t) => {
        if (await save({ theme: t })) {
          v.values.theme = t
          render()
        }
      })),
      row('Place in the swipe bar', 'when you own several PCs: lower is further left', number(v.values.order, 0, 99, (n) => save({ order: n }))),
    ),
  )

  // -- your own apps, adding a phone (only on the PC) ----------------------------------------
  if (v.windows) appsHost = el('div')
  if (appsHost) {
    p.append(appsHost)
    appsCard().then((c) => appsHost.append(c))
  }
  if (onThePc) p.append(addPhoneCard())

  // -- security ---------------------------------------------------------------------------
  p.append(pinCard(v))

  // -- about ------------------------------------------------------------------------------
  const about = []
  about.push(row('Version', v.version || 'unknown', el('span')))
  if (v.windows) {
    about.push(row('Restart the remote', 'Needed after some changes. The page comes back in about 15 seconds.', btn('Restart', async () => {
      try {
        const j = await call('/api/settings/restart')
        say2(j.message)
      } catch (err) {
        say2(err.message, true)
      }
    }, false, 'Restart the remote on this PC?')))
  }
  if (v.windows && onThePc) {
    const tool = (label, tip, tool, sure) => row(label, tip, btn(label, async () => {
      try {
        say2((await call('/api/settings/tool', { tool })).message)
      } catch (err) {
        say2(err.message, true)
      }
    }, false, sure))
    about.push(tool('Update App', 'Download the newest version, install it and restart. One button for both.', 'update'))
    about.push(tool('Fix-It', 'Checks everything and tells you what to do.', 'fixit'))
    about.push(tool('Uninstall', 'Removes RemotePc from this PC. Your settings folder is kept.', 'uninstall', 'Uninstall RemotePc?'))
  }
  p.append(card('pulse', 'About', ...about))
  p.append(footer(v.feedback, v.version, 'settings page'))
  app.append(p)
}

// Sliding hold-to-confirm buttons are shared with the main page (btn lives in app.js there); here is a small one.
function btn(label, fn, disabled, sure, cls) {
  const b = el('button', 'b' + (cls ? ' ' + cls : '') + (sure ? ' hold' : ''), label)
  b.type = 'button'
  b.disabled = !!disabled
  if (!sure) {
    b.addEventListener('click', fn)
    return b
  }
  let t = 0
  const start = () => {
    if (b.disabled || t) return
    b.classList.add('holding')
    t = setTimeout(() => {
      t = 0
      b.classList.remove('holding')
      fn()
    }, 800)
  }
  const stop = () => {
    if (t) {
      clearTimeout(t)
      t = 0
      b.classList.remove('holding')
      say2('Keep holding to confirm: ' + sure)
    }
  }
  b.addEventListener('pointerdown', (e) => {
    if (!e.button) start()
  })
  for (const n of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(n, stop)
  b.addEventListener('contextmenu', (e) => e.preventDefault())
  b.addEventListener('click', (e) => e.preventDefault())
  return b
}

async function load() {
  try {
    state = await call('/api/settings')
    render()
  } catch (err) {
    if (err.status === 401 && err.code === 'pin') {
      $('app').textContent = ''
      $('app').append(makePinForm('', load))
    } else if (err.status === 401) {
      $('app').textContent = ''
      $('app').append(el('p', 'loading', 'This phone is not paired. Open the pairing link from the PC again.'))
    } else {
      $('app').textContent = ''
      $('app').append(el('p', 'loading', err.status === 404 ? 'Settings are not available here.' : 'Cannot reach the PC.'))
    }
  }
}
load()
