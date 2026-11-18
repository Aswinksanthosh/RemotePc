#!/usr/bin/env node
// Sets, changes or removes the PIN. Set-PIN.cmd runs this.
//   node bin/pin.mjs            ask for a new PIN
//   node bin/pin.mjs --remove   remove the PIN
import { dataPaths } from '../src/paths.mjs'
import { createPin } from '../src/pin.mjs'
import { setupPin } from '../src/setup.mjs'
import { ask } from '../src/system.mjs'
import { createUi, supportsColor } from '../src/ui.mjs'

const paths = dataPaths()
const ui = createUi({ color: supportsColor() })
const pin = createPin({ file: paths.pin })
ui.title('Remote Start PC: PIN')
if (process.argv.includes('--remove')) {
  pin.remove()
  ui.ok('The PIN was removed. Paired phones open the remote without asking.')
} else {
  await setupPin({ pin, ask, ui })
  ui.say('  Phones that were already signed in with the old PIN are asked again.')
}
