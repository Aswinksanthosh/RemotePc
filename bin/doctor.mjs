#!/usr/bin/env node
// Fix-It: checks everything and says what to do. Fix-It.cmd runs this.
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { runDoctor } from '../src/doctor.mjs'
import { dataPaths } from '../src/paths.mjs'
import { run } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'

const paths = dataPaths()
const ui = createUi({ color: supportsColor() })
ui.title('Fix-It: checking your Remote Start PC')
const { results, log, problems, up } = await runDoctor({ paths, run, interfaces: networkInterfaces(), exists: existsSync })
for (const r of results) {
  const mark = r.level === 'ok' ? ui.paint('green bold', '[ OK ]') : r.level === 'warn' ? ui.paint('yellow bold', '[ !! ]') : ui.paint('red bold', '[FAIL]')
  ui.say(`  ${mark} ${ui.paint('white bold', r.name)}: ${r.detail}`)
  if (r.fix) ui.say(`         ${ui.paint('cyan', '->')} ${ui.paint('cyan', r.fix)}`)
}
if (!up && log) {
  ui.blank()
  ui.say('  Last lines of the remote log:')
  for (const line of log.split('\n')) ui.say(`    ${line}`)
}
ui.blank()
if (problems === 0) ui.say('  Everything looks fine. If the phone still cannot connect, check that Tailscale is on, on the phone too.')
else ui.say(`  ${problems} thing${problems === 1 ? '' : 's'} to fix. Most are fixed by double-clicking Install.cmd again (safe to repeat).`)
process.exit(problems ? 1 : 0)
