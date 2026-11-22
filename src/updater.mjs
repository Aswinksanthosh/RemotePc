/**
 * Updating: downloads the newest version of this project from GitHub as one zip, checks it looks
 * right, and swaps it in for the `app` folder. Your own files (buttons, apps, phones) are outside
 * that folder, so an update never touches them. Needs nothing but Node: no git, no tar.
 *
 * You are trusting whoever owns the repository named in package.json: updating runs their code.
 * Fork the project and change "repository" in package.json to follow your own copy.
 */

import { createHash } from 'node:crypto'
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
 * The newest published release: { tag, zipUrl, sumsUrl } when the project has one with the two files the release workflow
 * attaches (remortstartpc.zip and SHASUMS256.txt); null when there is none (or GitHub cannot be asked).
 */
export async function latestRelease(repo, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'remortstartpc-updater' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const j = await res.json()
    const asset = (name) => (j.assets ?? []).find((a) => a?.name === name && /^https:\/\/github\.com\//.test(String(a.browser_download_url)))?.browser_download_url
    const tag = String(j.tag_name ?? '')
    const zipUrl = asset('remortstartpc.zip')
    const sumsUrl = asset('SHASUMS256.txt')
    return /^v?\d[\w.-]{0,30}$/.test(tag) && zipUrl && sumsUrl ? { tag, zipUrl, sumsUrl } : null
  } catch {
    return null
  }
}

/** What identifies the newest version: the release tag when there is a release, otherwise the newest commit of the branch. */
export async function latestVersionId(repo, branch = 'main', fetchFn = globalThis.fetch) {
  return (await latestRelease(repo, fetchFn))?.tag ?? (await latestSha(repo, branch, fetchFn))
}

/** The sha256 a SHASUMS256.txt ("<hash>  <file>" per line) lists for a file name, or ''. */
export function checksumFor(text, name) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m && m[2] === name) return m[1].toLowerCase()
  }
  return ''
}

/**
 * Downloads and installs. Returns { installed: false, message } when there is nothing to do, or
 * { installed: true, sha } after the swap. Throws a plain-language error when something goes wrong
 * (and leaves the working copy exactly as it was).
 */
export async function installUpdate({ repo, branch = 'main', paths, fetchFn = globalThis.fetch, force = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!repo) throw new Error('This copy does not know where to update from.')
  // A published release (checked against its checksum file) is preferred; only a project with no release yet is updated from the branch.
  const release = await latestRelease(repo, fetchFn)
  const sha = release ? release.tag : await latestSha(repo, branch, fetchFn)
  const current = readJsonSafe(paths.installed)?.sha ?? ''
  if (!force && sha && sha === current) return { installed: false, message: 'Already up to date.' }

  let res
  try {
    res = await fetchFn(release ? release.zipUrl : `https://codeload.github.com/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`, {
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
  if (release) {
    let sums = ''
    try {
      const r = await fetchFn(release.sumsUrl, { headers: { 'user-agent': 'remortstartpc-updater' }, signal: AbortSignal.timeout(20_000) })
      sums = r.ok ? await r.text() : ''
    } catch {
      // Handled below: no checksum means no install.
    }
    const want = checksumFor(sums, 'remortstartpc.zip')
    if (!want || createHash('sha256').update(zip).digest('hex') !== want) throw new Error('The download did not match its checksum, so it was not installed.')
  }

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
