/**
 * Where everything lives. One folder per Windows user: C:\Users\<you>\.remortstartpc
 *
 *   app\            the program (replaced by every update)
 *   config.json     the settings (port, who may connect)
 *   phones.json     the paired phones (only a fingerprint of each key, never the key)
 *   buttons.json    your own buttons          (optional, you write it)
 *   apps.json       your own apps             (optional, you write it)
 *   games.json      games Steam does not list (optional, you write it)
 *   pcs.json        other PCs to start/open   (optional, see docs/START-FROM-OFF.md)
 *   remote.log      what the program did, for when something goes wrong
 *   install.log     what the installer did (never contains the pairing link)
 *   start.ps1       the hidden launcher the scheduled task runs
 *
 * Updates replace only `app\`, so your own files are never touched.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export function dataPaths(home = process.env.REMORTSTARTPC_HOME || join(homedir(), '.remortstartpc')) {
  return {
    home,
    app: join(home, 'app'),
    config: join(home, 'config.json'),
    phones: join(home, 'phones.json'),
    installed: join(home, 'installed.json'),
    log: join(home, 'remote.log'),
    installLog: join(home, 'install.log'),
    launcher: join(home, 'start.ps1'),
    buttons: join(home, 'buttons.json'),
    apps: join(home, 'apps.json'),
    games: join(home, 'games.json'),
    pcs: join(home, 'pcs.json'),
    switchLog: join(home, 'steam-switch.log'),
  }
}

/** Name of the scheduled task and of the firewall rule. */
export const TASK_NAME = 'RemortStartPc'
export const FIREWALL_RULE = 'RemortStartPc'

/** The program exits with this code to say "start me again" (after an update). The launcher obeys. */
export const RESTART_CODE = 75
