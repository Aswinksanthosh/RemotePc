# How it works

```
 phone ──Tailscale──▶  PC: node bin/remote.mjs  ──▶ PowerShell / Steam / Windows commands
   │                       │
   │ page + buttons        └── answers only: this PC, Tailscale, (optionally) your LAN
   └── pairing key (in the QR link)
```

- **Nothing to install except Node.js.** There are no npm dependencies. The QR generator is one vendored file ([THIRD-PARTY.md](../THIRD-PARTY.md)).
- **The program** (`bin/remote.mjs`) is a small HTTP server (`src/server.mjs`) that serves the phone page (`src/web/`) and a tiny API. Buttons call `src/actions.mjs`.
- **It starts hidden at every sign-in** through a Windows scheduled task that runs `start.ps1`. That launcher restarts the program after a crash, and immediately after an update (exit code 75).
- **Your data** lives in `%USERPROFILE%\.remortstartpc` (`src/paths.mjs`); updates replace only its `app` folder.

## Files

| Path | What |
|---|---|
| `Install.cmd`, `install.ps1` | The installer: asks for administrator rights once, installs Node.js if needed, then runs `bin/setup.mjs` |
| `bin/setup.mjs`, `src/setup.mjs`, `src/windows.mjs` | The install steps: copy files, Tailscale, settings, firewall, scheduled task, shortcuts, start, pair |
| `Pair-Phone.cmd`, `bin/pair.mjs` | Make a new QR code (a new phone key) |
| `Fix-It.cmd`, `bin/doctor.mjs`, `src/doctor.mjs` | Check everything and explain |
| `Update.cmd`, `bin/update.mjs`, `src/updater.mjs`, `src/unzip.mjs` | Download the newest version as a zip and swap it in |
| `Uninstall.cmd`, `bin/uninstall.mjs` | Remove it |
| `src/media.mjs` | Now playing (title, artist, cover, progress) read from Windows media controls, read only |
| `Bluetooth-Sound-Setup.cmd`, `bin/handsfree-setup.mjs`, `src/handsfree.mjs` | One-time admin setup of the "Clear sound" switch (two fixed Windows tasks that turn earbuds' Hands-Free mode off or on) |
| `Wake-on-LAN-Setup.cmd`, `bin/wake-setup.mjs`, `src/wol.mjs`, `src/wake.mjs` | Get a PC ready to be started, send the magic packet |
| `src/server.mjs`, `src/auth.mjs`, `src/net.mjs` | The server, the phone keys, which networks are allowed |
| `src/actions.mjs`, `src/steam.mjs` | The buttons and everything that reads Steam's files |
| `src/web/` | The phone page: plain HTML, CSS and JavaScript, no build step |
| `bin/demo.mjs` | A pretend PC to look at the page on any computer |
| `test/` | The tests |

## Running it without installing

```bash
node bin/demo.mjs     # a pretend PC; open the address it prints
node --test           # all the tests
```

The tests use pretend Windows commands, so they run on any system (the CI also runs them on Windows). The page rules (no inline code, no outside addresses, text only) are tests too.

## Making your own copy

Fork the repository, change `repository` in `package.json` (updates then come from your fork) and `$Repo` at the top of `install.ps1`, and replace the address in the README's one-line command.
