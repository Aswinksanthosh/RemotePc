import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CPU_STEPS, GPU_STEPS, cpuCommands, createGovernor, createLimiter, gpuClock, limiterSettings, parseNvidia, parsePowercfgIndexes } from '../src/limiter.mjs'

test('limiter settings: off unless asked, limits 50 to 100, odd values fall back', () => {
  assert.deepEqual(limiterSettings({}), { on: false, cpu: 70, gpu: 70 })
  assert.deepEqual(limiterSettings({ limiterOn: true, cpuLimit: 90, gpuLimit: 65 }), { on: true, cpu: 90, gpu: 65 })
  assert.deepEqual(limiterSettings({ limiterOn: 'yes', cpuLimit: 10, gpuLimit: '80' }), { on: false, cpu: 70, gpu: 70 })
  assert.deepEqual(limiterSettings(null), { on: false, cpu: 70, gpu: 70 })
})

test('the governor steps down at once when hot, and up slowly when clearly cool', () => {
  const g = createGovernor({ steps: 5 })
  assert.equal(g.update(60, 70), 0, 'under the limit: free')
  assert.equal(g.update(72, 70), 1)
  assert.equal(g.update(73, 70), 2)
  assert.equal(g.update(75, 70), 3)
  assert.equal(g.update(80, 70), 4)
  assert.equal(g.update(90, 70), 4, 'never beyond the strongest step')
  assert.equal(g.update(69, 70), 4, 'just under the limit: hold (no flapping)')
  assert.equal(g.update(66, 70), 4)
  assert.equal(g.update(66, 70), 4)
  assert.equal(g.update(66, 70), 3, 'cool (3 degrees under) three readings in a row: one step back')
  assert.equal(g.update(66, 70), 3)
  assert.equal(g.update(71, 70), 4, 'hot again: down again at once')
})

test('no temperature reading frees everything (fail-safe)', () => {
  const g = createGovernor({ steps: 5 })
  g.update(80, 70)
  g.update(80, 70)
  assert.equal(g.level, 2)
  assert.equal(g.update(null, 70), 0)
  assert.equal(g.update(NaN, 70), 0)
})

test('the CPU steps turn boost off first, then lower the maximum, and restore the original values at step 0', () => {
  assert.equal(CPU_STEPS[0].boost, 'free')
  assert.equal(CPU_STEPS[1].boost, 'off')
  assert.equal(CPU_STEPS[1].max, 'free')
  const maxes = CPU_STEPS.slice(2).map((s) => s.max)
  assert.deepEqual(maxes, [...maxes].sort((a, b) => b - a), 'each step is lower than the one before')
  const original = { boost: { ac: 2, dc: 1 }, max: { ac: 100, dc: 90 } }
  const flat = (step) => cpuCommands(step, original).map(([f, a]) => `${f} ${a.join(' ')}`)
  assert.deepEqual(flat(CPU_STEPS[0]), [
    'powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 2',
    'powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100',
    'powercfg.exe /setdcvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 1',
    'powercfg.exe /setdcvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 90',
    'powercfg.exe /setactive SCHEME_CURRENT',
  ])
  assert.ok(flat(CPU_STEPS[3]).includes('powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 0'))
  assert.ok(flat(CPU_STEPS[3]).includes('powercfg.exe /setdcvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 90'.replace('90', String(CPU_STEPS[3].max))))
  for (const [, args] of cpuCommands(CPU_STEPS[5], original)) for (const a of args) assert.match(a, /^[A-Za-z_/0-9]+$/, 'only fixed words and numbers')
})

test('powercfg output is read the same in every Windows language', () => {
  const english = 'Power Setting GUID: be337238\n    Minimum Possible Setting: 0x00000000\n    Maximum Possible Setting: 0x00000064\n    Possible Settings increment: 0x00000001\n  Current AC Power Setting Index: 0x00000064\n  Current DC Power Setting Index: 0x0000005a\n'
  assert.deepEqual(parsePowercfgIndexes(english), { ac: 100, dc: 90 })
  assert.equal(parsePowercfgIndexes('nothing here'), null)
})

