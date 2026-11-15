import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { extraGames, findGameArt, libraryFolders, parseSteamAccounts, parseSteamLogin, parseSteamUsers, parseVdf, scanGames, setMostRecent, steamIdFromAccountNumber } from '../src/steam.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const manifest = (id, name, extra = '') => `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"4"\n${extra}}\n`

test('parseVdf reads nested blocks, escapes and comments', () => {
  const v = parseVdf('// comment\n"root"\n{\n  "a" "1"\n  "path" "C:\\\\Games\\\\Steam"\n  "inner" { "b" "two words" }\n}\n')
  assert.equal(v.root.a, '1')
  assert.equal(v.root.path, 'C:\\Games\\Steam')
  assert.equal(v.root.inner.b, 'two words')
  assert.deepEqual(Object.keys(parseVdf('')), [])
  assert.equal(parseVdf('"__proto__" { "x" "1" }').x, undefined, 'no prototype pollution')
  assert.equal({}.x, undefined)
})

test('finds extra Steam library folders (new and old format)', () => {
  const read = () => '"libraryfolders"\n{\n"0"\n{\n"path" "D:\\\\SteamLibrary"\n}\n"1" "E:\\\\Old"\n}'
  assert.deepEqual(libraryFolders('C:\\Steam', read), ['C:\\Steam', 'D:\\SteamLibrary', 'E:\\Old'])
  assert.deepEqual(libraryFolders('C:\\Steam', () => { throw new Error('none') }), ['C:\\Steam'])
})

test('scanGames lists installed games from every library, without tools or duplicates', (t) => {
  const steam = join(tempDir(t), 'Steam')
  const other = join(tempDir(t), 'Lib2')
  writeTree(steam, {
    'steamapps/libraryfolders.vdf': `"libraryfolders" { "0" { "path" "${steam.replace(/\\/g, '\\\\')}" } "1" { "path" "${other.replace(/\\/g, '\\\\')}" } }`,
    'steamapps/appmanifest_730.acf': manifest(730, 'Counter-Strike 2'),
    'steamapps/appmanifest_228980.acf': manifest(228980, 'Steamworks Common Redistributables'),
    'steamapps/appmanifest_1493710.acf': manifest(1493710, 'Proton Experimental'),
    'steamapps/appmanifest_5.acf': 'garbage',
    'steamapps/notes.txt': 'x',
  })
  writeTree(other, { 'steamapps/appmanifest_1145360.acf': manifest(1145360, 'Hades'), 'steamapps/appmanifest_730.acf': manifest(730, 'Counter-Strike 2') })
  const games = scanGames(steam, { readdir: readdirSync })
  assert.deepEqual(games, [{ appid: '730', name: 'Counter-Strike 2' }, { appid: '1145360', name: 'Hades' }])
})

test('extraGames reads games.json and ignores odd entries', () => {
  const read = () => JSON.stringify({ Hades: 1145360, 'bad id': 'abc', '': 5, 'Other game': '12' })
  assert.deepEqual(extraGames('x', read), [{ appid: '1145360', name: 'Hades' }, { appid: '12', name: 'Other game' }])
  assert.deepEqual(extraGames('x', () => { throw new Error('no file') }), [])
})

test('findGameArt finds old and new style pictures and refuses huge or odd ones', (t) => {
  const steam = tempDir(t)
  writeTree(steam, {
    'appcache/librarycache/10_header.jpg': 'img',
    'appcache/librarycache/20/abcdef0123/header.jpg': 'img',
    'appcache/librarycache/20/abcdef0123/library_hero.jpg': 'img',
    'appcache/librarycache/30_library_hero.jpg': 'hero',
    'appcache/librarycache/40_header.jpg': 'x'.repeat(2000),
  })
  assert.equal(findGameArt(steam, '10'), join(steam, 'appcache', 'librarycache', '10_header.jpg'))
  assert.equal(findGameArt(steam, '20'), join(steam, 'appcache', 'librarycache', '20', 'abcdef0123', 'header.jpg'))
  assert.equal(findGameArt(steam, '30'), join(steam, 'appcache', 'librarycache', '30_library_hero.jpg'))
  assert.equal(findGameArt(steam, '40', { max: 100 }), null)
  assert.equal(findGameArt(steam, '99'), null)
  assert.equal(findGameArt(steam, '../../x'), null)
})

const VDF = `"users"
{
\t"76561198000000001"
\t{
\t\t"AccountName"\t\t"alpha_login"
\t\t"PersonaName"\t\t"Alpha"
\t\t"RememberPassword"\t\t"1"
\t\t"MostRecent"\t\t"1"
\t}
\t"76561198000000002"
\t{
\t\t"AccountName"\t\t"beta_login"
\t\t"PersonaName"\t\t"Beta"
\t\t"RememberPassword"\t\t"1"
\t\t"MostRecent"\t\t"0"
\t}
\t"76561198000000003"
\t{
\t\t"AccountName"\t\t"gamma"
\t\t"PersonaName"\t\t"Gamma"
\t\t"RememberPassword"\t\t"0"
\t}
}`

test('Steam accounts: who is signed in, who stays signed in, and switching the flag', () => {
  assert.deepEqual(parseSteamLogin(VDF), { id: '76561198000000001', name: 'Alpha' })
  assert.equal(parseSteamUsers(VDF).length, 3)
  assert.deepEqual(parseSteamAccounts(VDF).map((a) => a.name), ['Alpha', 'Beta'])
  const moved = setMostRecent(VDF, '76561198000000002')
  assert.deepEqual(parseSteamLogin(moved), { id: '76561198000000002', name: 'Beta' })
  assert.ok(moved.includes('"Gamma"') && moved.includes('"RememberPassword"\t\t"0"'))
  assert.equal(steamIdFromAccountNumber(1), '76561197960265729')
  assert.equal(steamIdFromAccountNumber(0), '')
  assert.equal(steamIdFromAccountNumber('x'), '')
})

test('login names with odd characters are never offered', () => {
  const evil = VDF.replace('alpha_login', 'a b&calc')
  assert.deepEqual(parseSteamAccounts(evil).map((a) => a.name), ['Beta'])
})
