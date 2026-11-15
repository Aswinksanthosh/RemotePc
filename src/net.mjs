/**
 * Which network a connection comes from, and which addresses this PC has.
 * The program only talks to your own devices: this PC, Tailscale, and (if you allow it) your home network.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** 'loopback' | 'tailscale' | 'lan' | 'other' (the open internet, or something unknown). */
export function classifyAddress(addr) {
  let a = String(addr ?? '').toLowerCase()
  if (a.startsWith('::ffff:')) a = a.slice(7)
  if (a === '::1') return 'loopback'
  if (a.startsWith('fd7a:115c:a1e0:')) return 'tailscale'
  if (/^fe[89ab][0-9a-f]:/.test(a) || /^f[cd][0-9a-f]{2}:/.test(a)) return 'lan'
  const m = IPV4.exec(a)
  if (!m) return 'other'
  const [x, y] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((n) => Number(n) > 255)) return 'other'
  if (x === 127) return 'loopback'
  if (x === 100 && y >= 64 && y <= 127) return 'tailscale'
  if (x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254)) return 'lan'
  return 'other'
}

export const isAllowedAddress = (addr, allow) => allow.includes(classifyAddress(addr))

/** Network cards that are not your real network (virtual machines, WSL, Docker, Bluetooth). */
const VIRTUAL = /vethernet|wsl|virtualbox|vmware|docker|hyper-v|loopback|bluetooth|pseudo|vpn/i

/**
 * The IPv4 addresses of this PC: { tailscale: [...], lan: [...] }.
 * `interfaces` is what os.networkInterfaces() returns.
 */
export function listAddresses(interfaces) {
  const out = { tailscale: [], lan: [] }
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    for (const a of list ?? []) {
      if (!a || a.internal || !(a.family === 'IPv4' || a.family === 4)) continue
      const kind = classifyAddress(a.address)
      if (kind === 'tailscale') out.tailscale.push(a.address)
      else if (kind === 'lan' && !VIRTUAL.test(name) && !a.address.startsWith('169.254.')) out.lan.push(a.address)
    }
  }
  return out
}

/**
 * The address a phone should open. Tailscale first (it works anywhere and never changes), else the
 * home network. Only a network the settings allow is offered, so the link always works.
 */
export function phoneUrl(addresses, port, key, allow = ['tailscale', 'lan']) {
  const host = (allow.includes('tailscale') ? addresses.tailscale[0] : undefined) ?? (allow.includes('lan') ? addresses.lan[0] : undefined)
  if (!host) return null
  return `http://${host}:${port}/${key ? `?k=${key}` : ''}`
}
