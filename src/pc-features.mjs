/**
 * Small self-contained features of the PC side, each built from what it needs (how to run PowerShell, the clock ...), so they can be
 * read and tested on their own: the clipboard, the list of open windows, and "now playing".
 */

import { CLIP_GET, CLIP_MAX, clipSetScript, windowsScript } from './ps-scripts.mjs'
import { MEDIA_COVER, MEDIA_INFO, parseMedia, pictureType } from './media.mjs'
import { swr } from './cache.mjs'

/** Text between the phone and this PC's clipboard (at most CLIP_MAX characters; the text travels as base64 inside the script). */
export function createClipboard({ ps, winOnly }) {
  return {
    async set(text) {
      winOnly()
      if (typeof text !== 'string' || !text.length) throw new Error('There is nothing to copy.')
      if (text.length > CLIP_MAX) throw new Error(`That text is too long (limit ${CLIP_MAX} characters).`)
      if (!/ok\s*$/.test(await ps(clipSetScript(text), { timeout: 15_000 }))) throw new Error('Windows would not take the text.')
      return `Copied ${text.length} characters to this PC's clipboard.`
    },
    async get() {
      winOnly()
      const b64 = (await ps(CLIP_GET, { timeout: 15_000 })).trim()
      return /^[A-Za-z0-9+/=]*$/.test(b64) ? Buffer.from(b64, 'base64').toString('utf8').slice(0, CLIP_MAX) : ''
    },
  }
}

/** The windows open on this PC: a list, then focus or close one of THAT list (by the id it was shown with, for five minutes). */
export function createWindows({ ps, winOnly, now }) {
  const shown = { at: -Infinity, byId: new Map() }
  return {
    async list() {
      winOnly()
      const out = await ps(windowsScript('list'), { timeout: 15_000 })
      const list = []
      for (const line of out.split(/\r?\n/)) {
        const [id, name, minimized, ...rest] = line.split('\t')
        const title = rest.join(' ').trim()
        if (!/^\d{1,18}$/.test(id ?? '') || !title) continue
        list.push({ id, name: (name || '').slice(0, 40), title: title.slice(0, 120), minimized: minimized === '1' })
        if (list.length >= 40) break
      }
      shown.byId = new Map(list.map((w) => [w.id, w]))
      shown.at = now()
      return list
    },
    async act(op, arg) {
      winOnly()
      const id = String(arg ?? '')
      const w = shown.byId.get(id)
      if (!w || now() - shown.at > 5 * 60_000) throw new Error('Open the Windows list again (Refresh), then try once more.')
      const out = (await ps(windowsScript(op, id), { timeout: 15_000 })).trim().split(/\r?\n/).at(-1)
      if (out === 'gone') {
        shown.byId.delete(id)
        throw new Error('That window is already closed. Press Refresh.')
      }
      if (out !== 'ok') throw new Error('Windows did not let me do that.')
      if (op === 'close') shown.byId.delete(id)
      return op === 'focus' ? `Switched to "${w.title}".` : `Asked "${w.title}" to close. If it has unsaved work it may ask you first.`
    },
  }
}

/** Now playing: asked at most every 3 s whatever the number of phones; the cover once per song. */
export function createMedia({ ps, track, now, platform }) {
  const current = swr(3000, track('now playing', async () => (platform === 'win32' ? parseMedia(await ps(MEDIA_INFO, { timeout: 15_000 })) : null)), now)
  let cover = { key: '', pic: null }
  return {
    now: current,
    async cover() {
      const m = await current()
      if (!m) return null
      const key = `${m.title}|${m.artist}`
      if (cover.key !== key) {
        cover = { key, pic: null }
        try {
          const b64 = (await ps(MEDIA_COVER, { timeout: 15_000 })).trim()
          const bytes = /^[A-Za-z0-9+/=]{20,}$/.test(b64) ? Buffer.from(b64, 'base64') : null
          if (bytes && pictureType(bytes)) cover.pic = { type: pictureType(bytes), bytes }
        } catch {
          // No cover: the page shows a note symbol.
        }
      }
      return cover.pic
    },
  }
}
