/**
 * Getting a PC ready to be started over the network (Wake-on-LAN): turns on the Windows side and
 * tells you what only the PC's BIOS/UEFI can do. A PC that is completely OFF can only be woken over a
 * network CABLE, by a device on the same network (see docs/START-FROM-OFF.md).
 */

import { hostname as osHostname } from 'node:os'

/** Turns on "Wake on Magic Packet" for every network card and turns off Fast startup (it blocks waking from "off"). Prints JSON. */
export const wolScript = String.raw`$result = @()
Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object {
  $a = $_
  $enabled = $false
  try { Set-NetAdapterPowerManagement -Name $a.Name -WakeOnMagicPacket Enabled -ErrorAction Stop; $enabled = $true } catch {}
  try {
    Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Wake.*(Magic|Shutdown)|Shutdown.*Wake' } | ForEach-Object {
      if ($_.ValidDisplayValues -contains 'Enabled') { Set-NetAdapterAdvancedProperty -Name $a.Name -DisplayName $_.DisplayName -DisplayValue 'Enabled' -ErrorAction SilentlyContinue }
    }
  } catch {}
  $result += [pscustomobject]@{ name = $a.Name; media = [string]$a.PhysicalMediaType; mac = [string]$a.MacAddress; up = ($a.Status -eq 'Up'); wol = $enabled }
}
$fast = 'unchanged'
try { Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -ErrorAction Stop; $fast = 'off' } catch {}
@{ adapters = @($result); fastStartup = $fast } | ConvertTo-Json -Compress -Depth 4`

/** { adapters: [{ name, kind: 'cable'|'wifi'|'other', mac, up, wol }], fastStartup } from the script's output. */
export function parseWol(text) {
  const line = String(text ?? '').trim().split(/\r?\n/).at(-1) ?? ''
  const j = JSON.parse(line)
  const list = Array.isArray(j.adapters) ? j.adapters : j.adapters ? [j.adapters] : []
  return {
    fastStartup: j.fastStartup === 'off' ? 'off' : 'unchanged',
    adapters: list.map((a) => ({
      name: String(a.name ?? '').slice(0, 60),
      kind: /802\.3/.test(a.media) ? 'cable' : /802\.11/.test(a.media) ? 'wifi' : 'other',
      mac: String(a.mac ?? '').replace(/-/g, ':').toUpperCase(),
      up: a.up === true,
      wol: a.wol === true,
    })),
  }
}

/** What to tell the person, in plain lines. `ip` is this PC's Tailscale address (or ''), `port` the page port. */
export function describeWol(parsed, { ip = '', port = 8791, hostname = osHostname() } = {}) {
  const lines = []
  const cable = parsed.adapters.filter((a) => a.kind === 'cable')
  const live = cable.find((a) => a.up) ?? cable[0]
  if (parsed.fastStartup === 'off') lines.push('[ OK ] Fast startup is off (it stops a PC from waking after a normal shut down).')
  else lines.push('[ !! ] Fast startup could not be turned off. Run this as administrator (Install.cmd style), or turn it off in Control Panel > Power Options > "Choose what the power buttons do".')
  if (!live) {
    lines.push('[ !! ] This PC has no network cable adapter. A PC on Wi-Fi almost never wakes up from OFF.')
    lines.push('       Sleep can sometimes be woken over Wi-Fi, but a sleeping PC is not reachable by Tailscale. Options: docs/START-FROM-OFF.md')
    return lines
  }
  lines.push(`[ OK ] Wake-on-LAN ${live.wol ? 'is turned on' : 'could not be turned on automatically'} for "${live.name}".`)
  lines.push(`       This PC's cable (MAC) address: ${live.mac}`)
  if (!live.up) lines.push('[ !! ] The cable is not connected right now. Plug it in before you rely on this.')
  lines.push('')
  lines.push('Two things only you can do:')
  lines.push('  1. In the BIOS/UEFI (press F2 or Del while the PC starts) turn on "Wake on LAN" / "Power on by PCI-E" / "Wake on PCIe".')
  lines.push('     (The name differs per maker. Some laptops cannot wake from OFF at all.)')
  lines.push('  2. On ANOTHER PC (or a Raspberry Pi) that stays on, in the same home network, run Install.cmd and then:')
  lines.push(`       node "%USERPROFILE%\\.remortstartpc\\app\\bin\\add-pc.mjs" "${hostname}" ${live.mac}${ip ? ` http://${ip}:${port}` : ''}`)
  lines.push('     The page of that other PC then has a Start button for this PC.')
  return lines
}
