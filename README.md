# RemotePc

**Control your Windows PC from your phone.** Lock it, put the screen off, restart it, open Steam and start a game, change the volume, open apps, and more. One tap to install, one QR code to pair. No account with us, no cloud, no subscription.

<p>
<img src="docs/img/phone-home.png" alt="The phone page: power menu, Lock, Screen off, Steam with game picker" width="260">
<img src="docs/img/phone-more.png" alt="The phone page: media keys, open apps, your own buttons" width="260">
</p>

## What you need

A **Windows 10 or 11 PC** (signed in as an administrator), an **iPhone or Android phone**, and a **Google account**. About 10 minutes.

## Install

**On the phone**

1. Install the **Tailscale** app (App Store or Google Play).
2. Open it, tap **Sign in with Google**, allow the **VPN** question, and check it says **Connected**.

**On the PC**

3. Open **File Explorer**, open a folder (for example **Downloads**), click the **address bar**, type `powershell` and press **Enter**.
4. Paste this and press **Enter** (right-click pastes):

   ```powershell
   irm https://raw.githubusercontent.com/Aswinksanthosh/RemotePc/main/install.ps1 | iex
   ```

5. Click **Yes** when Windows asks. Wait a few minutes while it installs.
6. A browser page opens for **Tailscale**: sign in with the **same Google account** as on the phone. No page? Open the link the installer prints (it starts with `https://login.tailscale.com`).
7. When the installer asks, **choose a PIN** (4 to 8 digits, typed twice; `0000` and `1234` are refused). A **QR code** appears: leave it there.

**On the phone again**

8. Scan the QR code with the **Camera** app, tap the link, type your **PIN**. Your PC's name appears with a green dot.
9. Add it to the home screen: **iPhone** (Safari) Share, then **Add to Home Screen**. **Android** menu (three dots), then **Add to Home screen**.

**On the PC:** press **Enter** in the installer window. Done.

> The QR link is a key to your PC. Never share it or a screenshot of it. Lost a phone? Run **Pair-Phone** on the PC for a new code, and forget the old phone on the page (Paired phones).

## What the buttons do

| Button | What it does |
|---|---|
| Power icon (tap, or hold and slide) | Lock, Screen off, Sleep, Restart, Turn off, Cancel turn off |
| Lock / Screen off | Locks the PC / turns the screen off (move the mouse to bring it back) |
| Steam | Open Steam, Big Picture, pick one of your installed games and start it, close the running game, switch Steam account |
| Media | Previous, play/pause, next, volume up/down, mute |
| Headphones | Connect or disconnect a paired Bluetooth device (earbuds) on this PC, so it is free for your phone or another PC |
| Audio output | Choose where the sound plays (speakers, headphones, monitor) |
| Open apps | Discord, Spotify, Epic, Chrome, and more, if they are installed. You can add your own |
| My buttons | Your own buttons that run a command you wrote (optional, see [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md)) |
| System | PC status (battery, graphics card, uptime) and one-tap **Update** and **Restart remote** |

Risky buttons (Turn off, Restart, Close game, ...) must be **held** for a moment, or ask "are you sure?". Nothing you type on the phone is ever run as a command: the phone can only press buttons that exist.

## Starting the PC when it is turned off

Be honest with yourself about this one: **a PC that is completely off cannot answer anything**, so no app on the PC can turn it on. Your options, from easiest to hardest, are in **[docs/START-FROM-OFF.md](docs/START-FROM-OFF.md)**. The short version:

1. **Do not turn it off.** Use **Lock** and **Screen off** instead of Sleep or Turn off. Easiest, and it just works.
2. **Wake-on-LAN** with a small always-on helper (a second PC, or a Raspberry Pi). Needs the PC on a **network cable**. Run **Wake-on-LAN-Setup** on the PC, the guide does the rest.
3. A **smart plug** with the BIOS option "power on after power loss" (desktops mostly).

## Share it with a friend

Send them this repository link and this message:

> Open the link and follow "Install". It takes about 10 minutes. You need a Windows PC, your phone, and a Google account. First install the Tailscale app on your phone and sign in with Google, then run the installer on the PC.

Everyone installs on their own PC and pairs their own phone. Nothing is shared between you.

## Everyday things

| I want to... | Do this |
|---|---|
| Change or remove my PIN | Double-click **Set-PIN** (also in the Start menu) |
| Pair another phone | Double-click **Pair-Phone** (also in the Start menu), scan the new code |
| Update to the newest version | Press **Update** on the phone page (System), or double-click **Update** |
| Something does not work | Double-click **Fix-It**. It checks everything and tells you what to do |
| Remove it | Double-click **Uninstall** |
| Add my own buttons, apps or games | [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md) |
| Change the colour or the name on the page | [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md) |

The **Pair-Phone**, **Fix-It**, **Update** and **Uninstall** shortcuts are in the Start menu under *RemortStartPc* after the install.

## Is it safe?

- **Nothing is opened to the internet.** Your phone talks to your PC through Tailscale (encrypted, private to your own devices). The program refuses every connection that does not come from your own devices.
- **A key and a PIN.** Each phone holds a long random key (in the link of the QR code) and must also type your PIN. The PC stores only a fingerprint of the key and a salted hash of the PIN. Five wrong PINs lock that device out for five minutes. You can forget any phone at any time.
- **Fixed buttons only.** The phone can only ask for the actions in a fixed list. It cannot run commands, read files or type on the PC.
- **No accounts, no tracking.** Your phone and PC talk directly. The only thing that goes out is the update check (to GitHub) when you press Update.

Details, and what it does *not* protect against: **[docs/SECURITY.md](docs/SECURITY.md)**.

## When something goes wrong

Double-click **Fix-It** first. The most common problems:

- **"Cannot reach the PC"** on the phone: the PC is asleep or off, or Tailscale is off on the phone.
- **The QR code opens a page that says "pair again"**: the phone was forgotten, or you scanned an old code. Run **Pair-Phone**.
- **Installer stops at Tailscale**: install it by hand from tailscale.com/download, sign in, run the installer again (it is safe to repeat).

More in **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

## For the curious

How it works, the files, how to run the tests: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md). There are no dependencies to install: it is plain Node.js. The tests run with `node --test`.

## Credits and licence

MIT licence, see [LICENSE](LICENSE). Parts of the remote were first written for the Jarvis project (MIT, by Aditya Dewaskar). The QR code generator is by Kazuhiko Arase (MIT), see [THIRD-PARTY.md](THIRD-PARTY.md). "QR Code" is a registered trademark of DENSO WAVE INCORPORATED. Steam is a trademark of Valve; this project is not affiliated with Valve, Tailscale or Microsoft.
