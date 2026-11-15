/**
 * Updating: downloads the newest version of this project from GitHub as one zip, checks it looks
 * right, and swaps it in for the `app` folder. Your own files (buttons, apps, phones) are outside
 * that folder, so an update never touches them. Needs nothing but Node: no git, no tar.
 *
 * You are trusting whoever owns the repository named in package.json: updating runs their code.
 * Fork the project and change "repository" in package.json to follow your own copy.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './fsutil.mjs'
import { extractZip } from './unzip.mjs'

const MAX_ZIP = 30 * 1024 * 1024

/** "github:owner/name", "https://github.com/owner/name(.git)" or "owner/name" -> "owner/name", else null. */
export function repoSlug(pkg) {
  const r = typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url
  const m = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(String(r ?? '').trim())
  return m ? m[1] : null
}

/** The newest commit of the branch, or '' if GitHub cannot be asked (offline, private repository, rate limit). */
export async function latestSha(repo, branch = 'main', fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
      headers: { accept: 'application/vnd.github.sha', 'user-agent': 'remortstartpc-updater' },
      signal: AbortSignal.timeout(10_000),
    })
    const text = res.ok ? (await res.text()).trim() : ''
    return /^[0-9a-f]{40}$/.test(text) ? text : ''
  } catch {
    return ''
  }
}

/**
 * Downloads and installs. Returns { installed: false, message } when there is nothing to do, or
 * { installed: true, sha } after the swap. Throws a plain-language error when something goes wrong
 * (and leaves the working copy exactly as it was).
 */
export async function installUpdate({ repo, branch = 'main', paths, fetchFn = globalThis.fetch, force = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!repo) throw new Error('This copy does not know where to update from.')
  const sha = await latestSha(repo, branch, fetchFn)
  const current = readJsonSafe(paths.installed)?.sha ?? ''
  if (!force && sha && sha === current) return { installed: false, message: 'Already up to date.' }

  let res
  try {
    res = await fetchFn(`https://codeload.github.com/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`, {
      headers: { 'user-agent': 'remortstartpc-updater' },
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new Error('This PC cannot reach GitHub right now.')
  }
  if (res.status === 404) throw new Error('GitHub says that project is not public (or is gone), so it cannot be downloaded.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  const zip = Buffer.from(await res.arrayBuffer())
  if (zip.length > MAX_ZIP) throw new Error('The download is larger than expected, so it was not installed.')

  const fresh = `${paths.app}.new`
  const old = `${paths.app}.old`
  rmSync(fresh, { recursive: true, force: true })
  mkdirSync(fresh, { recursive: true })
  try {
    extractZip(zip, fresh, { strip: 1 })
    const pkg = readJsonSafe(join(fresh, 'package.json'))
    if (pkg?.name !== 'remortstartpc' || !existsSync(join(fresh, 'bin', 'remote.mjs')) || !existsSync(join(fresh, 'src', 'server.mjs'))) {
      throw new Error('The download does not look like this program, so it was not installed.')
    }
  } catch (err) {
    rmSync(fresh, { recursive: true, force: true })
    throw err
  }

  // Windows can hold a folder for a moment (antivirus, an open window): try a few times before giving up.
  const retry = async (fn) => {
    for (let i = 0; ; i++) {
      try {
        return fn()
      } catch (err) {
        if (i >= 4) throw err
        await sleep(500)
      }
    }
  }
  try {
    await retry(() => rmSync(old, { recursive: true, force: true }))
    if (existsSync(paths.app)) await retry(() => renameSync(paths.app, old))
  } catch (err) {
    rmSync(fresh, { recursive: true, force: true })
    throw new Error(`Could not replace the old version (is a window open in the program folder?): ${err.message}`)
  }
  try {
    await retry(() => renameSync(fresh, paths.app))
  } catch (err) {
    if (existsSync(old) && !existsSync(paths.app)) renameSync(old, paths.app)
    throw new Error(`Could not put the new version in place: ${err.message}`)
  }
  writeAtomic(paths.installed, `${JSON.stringify({ sha: sha || 'unknown', at: new Date().toISOString() })}\n`)
  return { installed: true, sha: sha || '' }
}

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
