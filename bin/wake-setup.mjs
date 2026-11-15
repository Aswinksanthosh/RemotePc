#!/usr/bin/env node
// Gets this PC ready to be started over the network. Wake-on-LAN-Setup.cmd runs this (as administrator).
import { networkInterfaces } from 'node:os'
import { loadConfig } from '../src/config.mjs'
import { listAddresses } from '../src/net.mjs'
import { dataPaths } from '../src/paths.mjs'
import { run } from '../src/system.mjs'
import { createUi } from '../src/ui.mjs'
import { describeWol, parseWol, wolScript } from '../src/wol.mjs'
import { psArgs } from '../src/windows.mjs'

const ui = createUi()
ui.title('Remote Start PC: get this PC ready to be started over the network')
if (process.platform !== 'win32') {
  ui.fail('This part works on Windows only.')
  process.exit(1)
}
try {
  const parsed = parseWol(await run('powershell.exe', psArgs(wolScript), { timeout: 60_000 }))
  const config = loadConfig(dataPaths().config)
  const ip = listAddresses(networkInterfaces()).tailscale[0] ?? ''
  ui.blank()
  for (const line of describeWol(parsed, { ip, port: config.port })) ui.say(`  ${line}`)
  ui.blank()
  ui.say('  The full guide, including other ways to start a PC from your phone: docs/START-FROM-OFF.md')
} catch (err) {
  ui.fail(`Could not read the network cards: ${err.message}`)
  process.exit(1)
}
