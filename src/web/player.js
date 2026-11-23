// The pinned player bar: previous, play, next, mute, volume, and what is playing now (read only, from Windows' media controls).

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
