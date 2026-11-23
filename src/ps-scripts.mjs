/**
 * The PowerShell snippets the buttons run, and the small helpers that build them. Every script is passed as an encoded command, so no
 * quoting of the text can change what runs. Pure text: nothing here runs anything.
 */

export const encode = (script) => Buffer.from(script, 'utf16le').toString('base64')
export const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]
// -- clipboard (phone <-> this PC): text only, at most CLIP_MAX characters; the text travels as base64 so no quote can change the script --
export const CLIP_MAX = 2000
export const CLIP_GET = String.raw`$t = Get-Clipboard -Raw -ErrorAction SilentlyContinue
if ($t) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$t)) }`
export const clipSetScript = (text) => String.raw`Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(String(text), 'utf8').toString('base64')}')))
'ok'`

export const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

export const keyScript = (vk, times) =>
  String.raw`Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'
1..${times} | ForEach-Object { [W.K]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); [W.K]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero) }`

export const SCREEN_OFF = String.raw`Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int h, int m, int w, int l);'
[W.M]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null`

// Real sleep (not hibernate), whatever the "Fast startup" setting is.
export const SLEEP = String.raw`Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)`

// Games are found through WMI (it can still read the path of games guarded by an anti-cheat, which Get-Process cannot).
// Lines starting with "!" are programs that were still running two seconds later.
export const CLOSE_GAME = String.raw`$g = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*\steamapps\common\*' })
$g | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object -Unique
$g | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($g.Count) {
  Start-Sleep -Seconds 2
  $g | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | ForEach-Object { '!' + [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object -Unique
}`

// Bluetooth headphones. Paired devices are listed from Windows; connecting or disconnecting asks Windows to
// switch the audio services (music, calls) of ONE device, found by its exact name. Nothing else is touched.
// One line per paired device: its name, a tab, and whether Windows says it is connected right now (any of its entries counts).
export const BT_LIST = String.raw`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' -and $_.FriendlyName } | ForEach-Object { $c = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15' -ErrorAction SilentlyContinue).Data; $b = ''; if ($c) { $b = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue).Data }; $_.FriendlyName + [char]9 + [string]([bool]$c) + [char]9 + $b } | Sort-Object -Unique`

// The simple older check (names only, no connection state): used when the first one finds nothing, so the list is never empty by accident.
export const BT_NAMES = String.raw`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' -and $_.FriendlyName } | ForEach-Object { $_.FriendlyName } | Sort-Object -Unique`

export const btScript = (name, connect) => String.raw`$name = ${psQuote(name)}
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
export const volumeScript = (op, level = 0) => String.raw`$op = ${psQuote(op)}
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
export const windowsScript = (op, id = '0') => String.raw`$op = ${psQuote(op)}
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

export const TOGGLE_DESKTOP = String.raw`(New-Object -ComObject Shell.Application).ToggleDesktop(); 'ok'`

// Audio output (the "default speaker"). Active playback devices are listed from Windows; switching sets the default
// for ONE device found by its exact name, for apps, media and calls.
export const AUDIO_LIST = String.raw`Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '\{0\.0\.0\.00000000\}' -and $_.FriendlyName } | ForEach-Object { $_.FriendlyName } | Sort-Object -Unique`

export const audioScript = (name) => String.raw`$name = ${psQuote(name)}
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

// Charge of this laptop's own battery: "percent|BatteryStatus" (nothing on a PC without a battery). Status 1, 4, 5 = on battery; 2, 3, 6 to 9, 11 = plugged in.
// The drive letters of fixed and removable disks (a Steam library may be on any of them).
export const DRIVES = String.raw`Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3 OR DriveType=2' -ErrorAction SilentlyContinue | ForEach-Object { $_.DeviceID }`

export const BATTERY = String.raw`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b) { "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" }`


/** Windows power modes (the "Power mode" slider). The overlay is the Windows 11 slider; the plan is the older fallback. */
export const MODES = {
  saver: { name: 'Efficiency', overlay: 'OVERLAY_SCHEME_MIN', plan: 'a1841308-3541-4fab-bc81-f71556f20b4a' },
  balanced: { name: 'Balanced', overlay: 'OVERLAY_SCHEME_NONE', plan: '381b4222-f694-41f0-9685-ff5bb260df2e' },
  gaming: { name: 'Performance', overlay: 'OVERLAY_SCHEME_MAX', plan: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' },
}

export const START_NAMES = String.raw`Get-StartApps | ForEach-Object { $_.Name }`

export const startAppScript = (name, exact) => String.raw`$n = ${psQuote(name)}
$a = Get-StartApps | Where-Object { ${exact ? '$_.Name -eq $n' : '$_.Name -like $n'} } | Select-Object -First 1
if ($a) { Start-Process explorer.exe ("shell:AppsFolder\" + $a.AppID); $a.Name }`

export const MODEL = String.raw`Get-CimInstance Win32_ComputerSystem | ForEach-Object { "$($_.Manufacturer)|$($_.Model)" }`

/** "ROG Strix G614JV_G614JV" -> "ROG Strix G614JV". Only a name to show, never used for anything else. */
export function cleanModel(text) {
  const model = String(text ?? '').trim().split(/\r?\n/).at(-1)?.split('|').slice(1).join('|') ?? ''
  return model.replace(/_.*$/, '').replace(/[^\w .+-]/g, '').trim().slice(0, 40)
}

export const duration = (seconds) => {
  const m = Math.floor(seconds / 60)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

