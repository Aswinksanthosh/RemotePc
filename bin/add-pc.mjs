#!/usr/bin/env node
// Adds another PC to the "Other PCs" list (to start it or open its page).
//   node bin/add-pc.mjs "Name" AA:BB:CC:DD:EE:FF http://100.x.y.z:8791
// The MAC address and the page address are both optional ("" to skip one).
import { readFileSync } from 'node:fs'
import { writeAtomic } from '../src/fsutil.mjs'
import { dataPaths } from '../src/paths.mjs'
import { knownPcs, parseMac } from '../src/wake.mjs'

const [name, mac = '', page = ''] = process.argv.slice(2)
const paths = dataPaths()
if (!name) {
  console.error('Usage: node bin/add-pc.mjs "Name" [MAC address] [page address]')
  process.exit(1)
}
if (mac && !parseMac(mac)) {
  console.error('That MAC address does not look right. It has 12 letters and numbers, like AA:BB:CC:DD:EE:FF.')
  process.exit(1)
}
let list = {}
try {
  list = JSON.parse(readFileSync(paths.pcs, 'utf8'))
} catch {
  // A new file.
}
list[name] = { ...(mac ? { mac } : {}), ...(page ? { page } : {}) }
writeAtomic(paths.pcs, `${JSON.stringify(list, null, 2)}\n`)
const ok = Object.keys(knownPcs(paths.pcs)).includes(name.toLowerCase().trim())
console.log(ok ? `Added "${name}". It shows under Other PCs on the phone page.` : 'Saved, but the entry looks incomplete (it needs a valid MAC address or a page address like http://100.1.2.3:8791).')
