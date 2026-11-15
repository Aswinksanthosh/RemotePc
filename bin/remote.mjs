#!/usr/bin/env node
// Starts the phone remote. The hidden launcher (start.ps1) runs this at every sign-in.
//
// Exit codes the launcher understands:
//   0   stop for good (another copy is already running)
//   75  start me again now (after an update)
//   other: it crashed; the launcher waits a few seconds and starts it again
import { startApp } from '../src/app.mjs'
import { appendLog } from '../src/fsutil.mjs'
import { dataPaths } from '../src/paths.mjs'

const paths = dataPaths()

// Everything printed is also written to remote.log (kept small), so Fix-It can show what happened.
const tee = (name) => {
  const original = console[name].bind(console)
  console[name] = (...args) => {
    original(...args)
    try {
      appendLog(paths.log, `${new Date().toISOString()}  ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`)
    } catch {
      // The log is only a help.
    }
  }
}
tee('log')
tee('error')

process.on('uncaughtException', (err) => {
  console.error('[remote] crashed:', err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  console.error('[remote] unexpected error:', err)
})

try {
  await startApp({})
} catch (err) {
  if (err?.code === 'EADDRINUSE') {
    console.log('[remote] the port is already in use: another copy of the remote is probably running. Stopping this one.')
    process.exit(0)
  }
  console.error('[remote] could not start:', err)
  process.exit(1)
}
