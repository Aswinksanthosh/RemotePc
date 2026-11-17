/**
 * Wake-on-LAN: send a "magic packet" to an off or sleeping PC on the same network cable or Wi-Fi.
 * Only a device on that network can send it, so this runs on a PC that is awake, or on a small
 * always-on device (see docs/START-FROM-OFF.md). A sleeping PC cannot wake itself.
 *
 * The PCs you can start are named in pcs.json, like
 *   { "desk": { "mac": "AA:BB:CC:DD:EE:FF", "page": "http://100.101.102.103:8791" } }
 * ("page" is that PC's own remote page, so the phone can open it once the PC is on.)
 * and nothing outside that file is ever woken.
 */

import { createSocket } from 'node:dgram'
import { readFileSync } from 'node:fs'

/** "AA:BB:CC:DD:EE:FF", "aa-bb-..." or "aabbccddeeff" -> 6 bytes, or null. */
export function parseMac(text) {
  const hex = String(text ?? '').trim().replace(/[:-]/g, '')
  return /^[0-9a-fA-F]{12}$/.test(hex) ? Buffer.from(hex, 'hex') : null
}

/** 6 bytes of 0xFF, then the MAC address 16 times: 102 bytes. */
export function magicPacket(mac) {
  const bytes = Buffer.isBuffer(mac) ? mac : parseMac(mac)
  if (!bytes || bytes.length !== 6) throw new Error('That is not a valid MAC address.')
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)])
}

const isIPv4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((n) => Number(n) <= 255)
const PAGE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/

/** The other PCs you named, as { name: { mac, broadcast, page } }. Bad entries are skipped. */
export function knownPcs(file, readText = (f) => readFileSync(f, 'utf8')) {
  try {
    const out = {}
    for (const [name, d] of Object.entries(JSON.parse(readText(file)))) {
      const key = String(name).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30)
      const mac = parseMac(d?.mac) ? String(d.mac).trim() : ''
      const page = String(d?.page ?? '').trim().replace(/\/$/, '')
      if (!key || (!mac && !PAGE.test(page))) continue
      out[key.toLowerCase()] = {
        label: key,
        mac,
        broadcast: isIPv4(String(d?.broadcast ?? '')) ? d.broadcast : '255.255.255.255',
        page: PAGE.test(page) ? page : '',
        theme: ['neon', 'tactical', 'clean'].includes(d?.theme) ? d.theme : '',
        order: Number.isInteger(d?.order) && d.order >= 0 && d.order <= 99 ? d.order : 0,
      }
    }
    return out
  } catch {
    return {}
  }
}

function sendUdp(packet, address, port) {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', (err) => {
      socket.close()
      reject(err)
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(packet, port, address, (err) => {
        socket.close()
        if (err) reject(err)
        else resolve()
      })
    })
  })
}

/** Sends the packet to ports 9 and 7, the two most common. */
export async function sendMagicPacket(mac, { broadcast = '255.255.255.255', send = sendUdp } = {}) {
  const packet = magicPacket(mac)
  await send(packet, broadcast, 9)
  await send(packet, broadcast, 7)
}
