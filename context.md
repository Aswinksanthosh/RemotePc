# Context: RemotePc (the repository was renamed from RemortStartPc on 2026-11-17; inside the program the old name stays: the `.remortstartpc` data folder, the `RemortStartPc` scheduled task and firewall rule, Start-menu folder, package name)

Read this first in any new session. Update it with every change or idea (owner's rule). **This repository is meant to be public and shared with friends: never put personal data in it** (names, real Tailscale addresses, e-mail, keys, user folders). `test/repo.test.mjs` checks for the obvious cases. Personal setup notes belong in the owner's private notes repository, not here.

## What this is

A shareable version of the owner's phone remote for a Windows PC. Goal: **the easiest possible install for friends** (one tap, or the next easiest way), then control the PC from a phone: lock, sleep, restart, turn off, screen off, media keys, Steam (games found automatically, start/close, account switch), open apps, own buttons, update. No AI, no accounts, no cloud, no dependencies (plain Node.js).

Started 2026-11-15 as a fresh repository (clean history on purpose) from the remote part of the owner's Jarvis project (MIT). The Jarvis-specific parts, the AI, the passwords, the per-laptop drawn characters, picture uploads and the power-mode/GPU-cap code were left out.

## Design decisions (and why)

- **One-tap install**: `Install.cmd` or the one-line `irm ... | iex` -> `install.ps1` (asks for administrator rights once, installs Node.js via winget with a checksum-verified download as fallback) -> `bin/setup.mjs` (all the real logic, in Node, so it is testable): copy program to `~/.remortstartpc/app`, install and sign in to Tailscale, settings, firewall rule, scheduled task + hidden launcher, Start-menu shortcuts, start, pair.
- **Pairing by QR, no password.** A phone holds a 192-bit key in the link (`/?k=KEY`); the PC keeps only a SHA-256 fingerprint (`phones.json`). The key stays in the address on purpose: the home-screen shortcut (iOS and Android) then keeps it, and nothing depends on browser storage or password managers (which gave trouble on iPhone). The manifest is served per key so a standalone Android/Chrome shortcut starts at `/?k=KEY` too. Trade-off documented in `docs/SECURITY.md`.
- **Network**: Tailscale (encrypted, works anywhere, stable `100.x` address). The server accepts only `loopback`, `tailscale` and optionally `lan`, and a firewall rule matches. Without Tailscale the installer falls back to allowing `lan`.
- **Hidden launcher** (`start.ps1`, run by a scheduled task at sign-in, works in Xbox full-screen mode) restarts the program: exit 75 = start again now (after an update), exit 0 = stop (another copy runs), else wait 5 s. Updates need no process killing.
- **Updates** download the GitHub zip (own tiny unzip, no tar/git needed) and swap the `app` folder; user files live outside it. Repository comes from `package.json` `repository`.
- **Games are found automatically** from Steam's `appmanifest_*.acf` in every library folder; pictures from Steam's own cache; `games.json` adds extras.
- **Start from off** is honest in the docs: nothing on a powered-off PC can answer. Options in `docs/START-FROM-OFF.md` (keep it on, Wake-on-LAN via an always-on helper, router, smart plug, finger robot). The same program runs on a Raspberry Pi as a helper (`bin/remote.mjs` on non-Windows serves only the Other PCs section).
- **Page rules** (tested in `test/page.test.mjs`): plain files, no inline script/style, no outside address, text only via `textContent`.

## Status (v0.1.0)

Verified here (Linux): 128 tests (115 run on Linux, 15 PowerShell tests only run on Windows), phone page in a real browser against the demo server (`bin/demo.mjs`): pairing screens, hold-to-confirm, slide menu, dropdowns, confirm box, offline banner, strict policy with no violations; QR codes decoded with OpenCV (SVG and console versions).

**Not verified on real Windows yet (do this first):**
- `install.ps1` and the whole `Install.cmd` flow on a clean PC (winget, the Node.js fallback, UAC re-launch, the `irm | iex` route)
- Tailscale CLI flow (`tailscale up` printing the sign-in link, `status --json`, `set --unattended`) and the winget/direct-download install
- Scheduled task creation (copied from the proven Jarvis script), the firewall rule (`netsh ... remoteip=LocalSubnet,100.64.0.0/10`), Start-menu shortcuts
- The PowerShell snippets (media keys, screen off, sleep, close game, Start-menu app list): they parse-check on the CI Windows machine (`.github/workflows/tests.yml`), but only some ran for real in the Jarvis project
- Home-screen shortcut keeping the key on iPhone (Safari) and Android (Chrome, Brave)
- Wake-on-LAN setup script and the helper flow
- The CI itself has not run yet (first push)

## Added 2026-11-17
Ported from the owner's Jarvis remote: **Headphones** (connect/disconnect a paired Bluetooth device, Windows `BluetoothSetServiceState`), **Audio output** (default playback device, undocumented `IPolicyConfig`), **Restart remote** (exit code 75, the launcher restarts it). The PowerShell/C# parts are only parse-checked in CI and have never run on a real PC in this repo (in Jarvis the first real press is also still the test). The owner wants to send this repo to a friend: needs the repo made public first.

The README holds the whole install step by step (2026-11-17; `docs/TUTORIAL.md` is only a pointer to it), written from the code (what the installer does and in which order), not from screenshots of a real run; fix it after the first real install.

PIN (2026-11-17, owner request): the installer asks for a PIN (4 to 8 digits, typed twice, weak ones like 0000/1234 refused, no default); phones type it after pairing, session 12 h (`pinHours`); `Set-PIN.cmd` changes or removes it; stored as a salted scrypt hash in `pin.json`. Never hard-code a default PIN.

UI redesign (2026-11-17, owner request): organised cards with line icons (Quick actions, Steam, Media, **Bluetooth devices**, **Sound output**, **Power mode**, Apps, My buttons, System with Other PCs / Paired phones). **Switch bar** at the bottom appears only when `pcs.json` lists other PCs that have a `page` (owner has two laptops; friends with one PC never see it). Power mode actions (`mode_saver|balanced|gaming`, powercfg overlay) ported from Jarvis. `scripts/make-preview.mjs` builds a single HTML file with pretend data to look at the page without a PC. Still to port from Jarvis: Steam Big Picture at startup, temperature limiter (needs sensor check on the devices first), ROG/TUF drawn look.

Themes + swipe (2026-11-17, owner request): three looks (neon pink/rounded/glow, tactical amber/chamfered/uppercase, clean blue), picked per PC per phone (localStorage `rsp_theme:<pc>`), default by config `theme` or model name (ROG neon, TUF tactical). The old bottom bar became a **swipe card above Steam** (pointer swipe or arrows or tapping a name): the page slides away while colours animate (`@property` colour variables, crossfaded background layers), the other PC's page opens with `#from=left|right&t=<theme>` and slides in. Order by config/pcs.json `order`. Real navigation between two PCs is a normal page load (each PC has its own origin, key and PIN); `window.__navigate` is a hook only the preview uses.

Settings page (2026-11-17, owner request): `/settings` (`src/web/settings.html|js`, shared helpers in `common.js`), opened by the gear on the main page. Autosaving controls: start with Windows (schtasks enable/disable), Steam Big Picture at startup + wait, power mode at startup, name, starting theme, order, PIN change/remove (current PIN checked), PIN hours, allow home Wi-Fi (needs restart). Backend: `src/settings.mjs` (whitelist `EDITABLE` + `applySettingsPatch` in `config.mjs`, running config updated live), `src/startup.mjs` (once per boot, `startup.json`). The Jarvis-version Steam-at-startup (`JARVIS_STEAM_AT_START`) is separate. Not yet done in RemotePc: temperature limiter (needs the sensor check first).

Page order (2026-11-17, owner request: he mostly uses games and audio, rarely power): swipe card, Steam, Sound output, Bluetooth devices, Media, Power mode, Apps, My buttons, Theme, **Phones** (who is connected now, last seen), System, **Power** (lock, screen off, sleep, restart, turn off) last. Phones "connected" = talked to this PC in the last 2 minutes (`auth.list()`, `lastSeen` also saved to phones.json at most every 10 min). Installer PIN prompt now says that pressing Enter with nothing typed means NO PIN, and warns.

## To do / ideas

- Run through the checklist above on a real Windows PC and a clean user; fix what breaks. Put real findings in this file.
- Make the repository **public** to share (Settings > General > Danger Zone > Change visibility). The one-line installer and the Update button need a public repo. Check first: tests pass, no personal data, README repository name is right.
- Optional: HTTPS through `tailscale serve` (then the key never travels as plain HTTP even on lan).
- Optional: "Start" button on a phone page that has no helper: only possible with Wake-on-LAN helper or hardware (see docs).
- Optional: a Linux/macOS helper installer script (today: manual recipe in `docs/START-FROM-OFF.md`).
- Optional: show the QR code inside the installer window for the smallest case when no browser opens.

## How to work on it

```
node --test            # all tests
node bin/demo.mjs      # a pretend PC on port 8799; open the address it prints
```

Rules: one logical change per commit; run the tests before pushing; keep PowerShell scripts short (heavy logic in Node, where it is tested); keep `.cmd` files ASCII with CRLF (`.gitattributes` has `*.cmd -text`; a test checks it); never edit `src/vendor/qrcode.mjs`.
