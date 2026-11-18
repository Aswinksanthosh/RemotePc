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

Footer (2026-11-17, owner request): copyright line like the French repo, in MIT wording ("© 2026 Aswin K Santhosh. Open source under the MIT licence..."; the French repo says "All rights reserved", which would contradict this repo's MIT licence: ask if he wants it changed) and a drop-down **Ideas, feedback or a bug?** (idea / feedback / bug) that opens a prefilled GitHub new-issue form (`?labels=&title=&body=`, version and page only, never the key or PIN). The issues address comes from the server (`issuesUrl` from package.json `repository`), so the page script holds no web address. Issue templates in `.github/ISSUE_TEMPLATE/`. LICENSE now names Aswin K Santhosh (and the Jarvis author for the parts first written there).

Swipe card motion (2026-11-17, owner request): ONLY the swipe card moves. It follows the finger (rubber band toward a side with no PC), past 60 px or a quick flick (25 px in under 250 ms) it flies out (.18 s) while the colours change; the next PC's page opens with the card flying in (.28 s) and the rest of the page only fades slightly. A short slow drag snaps back. A drag never counts as a tap on a name. Tested in a real browser with mouse pointer events (preview).

Tutorial pictures + Desktop shortcut (2026-11-17, owner request): README steps 3 and 4 have two DRAWN illustrations (`docs/img/step-1-address-bar.png`, `step-2-powershell.png`, made from HTML mock-ups, labelled as drawings; replace with real screenshots from a Windows PC when available). The installer puts a **Remote Start PC** shortcut to the data folder (`~\.remortstartpc`: settings, buttons.json, logs) on the Desktop (`desktopShortcutScript`); Uninstall removes it. Never run on real Windows yet (CI parses the script).

Smooth switching (2026-11-17, owner saw reload/stutter in the demo): the page is now a persistent shell (`ensureShell`: header, swipe card, footer kept as the same DOM nodes; only `.content` cards are swapped, fade out 110 ms, colours change while invisible, fade in 180 ms). No colour-variable transitions any more (they repainted everything each frame). For a real jump to the other PC's address (different origin = full page load) the address carries `#from=&t=<theme>&i=<index>&l=<[name,theme,order]...>`: `boot.js` sets the look before the first paint and `showSkeleton` paints the name, swipe card (in place) and grey blocks at once; real data then replaces the blocks. `html` has the dark background so there is no white flash. A true single-page switch (no load at all) would need one PC to proxy the other (like the Jarvis hub) and is not done.

Limiter + local Settings + custom apps (2026-11-18, owner requests): (1) `src/limiter.mjs` ONE self-contained file (core + loop), copied by the installer to `%ProgramData%\RemortStartPc` (ACL: Administrators/SYSTEM full, Users read; well-known SIDs) and run by an elevated task `RemortStartPc Limiter` (`limiter-start.ps1`); reads `limiterOn/cpuLimit/gpuLimit` from config.json (numbers only), CPU via powercfg (boost off then PROCTHROTTLEMAX steps, originals saved in `limiter-original.json`, restored on step 0/off/exit/next start), NVIDIA GPU via `nvidia-smi -lgc/-rgc`, status in `limiter-status.json`; ANY error or missing temperature frees everything. CPU temperature source is the weak point: LibreHardwareMonitor WMI, then Windows thermal zones, then ACPI; **the owner never ran the sensor diagnostic**, so it is untested on his hardware; the Settings page has "Check temperature sensors". Defaults: 70 (laptops), 90 (ROG Ally, detected at install). Run Install.cmd again to add it to an existing install. (2) The Settings page works ON the PC with no phone key (`isLocalPage`: loopback + header `x-rsp-local` + local Host/Origin, only `/api/settings*`, `/api/unlock`, `/api/local/*`; PIN still asked); `Settings.cmd` opens it; "Add a phone" (QR) only there. (3) "My apps": add/remove in Settings (`apps.json`). Port note: RemotePc and the Jarvis remote both default to port 8791: set `"port": 8792` in RemotePc's config.json (and rerun Install.cmd) if both run on one laptop.

Decisions (2026-11-18, owner answers): the long-term plan is **RemotePc only** on his two laptops (ROG order 2 = right, TUF order 1 = left in the swipe card), the Jarvis remote gets retired after testing; the temperature limiter works **all the time** (not only while a game runs); the friend uses Android and iPhone (test both), the friend's PC may have an Nvidia card, and a handheld/AMD-only PC (only the CPU limit applies). Next: the owner migrates the laptops (steps given in chat), then sends the **Check temperature sensors** output so the CPU source can be chosen.

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

## Installer text (colour coded)
- Installer and Fix-It text is colour coded (green = good, cyan = info, yellow = attention, red = danger/problem). Colours only on a real console; install.log stays plain. The PIN question has three points: phone asks every time, 4 to 8 digits, NO PIN if Enter is pressed.

## Setup.exe
- installer/RemotePc.iss (Inno Setup) wraps install.ps1 into RemotePc-Setup.exe; workflow .github/workflows/release.yml builds it on Windows (push a tag like v0.2.0 -> attached to the Release; or run by hand). Unsigned, so SmartScreen warns (More info > Run anyway). README step 3 = the .exe, PowerShell one-liner = backup. To release: git tag v0.2.0 && git push origin v0.2.0.

## Settings page tools
- Settings page (on the PC only, not from a phone) About card has Update, Fix-It, Uninstall buttons: POST /api/settings/tool {tool: update|fixit|uninstall}, fixed whitelist in settings.mjs TOOLS, opens the .cmd in its own window.

## App picker (PC Settings page only)
- My apps card on the PC: search the Start menu list (GET-like POST /api/settings/startapps, local only) and Add, or drop a shortcut on the dashed box (browser only gives the file NAME, matched to the Start menu list; no match -> pick from the list). Games are NOT listed here: all games only via the Steam drop-down (owner decision).

## Desktop Settings shortcut + icon
- assets/remotepc.ico (generated, power-ring glyph). Install makes Desktop shortcut "RemotePc Settings" (opens Settings.cmd minimised, with the icon) next to the "Remote Start PC" folder shortcut; Start-menu shortcuts use the icon too; Uninstall removes both. Existing installs: run Install.cmd/installer again to get it.

- Settings button icon on the page is now a real cog (it looked like a brightness sun before). Owner feedback.

- Phone page has ONE tile "Update App" (updates + restarts; the separate Restart tile was removed). PC Settings About card: "Update App" and "Restart" (needed after some settings). Desktop/Start-menu icon is now a cog.

## Security rule (owner): phones can NOT add or remove apps
- /api/settings/apps add/remove and /startapps need the PC-local Settings page (403 for a phone key); a phone may only list. Phone Settings shows a warning: apps can only be added on the PC. Page: Bluetooth devices and Apps are now drop-downs (acc).

- Owner decision: the installer no longer asks for a PIN (no PIN by default; Set-PIN / Settings add one later; RSP_PIN env still works). README updated.

- Owner decision: built-in Open apps list (APP_CANDIDATES) is Spotify only. Everything else is added on the PC (Settings > My apps).

- Owner decision: every crucial action asks first. Confirm box (confirmBox) for Start game, Open Steam, Big Picture, each app (NOT Bluetooth: owner said no); hold-to-confirm for power/close game/update/my buttons. Lock, Screen off, media, volume, theme stay one tap.

- Sleep, Restart and Turn off now ask with the same confirm box everywhere (top power menu and the Power card), not hold-to-confirm.

## Update prompt after every restart
- app.mjs checks GitHub (latestSha vs installed.json sha) 30 s and 5 min after each program start; actions.info() returns update {available, boot}; the page (offerUpdate) asks once per run per phone: "A new version is ready. Update now?" Yes, update / Cancel (confirm box). Skipped on developer copies without installed.json.
