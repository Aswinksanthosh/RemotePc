// The cards of the main page, one function each (render() in app.js only puts them in order).

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

// The favourite devices sit right above the drop-down they belong to: Bluetooth favourites above the Bluetooth list, favourite sound outputs above Sound output.
function favChips(kind, pc) {
  const fav = (pc.favorites || {})[kind] || []
  const chips = []
  if (kind === 'bt') {
    const heads = pc.headphones || []
    const on = pc.btConnected || []
    for (const name of fav) {
      if (!heads.includes(name)) continue
      const isOn = on.includes(name)
      const c = btn(name, () => act(isOn ? 'bt_disconnect' : 'bt_connect', name), false, undefined, 'chip' + (isOn ? ' on' : ''))
      c.textContent = ''
      c.title = isOn ? 'Connected: tap to disconnect' : 'Tap to connect'
      const pct = (pc.btBattery || {})[name]
      c.append(icon('bluetooth'), el('span', 'chip-t', name), el('small', '', isOn ? 'connected' + (pct ? ' · ' + pct + '%' : '') : 'connect'))
      chips.push(c)
    }
  } else {
    const outs = pc.outputs || []
    for (const name of fav) {
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
  }
  if (!chips.length) return null
  const row = el('div', 'chips favrow')
  row.setAttribute('aria-label', kind === 'bt' ? 'Favourite Bluetooth devices' : 'Favourite sound outputs')
  row.append(...chips)
  return row
}

function topBar(pc, helper, sh, run) {
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
}

function powerCard(run) {
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
  return quick
}

function steamCard(pc, run) {
  const games = pc.games || []
  const st = pc.steam
  if (!(st || games.length)) return null
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
  return steam
}

function bluetoothCard(pc) {
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
      btIn.append(el('div', 'note', hf.ready ? 'On: no more bad sound when the mic is used. The earbuds own mic stops working. Turn off for calls.' : 'First run Admin-Setup on this PC once (Start menu, asks for administrator rights).'))
      // A way out whatever state the page thinks it is in: turns every Hands-Free device back on (earbuds without sound or that will not connect).
      if (hf.ready) {
        btIn.append(el('div', 'note', 'Earbuds have no sound or will not connect? Restore turns Hands-Free back on, then disconnect and connect the earbuds.'))
        btIn.append(btn('Restore Hands-Free', () => act('handsfree_set', 'off'), false, undefined, 'small'))
      }
    } else {
      // Never silently hidden: say why the switch is not here.
      btIn.append(el('div', 'note', hf ? 'Clear sound: Windows lists no Hands-Free device for your Bluetooth devices, so the switch cannot work here. Open Diagnostics (System card) and send the "Clear sound" line.' : 'Clear sound: could not read from Windows. Open Diagnostics (System card) for the reason.'))
    }
    btIn.append(list)
    btIn.append(el('div', 'note', 'Earbuds must be in range and not busy with another device. Disconnect frees them for your phone.'))
  }
  const favs = favChips('bt', pc)
  if (favs) bt.append(favs)
  bt.append(acc('bt', heads.length ? 'Bluetooth devices (' + ((pc.btConnected || []).length ? (pc.btConnected || []).length + ' connected of ' : '') + heads.length + ')' : 'Bluetooth devices', btIn, 'bluetooth'))
  return bt
}

function soundCard(pc) {
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
  const favs = favChips('out', pc)
  if (favs) snd.append(favs)
  snd.append(acc('sound', sndName ? 'Sound output: ' + sndName : 'Sound output', sndIn, 'speaker'))
  return snd
}

function modeCard(pc, run) {
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
  const gpuBox = gpuRow(pc)
  if (gpuBox) mode.append(gpuBox)
  return mode
}

// The NVIDIA GPU switch (only on a PC that has one). Off = the laptop uses its integrated GPU. It is refused unless another working GPU exists.
function gpuRow(pc) {
  const g = pc.gpu
  if (!g || !g.nvidia) return null
  const box = el('div', 'gpubox')
  const row = el('div', 'hfrow')
  const canOff = g.ready && g.otherOk
  const button = g.on
    ? btn('Turn off', () => confirmBox('Turn off the NVIDIA GPU?', 'The laptop uses its integrated GPU instead. Games run slower or may not start, and the screen may blink for a moment.', 'Turn off', () => act('gpu_set', 'off')), !canOff)
    : btn('Turn on', () => act('gpu_set', 'on'), !g.ready, undefined, 'go')
  row.append(el('div', 'nm', 'NVIDIA GPU: ' + (g.on ? 'on' : 'off')), button)
  box.append(row)
  const note = !g.ready
    ? 'First run Admin-Setup on this PC once (Start menu, asks for administrator rights).'
    : g.on && !g.otherOk
      ? 'No other working GPU was found, so it cannot be turned off safely.'
      : g.on
        ? 'Off = the laptop uses its integrated GPU (cooler, slower games). It only turns off while another GPU works.'
        : 'The laptop is using its integrated GPU. Turn on before playing games.'
  box.append(el('div', 'note', note))
  if (g.version) box.append(el('div', 'note' + (g.suspect ? ' warn' : ''), g.suspect ? 'Driver ' + g.version + ' is one of those reported to write a lot to the SSD while idle (not confirmed by NVIDIA). Turning the GPU off stops it.' : 'NVIDIA driver ' + g.version))
  return box
}

function windowsCard() {
  winBox = el('div', 'winbox')
  const winCard = el('div', 'card')
  winCard.append(acc('windows', 'Windows', winBox, 'laptop', () => loadWindows()))
  drawWindows()
  return winCard
}

function appsCard(pc) {
  const apps = pc.apps || []
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
  return card
}

function buttonsCard(pc) {
  if (!(pc.buttons || []).length) return null
  const card = el('div', 'card')
  card.append(section('terminal', 'My buttons', 'hold to run'))
  const g2 = el('div', 'grid2')
  for (const name of pc.buttons) g2.append(tile('terminal', name, () => act('button', name), { sure: 'Run "' + name + '"?', cls: 'small' }))
  card.append(g2)
  return card
}

function systemCard(pc, helper, run) {
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
  for (const x of parts) sys.append(x)
  return !helper || parts.length ? sys : null
}

function phonesCard() {
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
  return pcard
}
