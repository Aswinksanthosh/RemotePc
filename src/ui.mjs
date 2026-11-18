/**
 * Plain, friendly console output for the installer and Fix-It. Markers like [ OK ] work in every Windows console; colours are added
 * when the console supports them (Windows 10 and newer, not when the output is piped, and never if NO_COLOR is set).
 *
 *   green  = done / good        cyan = information, headings        yellow = needs your attention        red = problem / danger
 *
 * Everything said is also kept in a log file (install.log) for support, in PLAIN text (no colour codes), EXCEPT secrets: `secret()`
 * prints and never logs (the pairing link and its code).
 */

const CODES = { bold: '1', dim: '2', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', white: '97' }

/** Colours are used only for a real terminal that is not asked to stay plain. */
export const supportsColor = (stream = process.stdout, env = process.env) => Boolean(stream?.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb'

export function createUi({ write = (s) => process.stdout.write(s), log = () => {}, color = false } = {}) {
  /** paint('green bold', 'text'): the text in those styles, or plain when colour is off. */
  const paint = (style, text) => {
    if (!color) return String(text)
    const codes = String(style).split(/\s+/).map((s) => CODES[s]).filter(Boolean)
    return codes.length ? `\u001b[${codes.join(';')}m${text}\u001b[0m` : String(text)
  }
  const plain = (text) => String(text).replace(/\u001b\[[0-9;]*m/g, '')
  // The screen gets the colours, the log never does.
  const say = (text = '') => {
    write(`${text}\n`)
    log(plain(text))
  }
  const marker = (style, mark, text, textStyle = '') => say(`  ${paint(style, mark)} ${textStyle ? paint(textStyle, text) : text}`)
  const bar = (n) => '='.repeat(Math.min(60, n))
  return {
    paint,
    say,
    blank: () => say(''),
    title: (text) => {
      say('')
      say(paint('cyan bold', bar(text.length + 4)))
      say(paint('cyan bold', `  ${text}`))
      say(paint('cyan bold', bar(text.length + 4)))
    },
    step: (n, total, text) => {
      say('')
      say(`${paint('blue bold', `Step ${n} of ${total}`)}${paint('dim', ':')} ${paint('white bold', text)}`)
    },
    /** A small heading inside a step, for example before a question. */
    heading: (text) => {
      say('')
      say(`  ${paint('magenta bold', text)}`)
    },
    /** One point under a heading. tone: 'good' (green), 'info' (plain), 'warn' (yellow), 'danger' (red). */
    point: (tone, text) => {
      const style = { good: 'green', warn: 'yellow', danger: 'red' }[tone] ?? 'cyan'
      say(`    ${paint(style, tone === 'danger' ? '!' : tone === 'warn' ? '!' : '-')} ${tone === 'danger' ? paint('red', text) : text}`)
    },
    ok: (text) => marker('green bold', '[ OK ]', text),
    info: (text) => marker('cyan bold', '[ .. ]', text),
    warn: (text) => marker('yellow bold', '[ !! ]', text, 'yellow'),
    fail: (text) => marker('red bold', '[FAIL]', text, 'red'),
    secret: (text = '') => write(`${text}\n`),
  }
}
