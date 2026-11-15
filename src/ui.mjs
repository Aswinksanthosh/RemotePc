/**
 * Plain, friendly console output for the installer and Fix-It. ASCII markers only, so every
 * Windows console shows them. Everything said is also kept in a log file (install.log) for
 * support, EXCEPT secrets: `secret()` prints and never logs (the pairing link and its code).
 */

export function createUi({ write = (s) => process.stdout.write(s), log = () => {} } = {}) {
  const say = (text = '') => {
    write(`${text}\n`)
    log(text)
  }
  return {
    say,
    blank: () => say(''),
    title: (text) => {
      say('')
      say('='.repeat(Math.min(60, text.length + 4)))
      say(`  ${text}`)
      say('='.repeat(Math.min(60, text.length + 4)))
    },
    step: (n, total, text) => {
      say('')
      say(`Step ${n} of ${total}: ${text}`)
    },
    ok: (text) => say(`  [ OK ] ${text}`),
    info: (text) => say(`  [ .. ] ${text}`),
    warn: (text) => say(`  [ !! ] ${text}`),
    fail: (text) => say(`  [FAIL] ${text}`),
    secret: (text = '') => write(`${text}\n`),
  }
}
