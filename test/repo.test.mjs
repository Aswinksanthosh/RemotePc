// The project is cloned on Windows PCs and shared with friends: keep it clean.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let files = null
try {
  files = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
} catch {
  // Not a git folder (for example a downloaded zip): the checks that need the file list are skipped.
}
const need = { skip: files === null && 'git is not available here' }
const TEXT = /\.(mjs|js|json|md|ps1|cmd|yml|yaml|html|css|svg|service|txt)$|^(LICENSE|\.gitignore|\.gitattributes)$/
const text = (f) => readFileSync(join(root, f), 'utf8')

test('every path is valid on Windows', need, () => {
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  const bad = files.filter((f) => f.split('/').some((part) => /[:*?"<>|\\]/.test(part) || /[. ]$/.test(part) || reserved.test(part)))
  assert.deepEqual(bad, [])
})

test('no personal data: no real Tailscale addresses, e-mail addresses, keys or user folders', need, () => {
  const problems = []
  for (const f of files.filter((f) => TEXT.test(f) && !f.startsWith('src/vendor/'))) {
    const t = text(f)
    for (const m of t.matchAll(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g)) {
      // Made-up examples, and the edges of the Tailscale range that the address tests need.
      if (!['100.101.102.103', '100.64.0.0', '100.64.0.1', '100.127.255.255'].includes(m[0])) problems.push(`${f}: address ${m[0]}`)
    }
    for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g)) problems.push(`${f}: e-mail ${m[0]}`)
    for (const re of [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /\bsk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[bp]-[0-9A-Za-z-]{10,}/]) {
      if (re.test(t)) problems.push(`${f}: looks like a secret (${re})`)
    }
    for (const m of t.matchAll(/Users[\\/]+([A-Za-z0-9._-]+)/g)) {
      if (!['you', 'me', 'name', 'user', 'username', 'Public', 'Default'].includes(m[1])) problems.push(`${f}: user folder ${m[0]}`)
    }
  }
  assert.deepEqual(problems, [])
})

test('batch files have Windows line endings and plain ASCII (also in the zip download)', need, () => {
  for (const f of files.filter((f) => f.endsWith('.cmd'))) {
    const t = readFileSync(join(root, f))
    assert.ok(t.includes('\r\n'), `${f} has CRLF`)
    assert.ok(!/[^\r]\n/.test(t.toString('latin1')), `${f} has no bare LF`)
    assert.ok([...t].every((b) => b < 128), `${f} is ASCII`)
  }
})

test('the PowerShell installer is plain ASCII (Windows PowerShell 5 reads it without a BOM)', need, () => {
  assert.ok([...readFileSync(join(root, 'install.ps1'))].every((b) => b < 128))
})

test('links between the documents point at files that exist', need, () => {
  const bad = []
  for (const f of files.filter((f) => f.endsWith('.md'))) {
    for (const m of text(f).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const target = m[1]
      if (/^(https?:|mailto:)/.test(target)) continue
      if (!existsSync(resolve(dirname(join(root, f)), target))) bad.push(`${f} -> ${target}`)
    }
    for (const m of text(f).matchAll(/src="([^"]+)"/g)) if (!/^https?:/.test(m[1]) && !existsSync(resolve(dirname(join(root, f)), m[1]))) bad.push(`${f} -> ${m[1]}`)
  }
  assert.deepEqual(bad, [])
})

test('every batch file runs a tool that exists', need, () => {
  for (const f of files.filter((f) => f.endsWith('.cmd'))) {
    for (const m of text(f).matchAll(/run\.cmd" ([A-Za-z-]+\.mjs)/g)) assert.ok(existsSync(join(root, 'bin', m[1])), `${f} -> bin/${m[1]}`)
    for (const m of text(f).matchAll(/%~dp0([A-Za-z-]+\.ps1)/g)) assert.ok(existsSync(join(root, m[1])), `${f} -> ${m[1]}`)
  }
})

test('the Windows shortcuts the installer makes all have a matching batch file', () => {
  return import('../src/windows.mjs').then(({ SHORTCUTS }) => {
    for (const name of SHORTCUTS) assert.ok(existsSync(join(root, `${name}.cmd`)), name)
  })
})

test('package.json names the repository the updater and the installer use', () => {
  const pkg = JSON.parse(text('package.json'))
  const ps1 = text('install.ps1')
  const slug = /github:([^/]+\/.+)$/.exec(pkg.repository)?.[1]
  assert.ok(slug, 'repository is github:owner/name')
  assert.ok(ps1.includes(`$Repo = '${slug}'`), 'install.ps1 uses the same repository')
  assert.ok(text('README.md').includes(`raw.githubusercontent.com/${slug}/main/install.ps1`), 'the README one-liner uses it too')
  assert.equal(pkg.dependencies, undefined, 'no dependencies: nothing to npm install')
})

test('uninstall also removes the two Clear sound tasks', () => {
  const src = readFileSync(join(root, 'bin', 'uninstall.mjs'), 'utf8')
  assert.ok(src.includes('TASK_ON') && src.includes("'/delete'"))
})
