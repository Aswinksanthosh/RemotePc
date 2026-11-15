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
  assert.equal(f.urls.length, 1)
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
