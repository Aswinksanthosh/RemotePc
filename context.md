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

- README install is now 3 colour-coded steps using GitHub alert boxes (blue NOTE = Tailscale, green TIP = install, purple IMPORTANT = scan + save to home, orange WARNING = key). GitHub cannot colour plain text, only these boxes.

## STANDING RULE (owner, 2026-11-18): keep the GitHub README in step with every feature change
- Every time a feature, button, setting or install step changes: update README.md (description AND the three phone screenshots) in the same commit. Regenerate screenshots: `node scripts/make-preview.mjs /tmp/pv`, serve /tmp/pv with `python3 -m http.server`, Playwright at 390x844 deviceScaleFactor 2 -> docs/img/phone-home.png, phone-more.png (open the .acc-h drop-downs, scroll ~1100), phone-settings.png (settings preview). Also update docs/ pages that mention the changed thing.

- After Update App (or a restart), the phone page waits 5 s, then polls /health every 2 s and reloads itself when the program is back (gives up after 90 s). README screenshots regenerated from a fresh preview build.

- Installer "All done" screen prints the program folder (paths.app), the data folder (paths.home) and where the shortcuts are.

- Step 2B screenshot removed from README (owner); the two drawn step pictures were deleted from docs/img.

- REMOVED the Setup.exe (Inno Setup file and release workflow): owner decided the PowerShell command is enough. README install is short: 3 callout boxes only. (If a v0.1.0 release/tag exists on GitHub, the owner can delete it there.)

- README step 2: no address-bar/folder trick any more: install.ps1 uses only %TEMP% and never the current folder (checked), so "Windows key, type powershell, Enter, paste" is enough.

## Security rule CHANGED (owner, 2026-11-18)
- Phones MAY now add and remove apps (Settings > My apps) picking from the laptop Start-menu list (/api/settings/startapps, /apps open to any paired phone). The earlier "PC only" rule and the yellow warning were removed. Drop-a-shortcut box still PC only. Update/Fix-It/Uninstall buttons remain PC only.

- My apps card: the typed name/Start-menu fields and "Add app" button were removed (owner); apps are added only by picking from the laptop list (or dropping a shortcut on the PC).

## TEMPERATURE LIMITER REMOVED (owner, 2026-11-18)
- Owner: "Remove temp limit from everything". Real cause it never worked: Windows only gave a chassis sensor (_TZ.TZ00 27.9 C, not the CPU) and the GPU (50 C) was under the 70 limit; a true CPU temperature needs a helper such as LibreHardwareMonitor, which the owner declined.
- Deleted: src/limiter.mjs, its test, settings card + sensors route, config keys (limiterOn/cpuLimit/gpuLimit), doctor check, installer limiter install, ROG Ally 90 default, README/CUSTOMIZE/SECURITY text, preview data.
- Kept ONLY clean-up: `removeOldLimiter` (setup.mjs) runs at install and Uninstall: restores the CPU/GPU settings with the old ProgramData limiter.mjs --restore, removes the "RemortStartPc Limiter" task and the ProgramData folder. Old config.json keys are ignored. Everything above in this file about the limiter is history.

## Games start in Performance mode; Update App in the top bar (owner, 2026-11-18)
- steam_game calls setMode("gaming") first (failure ignored), message says "in Performance mode". Not switched back afterwards.
- "Update App" is an icon button (download arrow) in the top bar of the main page AND the Settings page (hold/confirm); the System tile was removed. reloadWhenBack() now lives in common.js. On the PC Settings page the button opens the Update window (tool route); on a phone it updates and reloads.

- README trimmed (owner): removed "What the buttons do", "Starting the PC when it is turned off", "Share it with a friend", "Everyday things"; "Settings on the PC itself" became "Add your applications" (use the Desktop Settings shortcut > My apps). docs/START-FROM-OFF.md still exists but is no longer linked from the README.

## PC switching REMOVED (owner, 2026-11-19: "it is glitching")
- Deleted: the swipe card between laptops, the #from/&t hand-over, skeleton, boot.js, pager CSS, the "Place in the swipe bar" setting. Each laptop is now its own page / own home-screen shortcut (owner makes 3 shortcuts: ROG, TUF, Ally).
- Kept: the "Other PCs" drop-down with Start (Wake-on-LAN) only for PCs that have a mac in pcs.json (no Open button). config `order` and pcs.json order/theme are still parsed but unused. Older notes above about the swipe card are history.

