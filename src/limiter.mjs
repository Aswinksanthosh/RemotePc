/**
 * The temperature limiter. Below your limit nothing is restricted (the CPU and GPU boost as they normally do). Above it, the speed
 * is lowered a little at a time until the temperature is back under the limit, then raised again step by step.
 *
 *   CPU: Windows power settings (turn boost off first, then lower the maximum processor state step by step), no admin tricks.
 *   GPU: NVIDIA only: lock the graphics clock a bit lower (nvidia-smi -lgc), released with -rgc.
 *
 * This ONE file runs with administrator rights (a scheduled task started by the installer, from a folder only an administrator can
 * change). It only ever reads numbers from the settings file and runs fixed commands; nothing from the settings is ever run as text.
 * Fail-safe: no temperature reading, an error, or stopping the task releases every limit.
 *
 *   node limiter.mjs --run --config <config.json> --status <status.json> --dir <state folder>
 *   node limiter.mjs --restore --dir <state folder>       puts back what was changed
 */

import { execFile, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const TICK_MS = 3000
/** Steps for the CPU, from "free" (0) to the strongest cap. */
export const CPU_STEPS = [
  { boost: 'free', max: 'free' },
  { boost: 'off', max: 'free' },
  { boost: 'off', max: 95 },
  { boost: 'off', max: 90 },
  { boost: 'off', max: 85 },
  { boost: 'off', max: 80 },
  { boost: 'off', max: 70 },
  { boost: 'off', max: 60 },
  { boost: 'off', max: 50 },
]
export const GPU_STEPS = 8
export const GPU_STEP_MHZ = 150
export const GPU_FLOOR_MHZ = 600

/** The limiter's own settings from the program's settings file. Anything odd means: off, with the default limits. */
export function limiterSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const lim = (v, d) => (Number.isInteger(v) && v >= 50 && v <= 100 ? v : d)
  return { on: r.limiterOn === true, cpu: lim(r.cpuLimit, 70), gpu: lim(r.gpuLimit, 70) }
}

/** One step up or down at a time: hot -> one step stronger at once; clearly cool (3 degrees under) for three readings in a row -> one step weaker. */
export function createGovernor({ steps, margin = 3, upAfter = 3 }) {
  let level = 0
  let cool = 0
  return {
    get level() {
      return level
    },
    update(temp, limit) {
      if (!Number.isFinite(temp)) {
        level = 0
        cool = 0
        return level
      }
      if (temp > limit) {
        cool = 0
        level = Math.min(steps - 1, level + 1)
      } else if (temp <= limit - margin) {
        cool++
        if (cool >= upAfter && level > 0) {
          level--
          cool = 0
        }
      } else cool = 0
      return level
    },
    reset() {
      level = 0
      cool = 0
    },
  }
}

/** The graphics clock limit (MHz) for a level, or null for "free". */
export const gpuClock = (level, maxClock) => (level <= 0 || !Number.isFinite(maxClock) ? null : Math.max(GPU_FLOOR_MHZ, Math.round(maxClock - GPU_STEP_MHZ * level)))

/** The current AC and DC values from `powercfg /query ...` (the last two hex numbers: they are the same in every Windows language). */
export function parsePowercfgIndexes(text) {
  const m = String(text ?? '').match(/0x[0-9a-f]{8}/gi) ?? []
  if (m.length < 2) return null
  return { ac: Number.parseInt(m.at(-2), 16), dc: Number.parseInt(m.at(-1), 16) }
}

/** The powercfg commands for one CPU step. `original` is { boost: {ac,dc}, max: {ac,dc} } from before the first change. */
export function cpuCommands(step, original) {
  const set = (scope, name, value) => ['powercfg.exe', [scope, 'SCHEME_CURRENT', 'SUB_PROCESSOR', name, String(value)]]
  const out = []
  for (const [scope, key] of [['/setacvalueindex', 'ac'], ['/setdcvalueindex', 'dc']]) {
    out.push(set(scope, 'PERFBOOSTMODE', step.boost === 'off' ? 0 : original.boost[key]))
    out.push(set(scope, 'PROCTHROTTLEMAX', step.max === 'free' ? original.max[key] : step.max))
  }
  out.push(['powercfg.exe', ['/setactive', 'SCHEME_CURRENT']])
  return out
}

/** "62, 2100, 1650" from nvidia-smi -> { temp, maxClock, clock }. */
export function parseNvidia(text) {
  const line = String(text ?? '').trim().split(/\r?\n/)[0] ?? ''
  const [temp, maxClock, clock] = line.split(/\s*,\s*/).map(Number)
  return Number.isFinite(temp) && temp > 0 ? { temp, maxClock: Number.isFinite(maxClock) ? maxClock : NaN, clock: Number.isFinite(clock) ? clock : NaN } : null
}

