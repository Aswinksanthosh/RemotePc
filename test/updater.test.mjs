import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataPaths } from '../src/paths.mjs'
import { installUpdate, latestSha, repoSlug } from '../src/updater.mjs'
import { makeZip, tempDir } from './helpers.mjs'

const SHA = 'a'.repeat(40)
const goodZip = (extra = {}) => makeZip({ 'RemortStartPc-main/package.json': '{"name":"remortstartpc","version":"2.0.0"}', 'RemortStartPc-main/bin/remote.mjs': '//', 'RemortStartPc-main/src/server.mjs': '//', ...extra })

function fakeFetch({ sha = SHA, zip = goodZip(), zipStatus = 200 } = {}) {
  const urls = []
  const fn = async (url) => {
    urls.push(String(url))
    if (String(url).includes('api.github.com')) return { ok: Boolean(sha), text: async () => sha }
    return { ok: zipStatus === 200, status: zipStatus, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) }
  }
  fn.urls = urls
  return fn
}

function setup(t) {
  const paths = dataPaths(tempDir(t))
  mkdirSync(join(paths.app, 'bin'), { recursive: true })
  writeFileSync(join(paths.app, 'package.json'), '{"name":"remortstartpc","version":"1.0.0"}')
  writeFileSync(join(paths.app, 'old-file.txt'), 'old')
  writeFileSync(join(paths.home, 'buttons.json'), '{"mine":"x"}')
  return paths
}

test('repoSlug understands the usual spellings', () => {
  for (const r of ['github:me/proj', 'https://github.com/me/proj', 'https://github.com/me/proj.git', 'git+https://github.com/me/proj.git', 'me/proj']) assert.equal(repoSlug({ repository: r }), 'me/proj', r)
  assert.equal(repoSlug({ repository: { url: 'https://github.com/me/proj.git' } }), 'me/proj')
  for (const r of ['', 'https://evil.example/me/proj', 'me', 'me/proj/extra', undefined]) assert.equal(repoSlug({ repository: r }), null, String(r))
})

test('latestSha returns a full commit id, or nothing when GitHub cannot be asked', async () => {
  assert.equal(await latestSha('me/proj', 'main', fakeFetch()), SHA)
  assert.equal(await latestSha('me/proj', 'main', fakeFetch({ sha: '' })), '')
  assert.equal(await latestSha('me/proj', 'main', async () => { throw new Error('offline') }), '')
  assert.equal(await latestSha('me/proj', 'main', async () => ({ ok: true, text: async () => '<html>' })), '')
})

test('an update replaces the program but never your own files', async (t) => {
  const paths = setup(t)
  const f = fakeFetch()
  const r = await installUpdate({ repo: 'me/proj', paths, fetchFn: f })
  assert.deepEqual(r, { installed: true, sha: SHA })
  assert.match(readFileSync(join(paths.app, 'package.json'), 'utf8'), /2\.0\.0/)
  assert.ok(!existsSync(join(paths.app, 'old-file.txt')), 'files of the old version are gone')
  assert.ok(existsSync(join(paths.app, 'bin', 'remote.mjs')))
  assert.equal(readFileSync(join(paths.home, 'buttons.json'), 'utf8'), '{"mine":"x"}')
  assert.equal(JSON.parse(readFileSync(paths.installed, 'utf8')).sha, SHA)
  assert.ok(!existsSync(`${paths.app}.new`))
  assert.ok(f.urls.some((u) => u.includes('codeload.github.com/me/proj/zip/refs/heads/main')))
})

test('when nothing is new, nothing is downloaded or replaced', async (t) => {
  const paths = setup(t)
  writeFileSync(paths.installed, JSON.stringify({ sha: SHA }))
  const f = fakeFetch()
  assert.deepEqual(await installUpdate({ repo: 'me/proj', paths, fetchFn: f }), { installed: false, message: 'Already up to date.' })
  assert.equal(f.urls.length, 2, "only the release question and the version question, no download")
  assert.ok(!f.urls.some((u) => u.includes("codeload")))
  assert.ok(existsSync(join(paths.app, 'old-file.txt')))
  assert.equal((await installUpdate({ repo: 'me/proj', paths, fetchFn: fakeFetch(), force: true })).installed, true)
})

test('a download that is not this program is refused and the old copy is kept', async (t) => {
  const paths = setup(t)
  const other = makeZip({ 'x-main/package.json': '{"name":"something-else"}', 'x-main/bin/remote.mjs': '//', 'x-main/src/server.mjs': '//' })
  await assert.rejects(installUpdate({ repo: 'me/proj', paths, fetchFn: fakeFetch({ zip: other }) }), /does not look like this program/)
  const missing = makeZip({ 'x-main/package.json': '{"name":"remortstartpc"}' })
  await assert.rejects(installUpdate({ repo: 'me/proj', paths, fetchFn: fakeFetch({ zip: missing }) }), /does not look like this program/)
  assert.ok(existsSync(join(paths.app, 'old-file.txt')))
  assert.ok(!existsSync(`${paths.app}.new`))
})

