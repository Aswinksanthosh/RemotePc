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
| `order` | Place in the swipe card when you own several PCs (0 to 99, lower is further left). |
| `pinHours` | How many hours a typed PIN stays valid on a phone (1 to 720, default 12). |
