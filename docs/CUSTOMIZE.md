# Customise it

Your own files live in one folder: `C:\Users\<you>\.remortstartpc` (open it quickly with `Win+R`, then type `%USERPROFILE%\.remortstartpc`). Updates replace only the `app` folder inside it, so **your files are never touched by an update**. You write all of these files yourself: the phone can press your buttons but can never create or change them.

After you change a file you do not need to restart anything, except `config.json`.

## Your own buttons (`buttons.json`)

A button runs one command on the PC when you hold it on the phone.

```json
{
  "open code": { "command": "code .", "cwd": "C:\\Users\\you\\my-project" },
  "my tests": { "command": "npm test", "cwd": "C:\\Users\\you\\my-project" },
  "calculator": "calc.exe"
}
```

- The name is what the button says. The command is run like you typed it in a command prompt, in the folder `cwd` (optional).
- A plain text value (like `"calc.exe"`) is a command with no folder.
- Keep each command on one line, under 300 characters.
- They appear under **My buttons**, and need holding to run.

## Your own apps (`apps.json`)

The **Open apps** list already shows common apps that are installed (Discord, Spotify, Chrome, and more). To add one that is missing, use its name **exactly as the Start menu shows it**:

```json
{
  "VS Code": "Visual Studio Code",
  "Notepad": "Notepad"
}
```

## Games Steam does not list (`games.json`)

Installed Steam games are found automatically, in every Steam library folder. For a non-Steam shortcut or a game Steam does not list, add its Steam app id:

```json
{ "My Emulator": 123456789 }
```

## Other PCs (`pcs.json`)

PCs you can **Start** (Wake-on-LAN) and **Open** from the page. Easiest to add with the command shown by *Wake-on-LAN-Setup*; by hand it looks like:

```json
{
  "Desk PC": { "mac": "AA:BB:CC:DD:EE:FF", "page": "http://100.101.102.103:8791" }
}
```

`mac` (to start it) and `page` (to open its own remote page) are both optional, but you need at least one. `broadcast` (like `"192.168.1.255"`) is optional and only needed if starting does not work. See [START-FROM-OFF.md](START-FROM-OFF.md).

## Two laptops, one button each (the switch bar)

If you own two PCs that both run this, the page can show a bar at the bottom with one button per PC. Tapping the other one opens **its own** page (each PC keeps its own pairing and PIN). On each PC, list the other one in `pcs.json` with its page address (its Tailscale address, port 8791):

```json
{ "TUF": { "page": "http://100.101.102.103:8791" } }
```

Do the same on the other PC, listing the first. The page then shows a **swipe card** above Steam: swipe it sideways (or tap a name) and the page slides to the other PC while the colours change into that PC's look. With **no** other PCs listed, the card never appears, so a single-PC setup stays clean.

Optional, in each entry: `"order": 1` (lower is further left; ties go by name) and `"theme": "tactical"` (the look to change into). Put `"order"` in this PC's own `config.json` too.

## The Settings page

The **gear** at the top right of the page opens a separate Settings page. Every control saves at once: start with Windows, open Steam Big Picture at startup (and how long to wait), set a power mode at startup, the name and starting theme of the PC, its place in the swipe card, change or remove the PIN, how long a typed PIN stays valid, and whether your home Wi-Fi may connect (that one applies after a restart). The startup things happen **once per boot**, not every time the remote restarts. The same settings live in `config.json` below, if you prefer to edit the file.

## Temperature limiter

**What it does.** While it is on, the limiter reads the temperatures every three seconds. Over your limit it lowers the speed one step at a time, and when the temperature is clearly (3 degrees) under the limit for a few readings it raises it one step. Under the limit nothing is restricted.

- **CPU:** Windows power settings. Step 1 turns *boost* off, then the *maximum processor state* goes down in steps (95, 90, 85, 80, 70, 60, 50 percent). Your original values are saved and put back when it steps up, when you switch it off, when the limiter stops, and at the next start after a crash.
- **Graphics card (NVIDIA only):** the graphics clock is locked a little lower (`nvidia-smi -lgc`) and released again (`-rgc`). An AMD or Intel graphics chip, like the one in a handheld, is not limited separately (the CPU limit covers it).
- **If it cannot read a temperature, or anything goes wrong, it frees everything** instead of leaving a limit behind.

**Honest limits.** Windows has no single dependable CPU temperature. The limiter tries, in order: LibreHardwareMonitor (a free monitor, if it is running: the most exact), Windows thermal zones, then the ACPI thermal zone. Press **Check temperature sensors** on the Settings page, compare with Armoury Crate or another monitor, and see which one matches. A software limit also reacts *after* the temperature passed the limit, so it can go a few degrees over for a moment. A low limit (70 on the CPU of a gaming laptop) will lower the speed often.

**Needs administrator rights, once.** Changing the graphics clock needs them, so the limiter runs as its own scheduled task with administrator rights, from a folder only administrators can change (`C:\ProgramData\RemortStartPc`). It only reads numbers from your settings and runs fixed commands. Install.cmd (run as administrator) sets it up; it stays idle until you switch it on.

## Settings (`config.json`)

The program reads it when it starts, so sign out of Windows and back in (or restart the PC) after changing it.

```json
{
  "port": 8791,
  "allow": ["loopback", "tailscale"],
  "accent": "",
  "name": "",
  "pinHours": 12
}
```

| Setting | Meaning |
|---|---|
| `port` | The port of the phone page. Change it only if something else uses 8791. Run **Install.cmd** again afterwards so the firewall rule follows. |
| `allow` | Who may connect: `loopback` (this PC), `tailscale` (your phone through Tailscale), `lan` (anything on your home network). Never the open internet. Add `"lan"` only on a network you trust, because on a normal Wi-Fi the traffic is not encrypted. |
| `accent` | Page colour: `blue`, `pink`, `amber`, `green`, `purple`, `red`. Empty means automatic: pink for "ROG" PCs, amber for "TUF" PCs, otherwise blue. |
| `name` | The big name on the page. Empty means the PC's own name. |
| `theme` | The look this PC starts with: `neon`, `tactical` or `clean`. Empty means automatic: neon for "ROG" PCs, tactical for "TUF" PCs, otherwise clean. Each phone can pick another one in the **Theme** card on the page. |
| `limiterOn`, `cpuLimit`, `gpuLimit` | The temperature limiter and its limits in degrees (50 to 100). |
| `steamAtStart`, `steamDelay` | `true` opens Steam Big Picture once per boot, `steamDelay` seconds (0 to 300) after the program starts. |
| `startMode` | `saver`, `balanced` or `gaming`: the Windows power mode to set once per boot. Empty leaves it alone. |
| `order` | Place in the swipe card when you own several PCs (0 to 99, lower is further left). |
| `pinHours` | How many hours a typed PIN stays valid on a phone (1 to 720, default 12). |