## Phones may add phones; Uninstall removes the PIN (owner, 2026-11-19)
- /api/local/pair now works for the PC page AND any paired phone (Bearer key); the Settings "Add a phone" card shows on every Settings page. Anyone holding a paired phone can pair another one: forget lost phones at once.
- bin/uninstall.mjs always deletes pin.json so a reinstall never brings an old PIN back (even if the rest of the data folder is kept).

## Theme-coloured home-screen icons (owner, 2026-11-19)
- The icon (icon.svg, icon-192/512.png, apple-touch-icon.png) is served per request in the colour of THIS PC theme: pink (neon), amber (tactical), blue (clean). Theme = config.theme, else accent (pink/purple->neon, amber/red->tactical), else name/hostname (ROG->neon, TUF->tactical, else clean). Files: src/web/icons/<name>-<theme>.png (generated with Pillow: gradient tinted square + power glyph), SVG built in server.mjs. An existing home-screen shortcut keeps its old icon: remove it and Add to Home Screen again. To make the Ally a different colour set its theme in Settings.

- iOS Safari kept showing a BLUE icon after "Add to Home Screen" (probably a cached picture for the same address): the icon addresses now carry the theme (/apple-touch-icon-neon.png, /icon-neon.svg, manifest icon-192-neon.png) and the pages fill {{ICON}} per PC theme, so a new colour is always a new address. Old /icon-192.png etc. still work. If a phone still shows blue: remove the shortcut, reload the page, add again (iPhone: Settings > Safari > Clear History and Website Data once).

- Home-screen shortcut name = this PC name (config.name, else the computer name; letters/digits only, max 30): page <title>, apple-mobile-web-app-title and the manifest name/short_name use shortcutName() (server.mjs, {{NAME}} in index.html). Existing shortcuts keep their old name: remove and add again.

## Bluetooth shows the real connection state (owner, 2026-11-19)
- BT_LIST now returns "name<TAB>True|False" (Get-PnpDeviceProperty DEVPKEY_Device_IsConnected {83DA6326-97A6-4088-9453-A1923F573B29} 15; any entry of the device true = connected). actions.info() has headphones (names) + btConnected (names). Cache 5 s. bt_connect/bt_disconnect poll up to ~8 s and answer "X is connected." only when Windows really shows it, else "not connected yet" (honest). Page: green "Connected" / grey "Not connected" per device, the matching button is highlighted, title "(1 connected of 2)". Untested on real hardware: the IsConnected property can read False for some devices; if so send the output of the Get-PnpDeviceProperty line.

## ASUS (Armoury Crate) power modes replace the Windows ones on ASUS laptops (owner, 2026-11-19)
- Researched G-Helper (app/AsusACPI.cs): open \\.\ATKACPI (CreateFile RW, share 3, OPEN_EXISTING), DeviceIoControl code 0x0022240C, buffer = method uint32 (DEVS 0x53564544 set / DSTS 0x53545344 get) + arg length uint32 + args (device id 0x00120075 uint32, value uint32), output 16 bytes; set ok when result==1; get = int32 - 65536; values 0 = Performance(balanced), 1 = Turbo, 2 = Silent. G-Helper does not need an elevation check in that file (device ACL unknown).
- actions.mjs: asusScript(probe|get|set), asusSupported (cached 10 min), mode buttons keep the actions mode_saver/balanced/gaming: Windows overlay is set FIRST, then the ASUS value (saver=Silent 2, balanced=Performance 0, gaming=Turbo 1). Page labels Silent/Performance/Turbo when info.asus is true (else Efficiency/Balanced/Performance). Info mode comes from the laptop (get), file as fallback. Starting a game = Windows best performance + ASUS Performance (0), not Turbo. A refusal is reported ("did not switch"), Windows mode stays.
- NOT VERIFIED ON REAL HARDWARE (ROG/TUF/Ally). On the Ally the wattage (SPL/sPPT/fPPT, ids 0x001200A0/A3/C1) is separate in G-Helper, so the mode may change fans/profile but not exactly the TDP. Settings "Power mode at startup" still shows the Windows names.

