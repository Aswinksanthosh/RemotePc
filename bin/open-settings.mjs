#!/usr/bin/env node
// Opens the Settings page on this PC, in the normal browser. Settings.cmd runs this.
import { loadConfig } from '../src/config.mjs'
import { dataPaths } from '../src/paths.mjs'
import { openTarget } from '../src/system.mjs'

const config = loadConfig(dataPaths().config)
const url = `http://127.0.0.1:${config.port}/settings`
try {
  const res = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(2500) })
  if (!res.ok) throw new Error('not running')
} catch {
  console.log('The remote is not running right now. Double-click Fix-It if the page does not open.')
}
console.log(`Opening ${url}`)
openTarget(url)
