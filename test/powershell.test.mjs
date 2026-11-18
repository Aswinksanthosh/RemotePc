// Only runs on Windows (the CI has a Windows machine): every PowerShell script this project contains must at least parse,
// and the harmless read-only ones must run. On other systems these tests are skipped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { POWERSHELL_SNIPPETS } from '../src/actions.mjs'
import { SENSOR_REPORT, SENSOR_STREAM } from '../src/limiter.mjs'
import { desktopShortcutScript, launcherScript, limiterLauncherScript, psArgs, registerLimiterTaskScript, registerTaskScript, removeLimiterTaskScript, removeTaskScript, shortcutsScript, stopRemoteScript } from '../src/windows.mjs'
import { wolScript } from '../src/wol.mjs'

const windows = process.platform === 'win32'
const scripts = {
  ...Object.fromEntries(Object.entries(POWERSHELL_SNIPPETS).map(([k, v]) => [`actions: ${k}`, v])),
  'windows: launcher': launcherScript({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', entry: 'C:\\x\\app\\bin\\remote.mjs', home: 'C:\\x' }),
  'windows: register task': registerTaskScript('C:\\x\\start.ps1'),
  'windows: remove task': removeTaskScript,
  'windows: stop remote': stopRemoteScript,
  'windows: shortcuts': shortcutsScript('C:\\x\\app'),
  'wol: network cards': wolScript,
  'limiter: sensor stream': SENSOR_STREAM,
  'limiter: sensor report': SENSOR_REPORT,
  'limiter: register task': registerLimiterTaskScript('C:\\ProgramData\\RemortStartPc\\limiter-start.ps1'),
  'limiter: remove task': removeLimiterTaskScript,
  'limiter: launcher': limiterLauncherScript({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\ProgramData\\RemortStartPc\\limiter.mjs', config: 'C:\\Users\\me\\.remortstartpc\\config.json', dir: 'C:\\ProgramData\\RemortStartPc' }),
  'windows: desktop shortcut': desktopShortcutScript('C:\\Users\\me\\.remortstartpc'),
}

const PARSE = '$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$t, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 }'

for (const [name, script] of Object.entries(scripts)) {
  test(`PowerShell parses: ${name}`, { skip: !windows && 'needs Windows' }, () => {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PARSE], { input: script, encoding: 'utf8' })
  })
}

test('PowerShell runs: model name and battery (read-only)', { skip: !windows && 'needs Windows' }, () => {
  for (const key of ['model', 'battery']) execFileSync('powershell.exe', psArgs(POWERSHELL_SNIPPETS[key]), { encoding: 'utf8', timeout: 60_000 })
  assert.ok(true)
})

test('the scripts exist and none is empty (also on systems without Windows)', () => {
  for (const [name, script] of Object.entries(scripts)) assert.ok(script.trim().length > 20, name)
})