- Fix-It (doctor.mjs) now has an "ASUS performance mode" line on ASUS PCs: probe (can ATKACPI be opened) + get (current mode). Use it to diagnose "button did nothing" (owner: pressed it on the Ally, nothing changed).

## Diagnostics from the phone (owner, 2026-11-19)
- System card: "Diagnostics" tile -> POST /api/diagnostics (paired phone + PIN) -> runDoctor lines (same as Fix-It incl. the ASUS check and the log tail); shown in a box under System with Copy report / Close report. app.mjs passes `diagnostics` to startServer.

- FIRST REAL REPORT (Ally, 2026-11-19): ATKACPI opens fine from the normal remote (no admin needed), but reading 0x00120075 returned 3 while Armoury Crate was on Performance (owner had switched Turbo -> Performance). G-Helper constants: FullSpeed=3, Manual=4, so the Ally likely uses another numbering/another device id. Need: run Diagnostics with Armoury Crate in Silent / Performance / Turbo and compare the value. The set (0/1/2) did nothing visible on the Ally. Fix-It now prints the raw value.

- Copy report button: navigator.clipboard is blocked on plain http (Tailscale 100.x), so common.js copyText() falls back to a hidden textarea + document.execCommand("copy").

- DECISION after 3 identical reports (Ally always answered mode value 3): the ASUS buttons are offered ONLY when probe=yes AND get returns 0, 1 or 2; otherwise (e.g. the Ally) the page keeps the Windows modes (Efficiency/Balanced/Performance) and never writes to ATKACPI. Ally support would need its own numbers/device ids (G-Helper Ally code), not researched yet. ROG/TUF untested.

- CORRECTION (2026-11-20): both "mode value 3" reports came from the LAPTOPS (the ROG with Node 25 and the TUF with Node 22; their addresses are in the private vault, not here), NOT the Ally; the Ally (address in the vault) was never tested. Rule changed: ASUS buttons are offered when the device opens and the mode is 0..4 (3 = full speed, 4 = manual per G-Helper), so a laptop in mode 3/4 can be switched out of it. Pending: owner to test Silent/Performance/Turbo on ROG and TUF and the Ally.

## Volume slider (owner, 2026-11-20)
- Media card: Vol-/Mute/Vol+ keys replaced by a real slider (0-100, shows the level) + a mute switch (speaker icon). actions volume_set (int 0-100) and mute_set (on/off) use Windows Core Audio (IAudioEndpointVolume via volumeScript, default speaker); info.volume {level, muted} (cached 3 s). Sent while dragging at most every 200 ms and on release; moving the slider above 0 unmutes. A PC that cannot report a level (info.volume null) keeps the three keys. Untested on real Windows (CI parses the script).

- BUG FIXED (owner screenshot "The volume is a whole number from 0 to 100"): server /api/do only passes STRING args (typeof body.arg === "string"); the slider sent a number, so the PC saw undefined. The slider now sends String(value) and volume_set accepts /^\d{1,3}$/ text. Remember: every action argument must be a string.

## POWER MODE SWITCHING REMOVED (owner, 2026-11-20: "Dont use any modes switching here")
- Removed everything: the Power mode card (Silent/Performance/Turbo and the Windows modes), actions mode_saver/balanced/gaming, the ASUS ATKACPI code, the Fix-It ASUS line, the "Power mode at startup" setting + config startMode + startup step, the "games start in Performance" switch, power-mode.txt. Reason: the ASUS write never changed the firmware mode on the owner laptops (value stayed 3) and the owner chose to drop it. Older notes above about modes are history. Old config.json startMode is ignored.

- RESTORED (owner, 2026-11-20): ONLY the plain Windows power mode card (Efficiency / Balanced / Performance, actions mode_*, power-mode.txt highlight). NOT restored: any ASUS/Armoury code, the Fix-It ASUS line, the startup mode setting, or the game-start boost.

