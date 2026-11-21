/**
 * What the phone buttons do on the PC. No free text ever reaches a command: every action is one of
 * a fixed list, and the only thing a button can carry is a NAME that this program looks up itself:
 * a game from Steam's own list, an app from the Start menu list, or a button from buttons.json.
 *
 * Windows only (the buttons say so on other systems). The PowerShell parts are passed as an
 * encoded command, so no quoting of the text can change what runs.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { hostname as osHostname, uptime } from 'node:os'
import { join } from 'node:path'
import { appendLog as defaultAppendLog, writeAtomic as defaultWriteAtomic } from './fsutil.mjs'
import {
  extraGames,
  findGameArt,
  parseSteamAccounts,
  parseSteamLogin,
  parseSteamUsers,
  regValue,
  scanGames,
  setMostRecent,
  steamIdFromAccountNumber,
} from './steam.mjs'

/** Apps offered on the page when they are installed: [label shown, name in the Start menu (* matches anything)]. */
export const APP_CANDIDATES = [
  ['Spotify', 'Spotify'],
]

/** Virtual key code and how many times to press it. */
const KEYS = {
  volume_up: [0xaf, 5],
  volume_down: [0xae, 5],
  mute: [0xad, 1],
  media_playpause: [0xb3, 1],
  media_next: [0xb0, 1],
  media_prev: [0xb1, 1],
}
const KEY_MESSAGES = {
  volume_up: 'Volume up.',
  volume_down: 'Volume down.',
  mute: 'Mute toggled.',
  media_playpause: 'Play / pause.',
  media_next: 'Next track.',
  media_prev: 'Previous track.',
}

export const ACTIONS = [
  'steam_open',
  'steam_bigpicture',
  'steam_game',
  'close_game',
  'steam_switch',
  'lock',
  'sleep',
  'restart',
  'shutdown',
  'shutdown_cancel',
  'screen_off',
  'app',
  'button',
  'status',
  'update',
  'restart_remote',
  'timer_set',
  'mode_saver',
  'mode_balanced',
  'mode_gaming',
  'window_focus',
  'window_close',
  'desktop_toggle',
  'volume_set',
  'mute_set',
  'bt_connect',
  'bt_disconnect',
  'audio_set',
  ...Object.keys(KEYS),
]

const WILDCARD = (pattern) => new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
const CONTROL = /[\u0000-\u001f]/

/** Buttons you defined yourself in buttons.json. Entries that look odd are ignored. */
export function knownButtons(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = {}
  try {
    for (const [name, v] of Object.entries(JSON.parse(readText(file)))) {
      const key = String(name).toLowerCase().trim()
      const command = typeof v === 'string' ? v.trim() : typeof v?.command === 'string' ? v.command.trim() : ''
      const cwd = typeof v?.cwd === 'string' ? v.cwd.trim() : ''
      if (!key || key.length > 40 || !command || command.length > 300 || CONTROL.test(command) || CONTROL.test(cwd) || CONTROL.test(key)) continue
      out[key] = { command, cwd }
    }
  } catch {
    // No file: no custom buttons.
  }
  return out
}

/** Apps you added yourself in apps.json: { "button name": "exact name in the Start menu" }. */
export function knownCustomApps(file, readText = (f) => readFileSync(f, 'utf8')) {
  const out = {}
  try {
    for (const [name, v] of Object.entries(JSON.parse(readText(file)))) {
      const label = String(name).trim()
      const target = typeof v === 'string' ? v.trim() : ''
      if (!label || label.length > 30 || !target || target.length > 60 || CONTROL.test(label + target)) continue
      out[label.toLowerCase()] = { label, match: target, exact: true }
    }
  } catch {
    // No file: only the built-in list.
  }
  return out
}

const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''

export function runCommand(file, args, { timeout = 15_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    // The callback also receives a failure to start, so nothing is left unhandled.
    execFile(file, args, { windowsHide: true, timeout, cwd, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error(firstLine(stderr) || firstLine(err.message))) : resolve(String(stdout)),
    )
  })
}

/** Opens a program or a protocol address (steam://, discord://) detached, with no shell parsing of our own. */
export function runLaunch(target) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', () => reject(new Error('That program could not be started.')))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64')
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

const keyScript = (vk, times) =>
  String.raw`Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'
1..${times} | ForEach-Object { [W.K]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); [W.K]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero) }`

const SCREEN_OFF = String.raw`Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int h, int m, int w, int l);'
[W.M]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null`

// Real sleep (not hibernate), whatever the "Fast startup" setting is.
const SLEEP = String.raw`Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)`

// Games are found through WMI (it can still read the path of games guarded by an anti-cheat, which Get-Process cannot).
// Lines starting with "!" are programs that were still running two seconds later.
const CLOSE_GAME = String.raw`$g = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*\steamapps\common\*' })
$g | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object -Unique
$g | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($g.Count) {
  Start-Sleep -Seconds 2
  $g | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | ForEach-Object { '!' + [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object -Unique
}`

// Bluetooth headphones. Paired devices are listed from Windows; connecting or disconnecting asks Windows to
// switch the audio services (music, calls) of ONE device, found by its exact name. Nothing else is touched.
// One line per paired device: its name, a tab, and whether Windows says it is connected right now (any of its entries counts).
export const BT_LIST = String.raw`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' -and $_.FriendlyName } | ForEach-Object { $c = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15' -ErrorAction SilentlyContinue).Data; $_.FriendlyName + [char]9 + [string]([bool]$c) } | Sort-Object -Unique`

