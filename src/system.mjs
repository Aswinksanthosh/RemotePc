/** Real implementations of the few things the command-line tools need from the computer. */

import { spawn } from 'node:child_process'
import { createWriteStream, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline'
import { runCommand } from './actions.mjs'

export const run = (file, args, opts = {}) => runCommand(file, args, { timeout: 120_000, ...opts })

/** Opens a file or an https address with whatever Windows uses for it (the browser for .html). */
export function openTarget(target) {
  const child = spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true })
  child.once('error', () => {})
  child.unref()
}

/** Waits for the Enter key, or for the time to run out. */
export function waitForEnter(ms, prompt = '  Press Enter when you have scanned it (this also removes the pairing page)... ') {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const done = () => {
      clearTimeout(timer)
      rl.close()
      resolve()
    }
    const timer = setTimeout(done, ms)
    rl.question(prompt, done)
  })
}

export function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** Downloads a file into a new temporary folder and returns its path. */
export async function downloadTo(url, fetchFn = globalThis.fetch) {
  const res = await fetchFn(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
  const file = join(mkdtempSync(join(tmpdir(), 'rsp-dl-')), url.split('/').pop() || 'download.bin')
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  return file
}