// -- reading the CPU temperature ---------------------------------------------------------------
// There is no single reliable source on Windows, so a few are tried in this order. LibreHardwareMonitor (free) is the most exact if it is running.
export const SENSOR_STREAM = String.raw`$inv = [Globalization.CultureInfo]::InvariantCulture
while ($true) {
  $t = $null; $src = ''
  try { $s = Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'CPU Package|Core Max|Tctl|Tdie' } | Sort-Object Value -Descending | Select-Object -First 1; if ($s) { $t = [double]$s.Value; $src = 'LibreHardwareMonitor' } } catch {}
  if ($null -eq $t) { try { $z = (Get-Counter '\Thermal Zone Information(*)\Temperature' -ErrorAction Stop).CounterSamples | ForEach-Object { $_.CookedValue - 273.15 } | Where-Object { $_ -gt 15 -and $_ -lt 125 } | Measure-Object -Maximum; if ($z.Count -gt 0) { $t = [math]::Round($z.Maximum, 1); $src = 'Windows thermal zones' } } catch {} }
  if ($null -eq $t) { try { $a = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | ForEach-Object { $_.CurrentTemperature / 10 - 273.15 } | Where-Object { $_ -gt 15 -and $_ -lt 125 } | Measure-Object -Maximum; if ($a.Count -gt 0) { $t = [math]::Round($a.Maximum, 1); $src = 'ACPI thermal zone' } } catch {} }
  if ($null -eq $t) { '{"cpu":null}' } else { '{"cpu":' + $t.ToString($inv) + ',"src":"' + $src + '"}' }
  [Console]::Out.Flush()
  Start-Sleep -Seconds 3
}`

/** One-off report of every temperature Windows exposes, to compare with Armoury Crate and pick what to trust. */
export const SENSOR_REPORT = String.raw`$inv = [Globalization.CultureInfo]::InvariantCulture
try { (Get-Counter '\Thermal Zone Information(*)\Temperature' -ErrorAction Stop).CounterSamples | ForEach-Object { 'Windows thermal zone ' + $_.InstanceName + ': ' + [math]::Round($_.CookedValue - 273.15, 1).ToString($inv) + ' C' } } catch { 'Windows thermal zones: not available' }
try { Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | ForEach-Object { 'ACPI ' + $_.InstanceName + ': ' + [math]::Round($_.CurrentTemperature / 10 - 273.15, 1).ToString($inv) + ' C' } } catch { 'ACPI thermal zone: not available (needs administrator rights)' }
try { Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' } | ForEach-Object { 'LibreHardwareMonitor ' + $_.Name + ': ' + [math]::Round($_.Value, 1).ToString($inv) + ' C' } } catch { 'LibreHardwareMonitor: not running (optional, free, more exact)' }`

const psEncoded = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]

// -- the limiter itself ------------------------------------------------------------------------------

/**
 * Everything it needs is passed in, so it can be tested without a PC:
 *   readConfig()    -> the program's settings (an object)
 *   readCpuTemp()   -> { temp, src } or null
 *   readGpu()       -> { temp, maxClock } or null (async)
 *   applyCpu(step, original?) / applyGpu(clockOrNull) / restore()
 */
export function createLimiter({ readConfig, readCpuTemp, readGpu, applyCpu, applyGpu, restore, writeStatus, now = Date.now, log = () => {} }) {
  const cpu = createGovernor({ steps: CPU_STEPS.length })
  const gpu = createGovernor({ steps: GPU_STEPS })
  let cpuLevel = 0
  let gpuLevel = 0
  let active = false
  return {
    async tick() {
      let cfg
      try {
        cfg = limiterSettings(readConfig())
      } catch {
        cfg = { on: false, cpu: 70, gpu: 70 }
      }
      const status = { at: new Date(now()).toISOString(), on: cfg.on, cpu: null, gpu: null, note: '' }
      if (!cfg.on) {
        if (active) {
          await restore()
          cpu.reset()
          gpu.reset()
          cpuLevel = 0
          gpuLevel = 0
          active = false
          log('[limiter] switched off: every limit released')
        }
        status.note = 'off'
        writeStatus(status)
        return status
      }
      try {
        const c = readCpuTemp()
        const g = await readGpu()
        const cl = cpu.update(c?.temp, cfg.cpu)
        if (cl !== cpuLevel) {
          await applyCpu(cl)
          cpuLevel = cl
          active = true
          log(`[limiter] CPU ${c?.temp ?? '?'} C, limit ${cfg.cpu}: step ${cl}`)
        }
        status.cpu = { temp: c?.temp ?? null, limit: cfg.cpu, step: cl, steps: CPU_STEPS.length - 1, source: c?.src ?? '' }
        if (g) {
          const gl = gpu.update(g.temp, cfg.gpu)
          if (gl !== gpuLevel) {
            await applyGpu(gpuClock(gl, g.maxClock))
            gpuLevel = gl
            active = true
            log(`[limiter] GPU ${g.temp} C, limit ${cfg.gpu}: step ${gl}`)
          }
          status.gpu = { temp: g.temp, limit: cfg.gpu, step: gl, steps: GPU_STEPS - 1 }
        }
        if (!c) status.note = 'no CPU temperature reading: the CPU is left free'
      } catch (err) {
        // Anything unexpected: put everything back rather than leave a limit nobody is watching.
        log(`[limiter] error, releasing all limits: ${err.message}`)
        await restore().catch(() => {})
        cpu.reset()
        gpu.reset()
        cpuLevel = 0
        gpuLevel = 0
        active = false
        status.note = `error: ${String(err.message).slice(0, 80)}`
      }
      writeStatus(status)
      return status
    },
  }
}