// The simple older check (names only, no connection state): used when the first one finds nothing, so the list is never empty by accident.
export const BT_NAMES = String.raw`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' -and $_.FriendlyName } | ForEach-Object { $_.FriendlyName } | Sort-Object -Unique`

const btScript = (name, connect) => String.raw`$name = ${psQuote(name)}
$connect = ${connect ? '$true' : '$false'}
$dev = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' -and $_.FriendlyName -eq $name } | Select-Object -First 1
if (-not $dev) { 'notfound'; exit }
$hex = [regex]::Match($dev.InstanceId, 'DEV_([0-9A-Fa-f]{12})').Groups[1].Value
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RspBt {
  [StructLayout(LayoutKind.Sequential)] public struct ST { public ushort a, b, c, d, e, f, g, h; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEV { public uint size; public ulong addr; public uint cod; public int conn; public int rem; public int auth; public ST seen; public ST used; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string name; }
  [DllImport("bthprops.cpl", SetLastError = true)] static extern uint BluetoothSetServiceState(IntPtr radio, ref DEV d, ref Guid g, uint flags);
  public static string Run(ulong address, bool connect) {
    DEV d = new DEV(); d.size = (uint)Marshal.SizeOf(typeof(DEV)); d.addr = address;
    string[] ids = { "0000110b-0000-1000-8000-00805f9b34fb", "0000111e-0000-1000-8000-00805f9b34fb", "00001108-0000-1000-8000-00805f9b34fb" };
    uint ok = 1; uint last = 0;
    foreach (string id in ids) {
      Guid g = new Guid(id);
      if (connect) { BluetoothSetServiceState(IntPtr.Zero, ref d, ref g, 0); System.Threading.Thread.Sleep(300); }
      last = BluetoothSetServiceState(IntPtr.Zero, ref d, ref g, connect ? 1u : 0u);
      if (last == 0) ok = 0;
    }
    return ok == 0 ? "ok" : "fail:" + last;
  }
}
'@
[RspBt]::Run([Convert]::ToUInt64($hex, 16), $connect)`

// Master volume of the default speaker: read and set as a real level (0 to 100), plus mute. Windows Core Audio, no key presses.
const volumeScript = (op, level = 0) => String.raw`$op = ${psQuote(op)}
$level = ${Math.max(0, Math.min(100, Number(level) | 0))}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IRspEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr n);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr n);
  [PreserveSig] int GetChannelCount(out uint c);
  [PreserveSig] int SetMasterVolumeLevel(float l, ref Guid ctx);
  [PreserveSig] int SetMasterVolumeLevelScalar(float l, ref Guid ctx);
  [PreserveSig] int GetMasterVolumeLevel(out float l);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float l);
  [PreserveSig] int SetChannelVolumeLevel(uint c, float l, ref Guid ctx);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint c, float l, ref Guid ctx);
  [PreserveSig] int GetChannelVolumeLevel(uint c, out float l);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint c, out float l);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IRspVolDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IRspVolEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr c);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IRspVolDevice d);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class RspVolEnumeratorClient { }
public static class RspVol {
  public static string Run(string op, int level) {
    IRspVolEnumerator e = (IRspVolEnumerator)new RspVolEnumeratorClient();
    IRspVolDevice d;
    if (e.GetDefaultAudioEndpoint(0, 1, out d) != 0) return "fail:device";
    Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object o;
    if (d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return "fail:activate";
    IRspEndpointVolume v = (IRspEndpointVolume)o;
    Guid ctx = Guid.Empty;
    if (op == "set") { v.SetMasterVolumeLevelScalar(level / 100f, ref ctx); if (level > 0) v.SetMute(false, ref ctx); }
    if (op == "mute") v.SetMute(true, ref ctx);
    if (op == "unmute") v.SetMute(false, ref ctx);
    float s; bool m;
    v.GetMasterVolumeLevelScalar(out s);
    v.GetMute(out m);
    return "vol:" + Math.Round(s * 100) + " mute:" + (m ? "1" : "0");
  }
}
'@
[RspVol]::Run($op, $level)`

// The windows open on this PC: listed (visible, with a title, no tool or hidden windows), brought to the front, or asked to close with the
// normal Windows close message (an app with unsaved work still asks you). Nothing is ended by force.
const windowsScript = (op, id = '0') => String.raw`$op = ${psQuote(op)}
$id = ${psQuote(String(id).replace(/\D/g, '').slice(0, 18) || '0')}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class RspWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  static bool Wanted(IntPtr h) {
    if (!IsWindowVisible(h)) return false;
    if (GetWindowTextLength(h) == 0) return false;
    if ((GetWindowLong(h, -20) & 0x80) != 0) return false;
    int cloaked = 0;
    if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    return true;
  }
  public static string Run(string op, long id) {
    IntPtr target = new IntPtr(id);
    if (op == "list") {
      StringBuilder sb = new StringBuilder();
      EnumWindows(delegate (IntPtr h, IntPtr l) {
        if (!Wanted(h)) return true;
        StringBuilder t = new StringBuilder(260);
        GetWindowText(h, t, 260);
        string title = t.ToString().Replace("\t", " ").Replace("\r", " ").Replace("\n", " ");
        if (title == "Program Manager") return true;
        uint pid = 0;
        GetWindowThreadProcessId(h, out pid);
        string name = "";
        try { name = Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
        sb.Append(h.ToInt64()).Append("\t").Append(name).Append("\t").Append(IsIconic(h) ? "1" : "0").Append("\t").Append(title).Append("\n");
        return true;
      }, IntPtr.Zero);
      return sb.ToString();
    }
    if (!IsWindow(target)) return "gone";
    if (op == "focus") {
      if (IsIconic(target)) ShowWindow(target, 9);
      keybd_event(0x12, 0, 0, UIntPtr.Zero);
      keybd_event(0x12, 0, 2, UIntPtr.Zero);
      SetForegroundWindow(target);
      return "ok";
    }
    if (op == "close") {
      PostMessage(target, 0x0010, IntPtr.Zero, IntPtr.Zero);
      return "ok";
    }
    return "unknown";
  }
}
'@
[RspWin]::Run($op, [Int64]$id)`