test('plain-language errors: private project, GitHub down, offline, no repository', async (t) => {
  const paths = setup(t)
  await assert.rejects(installUpdate({ repo: 'me/proj', paths, fetchFn: fakeFetch({ zipStatus: 404 }) }), /not public/)
  await assert.rejects(installUpdate({ repo: 'me/proj', paths, fetchFn: fakeFetch({ zipStatus: 500 }) }), /answered 500/)
  await assert.rejects(installUpdate({ repo: 'me/proj', paths, fetchFn: async (u) => { if (String(u).includes('api.')) return { ok: false }; throw new Error('offline') } }), /cannot reach GitHub/)
  await assert.rejects(installUpdate({ repo: null, paths }), /does not know where/)
  assert.ok(existsSync(join(paths.app, 'old-file.txt')))
})

// -- releases: the zip must match the checksum file ---------------------------------------
import { createHash } from 'node:crypto'
import { checksumFor, latestRelease, latestVersionId } from '../src/updater.mjs'

function releaseFetch({ zip = goodZip(), sums, tag = 'v0.2.0', hasRelease = true } = {}) {
  const urls = []
  const hash = createHash('sha256').update(zip).digest('hex')
  const fn = async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.endsWith('/releases/latest')) {
      if (!hasRelease) return { ok: false, status: 404 }
      return { ok: true, json: async () => ({ tag_name: tag, assets: [{ name: 'remortstartpc.zip', browser_download_url: 'https://github.com/me/proj/releases/download/v/remortstartpc.zip' }, { name: 'SHASUMS256.txt', browser_download_url: 'https://github.com/me/proj/releases/download/v/SHASUMS256.txt' }] }) }
    }
    if (u.endsWith('SHASUMS256.txt')) return { ok: true, text: async () => sums ?? `${hash}  remortstartpc.zip\n` }
    if (u.includes('api.github.com')) return { ok: true, text: async () => SHA }
    return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) }
  }
  fn.urls = urls
  return fn
}

test('checksumFor reads the checksum of one file name', () => {
  const h = 'b'.repeat(64)
  assert.equal(checksumFor(`${h}  remortstartpc.zip\n${'c'.repeat(64)}  other.zip`, 'remortstartpc.zip'), h)
  assert.equal(checksumFor(`${h} *remortstartpc.zip`, 'remortstartpc.zip'), h)
  assert.equal(checksumFor('nothing here', 'remortstartpc.zip'), '')
  assert.equal(checksumFor(undefined, 'x'), '')
})

test('a release is preferred and installed only when its checksum matches', async (t) => {
  const paths = setup(t)
  const f = releaseFetch()
  const r = await installUpdate({ repo: 'me/proj', paths, fetchFn: f })
  assert.deepEqual(r, { installed: true, sha: 'v0.2.0' })
  assert.equal(JSON.parse(readFileSync(paths.installed, 'utf8')).sha, 'v0.2.0')
  assert.ok(!f.urls.some((u) => u.includes('codeload.github.com')), 'the branch is not used when there is a release')
  assert.equal(await latestVersionId('me/proj', 'main', f), 'v0.2.0')
})

test('a release whose checksum does not match is refused and the old copy is kept', async (t) => {
  const paths = setup(t)
  for (const sums of ['0'.repeat(64) + '  remortstartpc.zip\n', 'garbage', '']) {
    await assert.rejects(installUpdate({ repo: 'me/proj', paths, fetchFn: releaseFetch({ sums }) }), /checksum/)
    assert.ok(existsSync(join(paths.app, 'old-file.txt')), 'the working copy is untouched')
  }
})

test('with no release yet, the branch is used as before; odd release data is ignored', async (t) => {
  const paths = setup(t)
  const f = releaseFetch({ hasRelease: false })
  assert.equal(await latestRelease('me/proj', f), null)
  const r = await installUpdate({ repo: 'me/proj', paths, fetchFn: f })
  assert.equal(r.installed, true)
  assert.ok(f.urls.some((u) => u.includes('codeload.github.com')))
  const odd = async () => ({ ok: true, json: async () => ({ tag_name: 'v1', assets: [{ name: 'remortstartpc.zip', browser_download_url: 'https://evil.example/remortstartpc.zip' }, { name: 'SHASUMS256.txt', browser_download_url: 'https://github.com/x' }] }) })
  assert.equal(await latestRelease('me/proj', odd), null, 'a download link outside github.com is not trusted')
})