test('GPU clock steps and nvidia-smi output', () => {
  assert.equal(gpuClock(0, 2100), null)
  assert.equal(gpuClock(1, 2100), 1950)
  assert.equal(gpuClock(GPU_STEPS - 1, 2100), 1050)
  assert.equal(gpuClock(5, 1000), 600, 'never below the floor')
  assert.equal(gpuClock(1, NaN), null)
  assert.deepEqual(parseNvidia('62, 2100, 1650\n'), { temp: 62, maxClock: 2100, clock: 1650 })
  assert.equal(parseNvidia(''), null)
  assert.equal(parseNvidia('No devices were found'), null)
})

function lab({ config, cpu = { temp: 60, src: 'test' }, gpu = { temp: 55, maxClock: 2000 } }) {
  const log = []
  let c = config
  let cpuT = cpu
  let gpuT = gpu
  const status = []
  const l = createLimiter({
    readConfig: () => c,
    readCpuTemp: () => cpuT,
    readGpu: async () => gpuT,
    applyCpu: async (n) => log.push(`cpu ${n}`),
    applyGpu: async (clock) => log.push(`gpu ${clock}`),
    restore: async () => log.push('restore'),
    writeStatus: (s) => status.push(s),
  })
  return { l, log, status, set: (o) => ({ config: (c = o.config ?? c), cpu: (cpuT = 'cpu' in o ? o.cpu : cpuT), gpu: (gpuT = 'gpu' in o ? o.gpu : gpuT) }) }
}

test('switched off: nothing is ever changed', async () => {
  const x = lab({ config: { limiterOn: false } })
  x.set({ cpu: { temp: 99 }, gpu: { temp: 99, maxClock: 2000 } })
  await x.l.tick()
  assert.deepEqual(x.log, [])
  assert.equal(x.status.at(-1).note, 'off')
})

test('under the limits nothing changes; over them CPU and GPU step down; switching off releases everything', async () => {
  const x = lab({ config: { limiterOn: true, cpuLimit: 70, gpuLimit: 70 } })
  await x.l.tick()
  assert.deepEqual(x.log, [], 'cool: free to boost')
  x.set({ cpu: { temp: 78, src: 'zones' }, gpu: { temp: 76, maxClock: 2000 } })
  await x.l.tick()
  assert.deepEqual(x.log, ['cpu 1', 'gpu 1850'])
  assert.deepEqual(x.status.at(-1).cpu, { temp: 78, limit: 70, step: 1, steps: 8, source: 'zones' })
  assert.deepEqual(x.status.at(-1).gpu, { temp: 76, limit: 70, step: 1, steps: 7 })
  x.set({ config: { limiterOn: false } })
  await x.l.tick()
  assert.equal(x.log.at(-1), 'restore')
  const n = x.log.length
  await x.l.tick()
  assert.equal(x.log.length, n, 'released once, not over and over')
})

test('a PC without an NVIDIA card is limited on the CPU only; no CPU reading means no limit', async () => {
  const x = lab({ config: { limiterOn: true, cpuLimit: 90 }, gpu: null })
  x.set({ cpu: { temp: 95, src: 'a' } })
  await x.l.tick()
  assert.deepEqual(x.log, ['cpu 1'])
  assert.equal(x.status.at(-1).gpu, null)
  x.set({ cpu: null })
  await x.l.tick()
  assert.equal(x.log.at(-1), 'cpu 0', 'no reading: the CPU is freed')
  assert.match(x.status.at(-1).note, /no CPU temperature/)
})

test('any error releases every limit instead of leaving one behind', async () => {
  const log = []
  let boom = false
  const l = createLimiter({
    readConfig: () => ({ limiterOn: true }),
    readCpuTemp: () => { if (boom) throw new Error('sensor exploded'); return { temp: 80 } },
    readGpu: async () => null,
    applyCpu: async (n) => log.push(`cpu ${n}`),
    applyGpu: async () => {},
    restore: async () => log.push('restore'),
    writeStatus: () => {},
  })
  await l.tick()
  boom = true
  const s = await l.tick()
  assert.deepEqual(log, ['cpu 1', 'restore'])
  assert.match(s.note, /error: sensor exploded/)
  const bad = createLimiter({ readConfig: () => { throw new Error('no file') }, readCpuTemp: () => ({ temp: 99 }), readGpu: async () => null, applyCpu: async () => assert.fail('must not change anything'), applyGpu: async () => {}, restore: async () => {}, writeStatus: () => {} })
  assert.equal((await bad.tick()).on, false, 'an unreadable settings file means off')
})