const TOGGLE_DESKTOP = String.raw`(New-Object -ComObject Shell.Application).ToggleDesktop(); 'ok'`

// Audio output (the "default speaker"). Active playback devices are listed from Windows; switching sets the default
// for ONE device found by its exact name, for apps, media and calls.
const AUDIO_LIST = String.raw`Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '\{0\.0\.0\.00000000\}' -and $_.FriendlyName } | ForEach-Object { $_.FriendlyName } | Sort-Object -Unique`

const audioScript = (name) => String.raw`$name = ${psQuote(name)}
$dev = Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '\{0\.0\.0\.00000000\}' -and $_.FriendlyName -eq $name } | Select-Object -First 1
if (-not $dev) { 'notfound'; exit }
$id = $dev.InstanceId -replace '^SWD\\MMDEVAPI\\', ''
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IRspPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr f);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n, int d, IntPtr f);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a, IntPtr b);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string n, int d, IntPtr a, IntPtr b);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr k, IntPtr v);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr k, IntPtr v);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string n, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string n, int v);
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class RspPolicyConfigClient { }
public static class RspAudio {
  public static string Set(string id) {
    IRspPolicyConfig p = (IRspPolicyConfig)new RspPolicyConfigClient();
    int last = 0;
    for (int role = 0; role < 3; role++) { last = p.SetDefaultEndpoint(id, role); if (last != 0) return "fail:" + last; }
    return "ok";
  }
}
'@
[RspAudio]::Set($id)`

const BATTERY = String.raw`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b) { "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" }`


