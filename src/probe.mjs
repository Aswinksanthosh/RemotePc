import { createConnection } from 'node:net'

/** Does something answer at this address? `page` is "http://host:port". Used to show "on" or "not answering" for other PCs. */
export function connect(pageOrDevice, timeout = 1500) {
  const page = typeof pageOrDevice === 'string' ? pageOrDevice : pageOrDevice?.page
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(page)
    } catch {
      return resolve(false)
    }
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    const socket = createConnection({ host: url.hostname, port })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}
