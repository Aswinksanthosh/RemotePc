// The small managers on the main page: apps, games, the clipboard box and the list of open windows.

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