## Buy me a coffee button (owner, 2026-11-20, copied from the French notes)
- Same yellow button as French-Notes (index.html .coffee-btn) in the footer of the phone page and the Settings page, and a Support line in the README. The link lives in package.json "funding.url" (a public Stripe payment link, already public in the French repo); app.mjs passes it as coffeeUrl; server.mjs safeCoffeeUrl only lets https://buy.stripe.com | ko-fi.com | www.buymeacoffee.com through; the page gets it as `coffee` in /api/state and /api/settings. To change it: edit funding.url.

- Diagnostics/Fix-It now has a "Bluetooth devices" line (count, connected count, seconds the check took, names) because the TUF page showed "No paired Bluetooth devices found" and an empty list can mean none paired OR the 15 s PowerShell check failed/timed out. Pending: owner to send that line from the TUF.

- Bluetooth list fix (TUF showed none while Windows had realme Buds Air 3S and SRS-XB100 paired): device nodes now matched as ^(BTHENUM|BTHLE)\\DEV_ (classic and LE), and if the detailed check returns nothing a names-only fallback (BT_NAMES) fills the list (connection state then unknown = Not connected). Fix-It "Bluetooth devices" line still shows what Windows listed.

## SPEED / EFFICIENCY PASS (owner, 2026-11-20: "ROG website takes too much time to load, check everything")
Findings (read from the code, NOT measured on the ROG): actions.info() asked Windows for model, Steam, volume, Bluetooth, outputs and apps ONE AFTER ANOTHER (each PowerShell 0.3 to 3 s; the volume read compiles C# with Add-Type), Bluetooth cached 5 s and volume 3 s so every 15 s poll re-ran them; no sharing of in-flight runs (two phones = double work); /api/state probed every pcs.json "other PC" (up to 1.5 s each when off) although only wake-able ones are shown; page files were re-sent in full on every load; the slider could start many Add-Type runs.
Changes: (1) `swr()` helper in actions.mjs (shared in-flight run, stale answer returned at once + background refresh, fresh()/set()/stale()) used for volume (10 s), Bluetooth (30 s), sound outputs (30 s), Start-menu apps (5 min); `memo()` now also shares in-flight runs. (2) info() runs everything in parallel, each part fail-safe (one failing part = empty, not a blank page). (3) volume_set merges a fast drag into at most one running command (last level wins). (4) server: others are probed only if they have a mac, answer kept 20 s; static files + pages get an ETag (304 when unchanged) and gzip; "[remote] slow page data: N s" is logged when /api/state takes > 2.5 s. (5) page: saves the last state in localStorage (`rsp_last`, only when no PIN session, max 6 h old), paints it at once with an "Updating…" banner, then replaces it (offerUpdate is skipped while showing saved state). (6) Diagnostics: new "Page speed" line = fresh timing of PowerShell start / volume / Bluetooth / outputs / Start-menu apps (warns above 4 s). (7) lint pass (ESLint run from /tmp, nothing added to the repo): no undefined names or real bugs, removed 3 unused imports/variables.
Tests: swr sharing/parallel/stale, timings, volume coalescing, gzip+ETag+304, probe skipping, fail-safe info; browser check: with a laptop that needs 3 s the first visit waits 3.3 s, later visits paint in ~24 ms. Pending: owner to send the "Page speed" line from the ROG to see which part is slow in real life.

## Windows list (owner, 2026-11-21: "add a windows button so I can change the windows, close them")
- Page: "Windows" drop-down (loaded only when opened, Refresh, Show desktop; per window Switch and Close with a confirm box). Server: POST /api/windows -> actions.windows(); actions window_focus / window_close (arg = window id) and desktop_toggle. Script windowsScript (EnumWindows via Add-Type; visible, titled, not tool or cloaked windows; max 40). Focus = restore if minimised + an Alt tap + SetForegroundWindow; close = PostMessage WM_CLOSE (never a force kill). A window can only be touched if it was in the list shown in the last 5 minutes (ids validated against that list). Closing the window that runs the remote stops the remote (warned in the confirm box). Untested on real Windows (CI parses the script). Preview: leftover "Two laptops / One PC" bar and __navigate removed from make-preview.mjs.
- NEXT (waiting for the owner): "Now playing" card (title/artist, prev/play/next, progress, cover) via Windows SMTC; owner has not answered the questions yet.

- (2026-11-21, owner: "the add application button from the settings to the home screen") Apps card on the home page now ALWAYS shows (even with no apps) and has "Add or remove apps": search the PC apps (/api/settings/startapps), Add (/api/settings/apps op add), list of added apps with Remove (confirm). Settings page My apps card is kept (it also has the PC-only drop-a-shortcut box). Bug fixed in the same pass: winBox/appMgrBox were drawn only if connected, so a page redraw emptied the open Windows list (now drawn always).

## Layout change (owner, 2026-11-21: "move the media controls to the top, condense it, sound output a drop box")
- The big Media card is gone. A compact PINNED player bar (`playerBar(pc)`, .player, position: sticky) is the first card under the header: previous, play/pause, next, mute and the volume slider +  0n ONE row (a PC without volume info shows three small keys). Order now: player bar, Steam, Sound output (drop-down via acc("sound"), title shows the chosen output), Bluetooth devices (drop-down), Power mode, Windows, Apps, My buttons, Theme, Phones, System, Power. NEXT: the Now playing card (title/artist/progress/cover via Windows SMTC) can go INTO this bar; still waiting for the owner "go".

## Screen and sleep timers (owner, 2026-11-21: "sleep timer and screen timer always in the power mode section")
- Power mode card now also has two drop-downs: "Screen off after" (1,2,3,5,10,15,20,30,60 min, Never) and "Sleep after" (5,10,15,20,30,45,60,120 min, Never). They are the Windows idle timers: read with powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE and SUB_SLEEP STANDBYIDLE (last two hex numbers = AC and DC seconds, language independent), set with powercfg /change monitor-timeout-ac|dc and standby-timeout-ac|dc (both plugged in and battery). action timer_set arg "screen:10" or "sleep:0"; info.timers {screen, sleep} (minutes, AC value) and info.timerChoices; cached 30 s (swr) and updated at once after a change. Interpreted as the Windows idle timers, NOT a countdown ("sleep in 30 min from now"): ask the owner if a countdown is wanted. Also fixed: an open drop-down was hidden behind the cards below it (.card:has(.dd.open) z-index). Untested on real Windows.

## Favourites (owner, 2026-11-22: "favourite button for the Bluetooth devices and sound output ... shows up at the top without pressing the dropdown")
- Star button on every Bluetooth device and every sound output (starBtn). Starred ones appear in a "Favourites" card (favoritesStrip) right under the pinned player bar: a Bluetooth chip connects (or disconnects when connected), an output chip switches the sound ("play here" / "playing here"). Saved on the PC in favorites.json {bt:[],out:[]} (max 8 each) so every phone sees the same ones: action favorite_set arg "bt|1|Name" or "out|0|Name" (only names in the current lists can be starred), info.favorites; knownFavorites() in actions.mjs. A favourite that is not in the current list (an output that appears only while the earbuds are connected) is simply hidden until it is. Untested on real Windows.

## Battery (owner, 2026-11-22: "battery percentage for the laptops and earbuds if possible")
- Laptop: info.battery {percent, onBattery} (Win32_Battery via the BATTERY script, swr 30 s; null on a PC with no battery); shown under the name in the header ("Battery 78% · plugged in"). Earbuds: BT_LIST has a 3rd column, the Windows property DEVPKEY_Bluetooth_Battery {104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2, asked ONLY for connected devices; info.btBattery {name: percent}; shown in the Bluetooth list ("Connected · battery 85%") and on the Favourites chip. Many earbuds do not report a level to Windows: then nothing is shown (not a bug). BUG FIXED on the way: an empty battery answer was read as 0% (a PC without a battery said "Battery 0%"), in the page data and in the Status button. Untested on real hardware.

- PUBG missing from the game drop-down on the TUF (2026-11-22): the scanner lists every appmanifest_*.acf in every library of libraryfolders.vdf (no installed-state filter), so a missing game means its library folder is not in that file or not readable; cause not yet known. Fix-It/Diagnostics now has a "Steam libraries" line (folder + game count, "folder not found" when unreadable). Workaround for any game Steam files do not show: games.json {"PUBG: BATTLEGROUNDS": 578080} in ~/.remortstartpc.