// -- the real thing -----------------------------------------------------------------------------------

const exec = (file, args, timeout = 15_000) =>
  new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout }, (err, out) => (err ? reject(err) : resolve(String(out)))))

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export async function runLimiter({ configFile, statusFile, dir, log = console.log }) {
  const originalFile = join(dir, 'limiter-original.json')
  let original = null
  try {
    original = JSON.parse(readFileSync(originalFile, 'utf8'))
  } catch {
    original = null
  }
  const readOriginal = async () => {
    const q = async (name) => parsePowercfgIndexes(await exec('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_PROCESSOR', name]))
    const boost = (await q('PERFBOOSTMODE')) ?? { ac: 2, dc: 2 }
    const max = (await q('PROCTHROTTLEMAX')) ?? { ac: 100, dc: 100 }
    return { boost, max }
  }
  const restore = async () => {
    if (original) {
      for (const [f, a] of cpuCommands(CPU_STEPS[0], original)) await exec(f, a).catch(() => {})
      original = null
      rmSync(originalFile, { force: true })
    }
    await exec('nvidia-smi.exe', ['-rgc']).catch(() => {})
  }
  // A crash or a forced stop earlier may have left a limit behind: put it back first.
  await restore()

  let stream = null
  let last = { cpu: null, at: 0 }
  const start = () => {
    stream = spawn('powershell.exe', psEncoded(SENSOR_STREAM), { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let buf = ''
    stream.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        try {
          const j = JSON.parse(line)
          last = { cpu: Number.isFinite(j.cpu) ? { temp: j.cpu, src: String(j.src ?? '') } : null, at: Date.now() }
        } catch {
          // A partial line.
        }
      }
    })
    stream.once('exit', () => {
      stream = null
      setTimeout(start, 5000)
    })
  }
  start()

  const limiter = createLimiter({
    readConfig: () => JSON.parse(readFileSync(configFile, 'utf8')),
    // A reading older than ten seconds is not trusted.
    readCpuTemp: () => (Date.now() - last.at < 10_000 ? last.cpu : null),
    readGpu: async () => {
      try {
        const g = parseNvidia(await exec('nvidia-smi.exe', ['--query-gpu=temperature.gpu,clocks.max.graphics,clocks.gr', '--format=csv,noheader,nounits']))
        return g
      } catch {
        return null
      }
    },
    applyCpu: async (level) => {
      if (!original) {
        original = await readOriginal()
        writeAtomic(originalFile, JSON.stringify(original))
      }
      for (const [f, a] of cpuCommands(CPU_STEPS[level], original)) await exec(f, a)
    },
    applyGpu: async (clock) => {
      if (clock === null) await exec('nvidia-smi.exe', ['-rgc'])
      else await exec('nvidia-smi.exe', ['-lgc', `${GPU_FLOOR_MHZ},${clock}`])
    },
    restore,
    writeStatus: (s) => writeAtomic(statusFile, JSON.stringify(s)),
    log,
  })

  const stop = () => {
    try {
      // Synchronous on purpose: the process is ending.
      if (original) for (const [f, a] of cpuCommands(CPU_STEPS[0], original)) execFileSync(f, a, { windowsHide: true, timeout: 5000 })
      execFileSync('nvidia-smi.exe', ['-rgc'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
    } catch {
      // Best effort; the next start restores from limiter-original.json.
    }
    try {
      stream?.kill()
    } catch {
      // Already gone.
    }
  }
  process.once('SIGINT', () => (stop(), process.exit(0)))
  process.once('SIGTERM', () => (stop(), process.exit(0)))
  process.once('exit', stop)

  for (;;) {
    await limiter.tick()
    await new Promise((r) => setTimeout(r, TICK_MS))
  }
}

// -- run from the command line (the scheduled task) ----------------------------------------------------
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
if (process.argv.includes('--run') && arg('--config') && arg('--status') && arg('--dir')) {
  runLimiter({ configFile: arg('--config'), statusFile: arg('--status'), dir: arg('--dir') }).catch((err) => {
    console.error('[limiter] stopped:', err)
    process.exit(1)
  })
} else if (process.argv.includes('--restore') && arg('--dir')) {
  const dir = arg('--dir')
  try {
    const original = JSON.parse(readFileSync(join(dir, 'limiter-original.json'), 'utf8'))
    for (const [f, a] of cpuCommands(CPU_STEPS[0], original)) execFileSync(f, a, { windowsHide: true, timeout: 5000 })
    rmSync(join(dir, 'limiter-original.json'), { force: true })
  } catch {
    // Nothing to put back.
  }
  try {
    execFileSync('nvidia-smi.exe', ['-rgc'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  } catch {
    // No NVIDIA card, or nothing locked.
  }
}