/** Windows power modes (the "Power mode" slider). The overlay is the Windows 11 slider; the plan is the older fallback. */
const MODES = {
  saver: { name: 'Efficiency', overlay: 'OVERLAY_SCHEME_MIN', plan: 'a1841308-3541-4fab-bc81-f71556f20b4a' },
  balanced: { name: 'Balanced', overlay: 'OVERLAY_SCHEME_NONE', plan: '381b4222-f694-41f0-9685-ff5bb260df2e' },
  gaming: { name: 'Performance', overlay: 'OVERLAY_SCHEME_MAX', plan: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' },
}

const START_NAMES = String.raw`Get-StartApps | ForEach-Object { $_.Name }`

const startAppScript = (name, exact) => String.raw`$n = ${psQuote(name)}
$a = Get-StartApps | Where-Object { ${exact ? '$_.Name -eq $n' : '$_.Name -like $n'} } | Select-Object -First 1
if ($a) { Start-Process explorer.exe ("shell:AppsFolder\" + $a.AppID); $a.Name }`

const MODEL = String.raw`Get-CimInstance Win32_ComputerSystem | ForEach-Object { "$($_.Manufacturer)|$($_.Model)" }`

/** "ROG Strix G614JV_G614JV" -> "ROG Strix G614JV". Only a name to show, never used for anything else. */
export function cleanModel(text) {
  const model = String(text ?? '').trim().split(/\r?\n/).at(-1)?.split('|').slice(1).join('|') ?? ''
  return model.replace(/_.*$/, '').replace(/[^\w .+-]/g, '').trim().slice(0, 40)
}

const duration = (seconds) => {
  const m = Math.floor(seconds / 60)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

const memo = (ttl, fn, now = Date.now) => {
  let at = -Infinity
  let value
  let running = null
  return async () => {
    if (now() - at < ttl) return value
    // Two callers at the same time share ONE run (each run can start a slow Windows program).
    running ??= fn()
      .then((v) => {
        value = v
        at = now()
        return v
      })
      .finally(() => {
        running = null
      })
    return running
  }
}

/**
 * Like memo, for the slow Windows questions the page shows: (1) callers at the same time share one run; (2) once there is an answer, an
 * old one is returned AT ONCE while a new one loads in the background, so the page never waits for Windows twice; (3) `fresh()` forces a
 * new run and waits for it; `set()` stores an answer we already know; `stale()` makes the next call reload. A failed run keeps the old answer.
 */
const swr = (ttl, load, now = Date.now) => {
  let at = -Infinity
  let value
  let has = false
  let running = null
  const start = () => {
    running ??= Promise.resolve()
      .then(load)
      .then(
        (v) => {
          value = v
          has = true
          at = now()
          return v
        },
        () => value,
      )
      .finally(() => {
        running = null
      })
    return running
  }
  const get = () => {
    if (has && now() - at < ttl) return Promise.resolve(value)
    const p = start()
    return has ? Promise.resolve(value) : p
  }
  get.fresh = start
  get.set = (v) => {
    value = v
    has = true
    at = now()
  }
  get.stale = () => {
    at = -Infinity
  }
  return get
}

/**
 * Everything is injectable so it can be tested without Windows.
 * `files` says where the owner's own files are: { buttons, apps, games, switchLog }.
 */
export function createActions({
  files,
  version = '',
  restart = () => {
    throw new Error('Restarting is not available here.')
  },
  update = async () => {
    throw new Error('Updating is not available here.')
  },
  updateInfo = () => ({ available: false, boot: '' }),
  launch = runLaunch,
  run = runCommand,
  spawnFn = spawn,
  readText = (f) => readFileSync(f, 'utf8'),
  readBytes = (f) => readFileSync(f),
  readdir,
  stat = statSync,
  exists = existsSync,
  writeAtomic = defaultWriteAtomic,
  appendLog = defaultAppendLog,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform = process.platform,
  uptimeFn = uptime,
  hostname = osHostname,
  now = Date.now,
}) {
  const winOnly = () => {
    if (platform !== 'win32') throw new Error('This button works on Windows only.')
  }
  const ps = (script, opts) => {
    winOnly()
    return run('powershell.exe', psArgs(script), opts)
  }

  // -- Steam -------------------------------------------------------------------------

  const steamPath = memo(10 * 60_000, async () => {
    if (platform !== 'win32') return ''
    const fromRegistry = regValue(await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']).catch(() => ''), 'SteamPath')
    const guesses = [fromRegistry, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean)
    return guesses.find((p) => exists(join(p, 'steam.exe'))) ?? ''
  }, now)

  const gameList = memo(60_000, async () => {
    const path = await steamPath()
    const scanned = path ? scanGames(path, { readText, readdir }) : []
    const byName = new Map()
    for (const g of [...scanned, ...extraGames(files.games, readText)]) if (!byName.has(g.name.toLowerCase())) byName.set(g.name.toLowerCase(), g)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, now)

  const findGame = async (arg) => {
    const wanted = String(arg ?? '').trim().toLowerCase()
    const list = await gameList()
    return list.find((g) => g.name.toLowerCase() === wanted) ?? null
  }

  const steamInfo = memo(8_000, async () => {
    const path = await steamPath()
    if (!path) return null
    try {
      const key = 'HKCU\\Software\\Valve\\Steam'
      const vdf = readText(join(path, 'config', 'loginusers.vdf'))
      const login = parseSteamLogin(vdf)
      let user = login.name
      let id = login.id
      try {
        const active = Number.parseInt(regValue(await run('reg.exe', ['query', `${key}\\ActiveProcess`, '/v', 'ActiveUser']), 'ActiveUser'), 16)
        const real = steamIdFromAccountNumber(active)
        const found = real ? parseSteamUsers(vdf).find((u) => u.id === real) : null
        if (found) {
          user = found.name
          id = found.id
        }
      } catch {
        // Steam is not signed in, or the value is missing: the flag in the file is the best guess.
      }
      let playing = ''
      try {
        const running = Number.parseInt(regValue(await run('reg.exe', ['query', key, '/v', 'RunningAppID']), 'RunningAppID'), 16)
        if (running > 0) playing = (await gameList()).find((g) => Number(g.appid) === running)?.name ?? `app ${running}`
      } catch {
        // Not running a game, or the value is missing.
      }
      return { user, playing, id, path, accounts: parseSteamAccounts(vdf) }
    } catch {
      return { user: '', playing: '', id: '', path, accounts: [] }
    }
  }, now)

  const note = (text) => {
    try {
      appendLog(files.switchLog, `${new Date().toISOString()}  ${text}\n`)
    } catch {
      // The log is only a help; never let it stop the switch.
    }
  }
  const steamRunning = async () => /steam\.exe/i.test(await run('tasklist.exe', ['/FI', 'IMAGENAME eq steam.exe', '/NH']).catch(() => ''))
  let switching = Promise.resolve()

  // The steps, one by one, in the background. Each one is written to the log so a stop can be found.
  async function runSwitch(steam, target) {
    const exe = join(steam.path, 'steam.exe')
    const vdfFile = join(steam.path, 'config', 'loginusers.vdf')
    note(`switching to ${target.name}; steam folder ${steam.path}`)
    if (await steamRunning()) {
      note('steam is running: asking it to close')
      await run(exe, ['-shutdown'], { timeout: 10_000 }).catch((err) => note(`-shutdown said: ${err.message}`))
      let waited = 0
      while (waited < 40 && (await steamRunning())) {
        await sleep(1000)
        waited++
      }
      if (await steamRunning()) {
        note('steam did not close in 40 s: forcing it')
        await run('taskkill.exe', ['/IM', 'steam.exe', '/F']).catch((err) => note(`taskkill said: ${err.message}`))
        await sleep(1500)
      }
      note(`steam closed after about ${waited} s`)
    } else {
      note('steam was not running')
    }
    const before = readText(vdfFile)
    writeAtomic(`${vdfFile}.rsp-backup`, before)
    writeAtomic(vdfFile, setMostRecent(before, target.id))
    note('loginusers.vdf updated (backup saved next to it)')
    const key = 'HKCU\\Software\\Valve\\Steam'
    await run('reg.exe', ['add', key, '/v', 'AutoLoginUser', '/t', 'REG_SZ', '/d', target.account, '/f'])
    await run('reg.exe', ['add', key, '/v', 'RememberPassword', '/t', 'REG_DWORD', '/d', '1', '/f'])
    note('registry set: AutoLoginUser and RememberPassword')
    await sleep(2000)
    const child = spawnFn(exe, [], { detached: true, stdio: 'ignore' })
    child.once('error', (err) => note(`could not start steam: ${err.message}`))
    child.unref?.()
    note('steam started: done')
  }

  async function switchSteam(id) {
    winOnly()
    const steam = await steamInfo()
    const wanted = String(id ?? '').trim()
    const target = /^\d{17}$/.test(wanted) ? steam?.accounts?.find((a) => a.id === wanted) : null
    note(`switch requested; signed in now: ${steam?.user || 'nobody'}; remembered accounts: ${steam?.accounts?.length ?? 0}`)
    if (!target) {
      note('refused: that is not an account this PC stays signed in to')
      throw new Error('That is not an account this PC stays signed in to.')
    }
    if (target.id === steam.id) return `${target.name} is already signed in.`
    // Answer at once; the steps run in the background and write their progress to the log.
    switching = runSwitch(steam, target).catch((err) => note(`STOPPED: ${err.message}`))
    return `Switching Steam to ${target.name}. Steam closes and starts again: about 30 seconds. If nothing changes, see steam-switch.log in the .remortstartpc folder.`
  }

  // -- apps ---------------------------------------------------------------------------

  const startNames = swr(5 * 60_000, async () => (await ps(START_NAMES, { timeout: 20_000 })).split(/\r?\n/).map((l) => l.trim()).filter(Boolean), now)

  /** The apps this PC can open: built-in ones that are installed, and your own from apps.json. */
  async function appChoices() {
    const choices = new Map()
    if (platform === 'win32') {
      let names = []
      try {
        names = (await startNames()) ?? []
      } catch {
        // The Start menu could not be read: only your own apps are offered.
      }
      for (const [label, match] of APP_CANDIDATES) {
        const re = WILDCARD(match)
        if (names.some((n) => re.test(n))) choices.set(label.toLowerCase(), { label, match, exact: false })
      }
    }
    for (const [key, c] of Object.entries(knownCustomApps(files.apps, readText))) choices.set(key, c)
    return choices
  }

  const buttons = () => knownButtons(files.buttons, readText)


  // Paired Bluetooth devices and active playback devices, looked up from Windows and cached briefly.
  const listLines = (script, max) =>
    ps(script, { timeout: 15_000 }).then(
      // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
      (o) => o.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.length <= max && !/[\u0000-\u0008\u000a-\u001f]/.test(l)).slice(0, 20),
      () => [],
    )
  // The page shows which power mode was chosen last (Windows does not tell us the slider position simply).
  // Windows idle timers: turn the screen off after N minutes, go to sleep after N minutes (0 = never). Read and set with powercfg (a small
  // Windows program, no PowerShell). Set for both "plugged in" and "on battery", so the choice is simple.
  const TIMERS = {
    screen: { ac: 'monitor-timeout-ac', dc: 'monitor-timeout-dc', sub: 'SUB_VIDEO', setting: 'VIDEOIDLE', choices: [1, 2, 3, 5, 10, 15, 20, 30, 60, 0], text: (m) => (m ? `Screen turns off after ${m} minute${m === 1 ? '' : 's'}.` : 'Screen never turns off by itself.') },
    sleep: { ac: 'standby-timeout-ac', dc: 'standby-timeout-dc', sub: 'SUB_SLEEP', setting: 'STANDBYIDLE', choices: [5, 10, 15, 20, 30, 45, 60, 120, 0], text: (m) => (m ? `PC goes to sleep after ${m} minute${m === 1 ? '' : 's'}.` : 'PC never goes to sleep by itself.') },
  }
  async function readTimer(kind) {
    const t = TIMERS[kind]
    try {
      const out = await run('powercfg.exe', ['/query', 'SCHEME_CURRENT', t.sub, t.setting])
      // The last two numbers are the current setting "plugged in" and "on battery", in seconds (works in every language of Windows).
      const hex = [...out.matchAll(/0x[0-9a-f]{8}/gi)].map((m) => Number.parseInt(m[0], 16))
      return hex.length >= 2 ? Math.round(hex.at(-2) / 60) : null
    } catch {
      return null
    }
  }
  const timers = swr(30_000, async () => (platform === 'win32' ? { screen: await readTimer('screen'), sleep: await readTimer('sleep') } : null), now)
  async function setTimer(arg) {
    winOnly()
    const m = /^(screen|sleep):(\d{1,3})$/.exec(String(arg ?? ''))
    const t = m && TIMERS[m[1]]
    const minutes = m ? Number(m[2]) : -1
    if (!t || !t.choices.includes(minutes)) throw new Error('Pick one of the times in the list.')
    await run('powercfg.exe', ['/change', t.ac, String(minutes)])
    await run('powercfg.exe', ['/change', t.dc, String(minutes)])
    timers.set({ ...((await timers()) ?? {}), [m[1]]: minutes })
    return t.text(minutes)
  }

  const readMode = () => {
    try {
      const m = readText(files.mode).trim()
      return Object.hasOwn(MODES, m) ? m : ''
    } catch {
      return ''
    }
  }
  async function setMode(mode) {
    winOnly()
    const m = MODES[mode]
    try {
      await run('powercfg.exe', ['/overlaysetactive', m.overlay])
    } catch {
      try {
        await run('powercfg.exe', ['/setactive', m.plan])
      } catch {
        // "High performance" is hidden on some PCs; make a copy of it and use that.
        const copy = mode === 'gaming' ? /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(await run('powercfg.exe', ['/duplicatescheme', m.plan]).catch(() => ''))?.[1] : null
        if (!copy) throw new Error('Windows would not change the power mode on this PC.')
        await run('powercfg.exe', ['/setactive', copy])
      }
    }
    try {
      writeAtomic(files.mode, mode)
    } catch {
      // Only the highlight on the page is lost.
    }
    return `${m.name} power mode.`
  }

  // The sound level of the default speaker, read for the page's slider (cached a few seconds) and set from it.
  // Windows open on this PC. A window can only be switched to or closed if it was in the list this PC showed in the last 5 minutes.
  const shownWindows = { at: -Infinity, byId: new Map() }
  async function listWindows() {
    winOnly()
    const out = await ps(windowsScript('list'), { timeout: 15_000 })
    const list = []
    for (const line of out.split(/\r?\n/)) {
      const [id, name, minimized, ...rest] = line.split('\t')
      const title = rest.join(' ').trim()
      if (!/^\d{1,18}$/.test(id ?? '') || !title) continue
      list.push({ id, name: (name || '').slice(0, 40), title: title.slice(0, 120), minimized: minimized === '1' })
      if (list.length >= 40) break
    }
    shownWindows.byId = new Map(list.map((w) => [w.id, w]))
    shownWindows.at = now()
    return list
  }
  async function windowAction(op, arg) {
    winOnly()
    const id = String(arg ?? '')
    const w = shownWindows.byId.get(id)
    if (!w || now() - shownWindows.at > 5 * 60_000) throw new Error('Open the Windows list again (Refresh), then try once more.')
    const out = (await ps(windowsScript(op, id), { timeout: 15_000 })).trim().split(/\r?\n/).at(-1)
    if (out === 'gone') {
      shownWindows.byId.delete(id)
      throw new Error('That window is already closed. Press Refresh.')
    }
    if (out !== 'ok') throw new Error('Windows did not let me do that.')
    if (op === 'close') shownWindows.byId.delete(id)
    return op === 'focus' ? `Switched to "${w.title}".` : `Asked "${w.title}" to close. If it has unsaved work it may ask you first.`
  }

  const parseVol = (out) => {
    const m = /vol:(\d+) mute:([01])/.exec(out)
    return m ? { level: Math.min(100, Number(m[1])), muted: m[2] === '1' } : null
  }
  // Reading the level compiles a small program, so it is slow: asked at most every 10 s, and the old answer is shown meanwhile.
  const volume = swr(10_000, () => (platform === 'win32' ? ps(volumeScript('get'), { timeout: 10_000 }).then(parseVol, () => null) : null), now)
  const readVolume = () => volume()
  // Dragging the slider sends many levels in a row, and every change starts a slow Windows program. So at most ONE runs at a time, and
  // while it runs only the newest wanted level is remembered: the last position always wins and the PC is not flooded.
  let volumeRun = null
  let volumeWanted = null
  function setVolumeLevel(level) {
    volumeWanted = level
    volumeRun ??= (async () => {
      let v = null
      while (volumeWanted !== null) {
        const next = volumeWanted
        volumeWanted = null
        v = await changeVolume('set', next)
      }
      return v
    })().finally(() => {
      volumeRun = null
    })
    return volumeRun
  }
  async function changeVolume(op, level) {
    const v = await ps(volumeScript(op, level), { timeout: 10_000 }).then(parseVol, () => null)
    if (!v) throw new Error('Windows would not change the volume.')
    volume.set(v)
    return v
  }

  // Paired devices with their connection state. Cached for a few seconds only: a connection changes quickly and the page shows it.
  async function loadBluetooth() {
    let lines = await listLines(BT_LIST, 60)
    if (!lines.length) lines = (await listLines(BT_NAMES, 60)).map((n) => `${n}\tFalse`)
    const byName = new Map()
    for (const l of lines) {
      const [rawName, state] = l.split('\t')
      const name = (rawName ?? '').trim()
      if (!name || name.length > 40) continue
      byName.set(name, byName.get(name) === true || /^true$/i.test((state ?? '').trim()))
    }
    return [...byName].map(([name, connected]) => ({ name, connected }))
  }
  // The check asks Windows about every paired device (slow): at most every 30 s, the old list is shown meanwhile. A connect or disconnect asks for a fresh one.
  const bluetooth = swr(30_000, () => (platform === 'win32' ? loadBluetooth() : []), now)
  const listBluetooth = async (fresh = false) => (await (fresh ? bluetooth.fresh() : bluetooth())) ?? []
  const listHeadphones = async () => (await listBluetooth()).map((d) => d.name)
  const outputs = swr(30_000, () => (platform === 'win32' ? listLines(AUDIO_LIST, 80) : []), now)
  const listOutputs = async () => (await outputs()) ?? []

  // -- the actions --------------------------------------------------------------------

  async function perform(action, arg) {
    if (KEYS[action]) {
      const [vk, times] = KEYS[action]
      await ps(keyScript(vk, times))
      return KEY_MESSAGES[action]
    }
    switch (action) {
      case 'steam_open':
        winOnly()
        await launch('steam://open/main')
        return 'Opening Steam.'
      case 'steam_bigpicture':
        winOnly()
        await launch('steam://open/bigpicture')
        return 'Opening Big Picture.'
      case 'steam_game': {
        winOnly()
        const game = await findGame(arg)
        if (!game) throw new Error('That game is not in the list of this PC.')
        await launch(`steam://rungameid/${game.appid}`)
        return `Starting ${game.name}. It can take a minute to reach the menu.`
      }
      case 'close_game': {
        const lines = (await ps(CLOSE_GAME, { timeout: 20_000 })).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        const stuck = lines.filter((l) => l.startsWith('!')).map((l) => l.slice(1))
        const closed = lines.filter((l) => !l.startsWith('!') && !stuck.includes(l))
        if (!lines.length) return 'No Steam game is running.'
        const parts = []
        if (closed.length) parts.push(`Closed: ${closed.join(', ')}.`)
        if (stuck.length) parts.push(`Could not close: ${stuck.join(', ')} (protected or still saving). Close it in the game.`)
        return parts.join(' ')
      }
      case 'steam_switch':
        return switchSteam(arg)
      case 'lock':
        winOnly()
        await run('rundll32.exe', ['user32.dll,LockWorkStation'])
        return 'Locked.'
      case 'sleep':
        await ps(SLEEP)
        return 'Going to sleep. A sleeping PC cannot be reached: wake it with its power button, or see docs/START-FROM-OFF.md.'
      case 'restart':
        winOnly()
        await run('shutdown.exe', ['/r', '/t', '10', '/c', 'Restart from the phone'])
        return 'Restarting in 10 seconds. It comes back by itself and this page reconnects. To stop it, press Cancel turn off.'
      case 'shutdown':
        winOnly()
        await run('shutdown.exe', ['/s', '/t', '15', '/c', 'Turned off from the phone'])
        return 'Turning off in 15 seconds. To stop it, press Cancel turn off now.'
      case 'shutdown_cancel':
        winOnly()
        await run('shutdown.exe', ['/a']).catch(() => {
          throw new Error('There is no turn off or restart waiting to be cancelled.')
        })
        return 'Cancelled. The PC stays on.'
      case 'screen_off':
        await ps(SCREEN_OFF)
        return 'Screen off. Moving the mouse turns it back on.'
      case 'status':
        return statusText()
      case 'update':
        return update()
      case 'restart_remote':
        return restart()
      case 'timer_set':
        return setTimer(arg)
      case 'mode_saver':
      case 'mode_balanced':
      case 'mode_gaming':
        return setMode(action.slice(5))
      case 'window_focus':
      case 'window_close':
        return windowAction(action.slice(7), arg)
      case 'desktop_toggle':
        winOnly()
        await ps(TOGGLE_DESKTOP)
        return 'Show desktop.'
      case 'volume_set': {
        // The phone sends the level as text ("55"); anything but 1 to 3 digits from 0 to 100 is refused.
        const text = String(arg ?? '')
        const n = Number(text)
        if (!/^\d{1,3}$/.test(text) || n > 100) throw new Error('The volume is a whole number from 0 to 100.')
        const v = await setVolumeLevel(n)
        return `Volume ${v.level}%.`
      }
      case 'mute_set': {
        if (arg !== 'on' && arg !== 'off') throw new Error('Mute is on or off.')
        const v = await changeVolume(arg === 'on' ? 'mute' : 'unmute', 0)
        return v.muted ? 'Muted.' : `Sound on, volume ${v.level}%.`
      }
      case 'bt_connect':
      case 'bt_disconnect': {
        const connect = action === 'bt_connect'
        const name = (await listHeadphones()).find((n) => n.toLowerCase() === String(arg ?? '').toLowerCase().trim())
        if (!name) throw new Error('That device is not paired with this PC.')
        const out = (await ps(btScript(name, connect), { timeout: 30_000 })).trim().split(/\r?\n/).at(-1)
        if (out !== 'ok') throw new Error(out === 'notfound' ? 'Windows no longer lists that device.' : 'Windows refused (are the earphones in range and awake?).')
        // Windows needs a few seconds: look until the device really shows the new state (up to about 8 seconds), then say what is true.
        let now2 = false
        for (let i = 0; i < 8; i++) {
          await sleep(1000)
          const d = (await listBluetooth(true)).find((x) => x.name === name)
          if (d && d.connected === connect) {
            now2 = true
            break
          }
        }
        if (connect) return now2 ? `${name} is connected.` : `Asked Windows to connect ${name}, but it is not connected yet. Open its case or take it out; it must not be busy with another device.`
        return now2 ? `${name} is disconnected. It is free for your phone or another device now.` : `Asked Windows to disconnect ${name}; it still shows as connected.`
      }
      case 'audio_set': {
        const name = (await listOutputs()).find((n) => n.toLowerCase() === String(arg ?? '').toLowerCase().trim())
        if (!name) throw new Error('That audio output is not available on this PC right now.')
        const out = (await ps(audioScript(name), { timeout: 30_000 })).trim().split(/\r?\n/).at(-1)
        if (out !== 'ok') throw new Error(out === 'notfound' ? 'Windows no longer lists that output.' : 'Windows refused to switch the audio output.')
        outputs.stale()
        return `Sound now plays on ${name}.`
      }
      case 'app': {
        winOnly()
        const choice = (await appChoices()).get(String(arg ?? '').toLowerCase().trim())
        if (!choice) throw new Error('Unknown app.')
        const opened = (await ps(startAppScript(choice.match, choice.exact))).trim().split(/\r?\n/)[0]
        if (!opened) throw new Error(`${choice.label} was not found in the Start menu of this PC.`)
        return `Opening ${opened}.`
      }
      case 'button':
        return runButton(arg)
      default:
        throw new Error('Unknown action.')
    }
  }

  async function statusText() {
    const parts = []
    try {
      const out = await run('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'])
      const [t, u, used, total] = out.trim().split(/\r?\n/)[0].split(/\s*,\s*/).map(Number)
      if ([t, u, used, total].every(Number.isFinite)) parts.push(`GPU ${t} °C, ${u}% busy, ${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB`)
    } catch {
      // No NVIDIA tool: skip the GPU part.
    }
    try {
      const out = (await ps(BATTERY)).trim()
      const [pct, st] = out.split('|').map(Number)
      if (Number.isFinite(pct)) parts.push(`Battery ${pct}% (${[1, 4, 5].includes(st) ? 'on battery' : 'plugged in'})`)
    } catch {
      // No battery information.
    }
    parts.push(`Up ${duration(uptimeFn())}`)
    return parts.join(' · ')
  }

  function runButton(name) {
    const key = String(name ?? '').toLowerCase().trim()
    const all = buttons()
    const button = Object.hasOwn(all, key) ? all[key] : null
    if (!button) throw new Error('That button is not in buttons.json on this PC.')
    winOnly()
    if (button.cwd && !exists(button.cwd)) throw new Error('The folder for that button does not exist.')
    return new Promise((resolve, reject) => {
      const child = spawnFn('cmd.exe', ['/d', '/s', '/c', `"${button.command}"`], {
        cwd: button.cwd || undefined,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      child.once('error', () => reject(new Error('That command could not be started.')))
      child.once('spawn', () => {
        child.unref()
        resolve(`Started: ${key}.`)
      })
    })
  }

  // -- pictures -----------------------------------------------------------------------

  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const typeOf = (file) => TYPES[String(file).split('.').pop().toLowerCase()]

  async function gameArtFile(name) {
    const game = await findGame(name)
    const path = await steamPath()
    return game && path ? findGameArt(path, game.appid, { readdir, stat }) : null
  }

  // Which games have a picture changes rarely, so it is looked up at most every five minutes.
  const artList = memo(5 * 60_000, async () => {
    const names = []
    for (const g of await gameList()) if (await gameArtFile(g.name)) names.push(g.name)
    return names
  }, now)

  const model = memo(24 * 60 * 60_000, async () => (platform === 'win32' ? ps(MODEL).then(cleanModel, () => '') : ''), now)

  return {
    run: perform,
    /** Resolves when the background Steam switch has finished (used by tests). */
    settled: () => switching,
    async info() {
      // Everything the page shows is asked at the SAME time (each answer is cached and shared), so the page waits for the slowest one,
      // not for all of them in a row.
      let timer
      // One part failing never blanks the page: it just comes back empty and the rest is shown.
      const safe = (promise, empty) => Promise.resolve(promise).catch(() => empty)
      const [modelName, steam, games, art, vol, bt, outs, apps, tm] = await Promise.all([
        safe(Promise.race([model(), new Promise((r) => (timer = setTimeout(() => r(''), 1500)))]), ''),
        safe(steamInfo(), null),
        safe(gameList(), []),
        safe(artList(), []),
        safe(readVolume(), null),
        safe(listBluetooth(), []),
        safe(listOutputs(), []),
        safe(appChoices(), new Map()),
        safe(timers(), null),
      ])
      clearTimeout(timer)
      return {
        name: hostname(),
        model: modelName,
        version,
        update: updateInfo(),
        games: games.map((g) => g.name),
        gameArt: art ?? [],
        buttons: Object.keys(buttons()),
        mode: readMode(),
        timers: tm,
        timerChoices: platform === 'win32' ? { screen: TIMERS.screen.choices, sleep: TIMERS.sleep.choices } : null,
        volume: vol,
        headphones: bt.map((d) => d.name),
        btConnected: bt.filter((d) => d.connected).map((d) => d.name),
        outputs: outs,
        apps: [...apps.values()].map((c) => c.label),
        steam: steam ? { user: steam.user, playing: steam.playing, id: steam.id, avatar: Boolean(steam.id && steam.path), accounts: steam.accounts.map(({ id, name }) => ({ id, name })) } : null,
      }
    },
    /** The windows open on this PC (for the page's Windows list). */
    windows: listWindows,
    /** How long each slow question to Windows takes right now (asked fresh, all at once, like the page does). For Diagnostics. */
    async timings() {
      if (platform !== 'win32') return []
      const time = async (name, fn) => {
        const t0 = performance.now()
        let ok = true
        try {
          await fn()
        } catch {
          ok = false
        }
        return { name, ms: Math.round(performance.now() - t0), ok }
      }
      return Promise.all([
        time('PowerShell start', () => ps('1')),
        time('volume', () => volume.fresh()),
        time('Bluetooth', () => bluetooth.fresh()),
        time('sound outputs', () => outputs.fresh()),
        time('Start menu apps', () => startNames.fresh()),
      ])
    },
    async avatar() {
      const steam = await steamInfo()
      if (!steam?.id || !steam.path) return null
      for (const ext of ['png', 'jpg']) {
        const file = join(steam.path, 'config', 'avatarcache', `${steam.id}.${ext}`)
        try {
          if (exists(file) && stat(file).size <= 1024 * 1024) return { type: TYPES[ext], bytes: readBytes(file) }
        } catch {
          // Unreadable: try the next one.
        }
      }
      return null
    },
    async gameArt(name) {
      const file = await gameArtFile(name)
      return file && typeOf(file) ? { type: typeOf(file), bytes: readBytes(file) } : null
    },
  }
}

/** The PowerShell snippets, so a Windows machine can check that every one of them parses (test/powershell.test.mjs). */
export const POWERSHELL_SNIPPETS = {
  keys: keyScript(175, 5),
  screenOff: SCREEN_OFF,
  sleep: SLEEP,
  closeGame: CLOSE_GAME,
  battery: BATTERY,
  startNames: START_NAMES,
  startApp: startAppScript("Some 'App'", false),
  windowsList: windowsScript('list'),
  windowsFocus: windowsScript('focus', '123'),
  toggleDesktop: TOGGLE_DESKTOP,
  volumeGet: volumeScript('get'),
  volumeSet: volumeScript('set', 40),
  btList: BT_LIST,
  btNames: BT_NAMES,
  btConnect: btScript('Some Buds', true),
  audioList: AUDIO_LIST,
  audioSet: audioScript('Some Speakers'),
  model: MODEL,
}
