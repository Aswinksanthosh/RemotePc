# RemortStartPc

**Control your Windows PC from your phone.** Lock it, put the screen off, restart it, open Steam and start a game, change the volume, open apps, and more. One tap to install, one QR code to pair. No account with us, no cloud, no subscription.

<p>
<img src="docs/img/phone-home.png" alt="The phone page: power menu, Lock, Screen off, Steam with game picker" width="260">
<img src="docs/img/phone-more.png" alt="The phone page: media keys, open apps, your own buttons" width="260">
</p>

## What you need

- A **Windows 10 or 11 PC** (a laptop or a desktop), and you signed in with an account that is an **administrator** (the normal case on your own PC)
- An **iPhone or Android phone**
- About **5 minutes**

The installer takes care of everything else (it installs Node.js and Tailscale for you, both free).

## Install in 3 steps

### 1. On the PC: run the installer

Pick **one** way.

**Way A, one line (fastest).** Press the Windows key, type `PowerShell`, press Enter, paste this line and press Enter:

```powershell
irm https://raw.githubusercontent.com/Aswinksanthosh/RemortStartPc/main/install.ps1 | iex
```

**Way B, two clicks.** Click the green **Code** button above, choose **Download ZIP**, right-click the file, choose **Extract All**, open the folder and double-click **`Install.cmd`**.

Then:

1. Windows asks one question ("make changes to your device?"). Answer **Yes**.
2. A browser page opens for **Tailscale**. Sign in with Google, Microsoft or Apple. (Tailscale is the free private link between your phone and your PC. Use any account you like, you will use the same one on your phone.)
3. A big **QR code** appears on the screen. Leave it there.

### 2. On the phone: get Tailscale

Install **Tailscale** from the App Store or Google Play and sign in with the **same account** you used on the PC. Leave it turned on.

### 3. On the phone: scan the code

Open the **camera**, point it at the QR code on the PC, tap the link that appears. The page opens and your phone is paired. That is it.

**Put it on your home screen** so it opens like an app:

- iPhone (Safari): tap the Share button, then **Add to Home Screen**.
- Android (Chrome or Brave): tap the menu (three dots), then **Add to Home screen** or **Install app**.

> The link in the QR code is a private key for your PC. Do not post it or send it to anyone. Lost it, or lost a phone? Run **Pair-Phone** on the PC for a new one, and forget the old phone on the page (Paired phones).

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

> Open the link, follow "Install in 3 steps". Takes 5 minutes. You need a Windows PC, your phone, and a free Tailscale account (the installer sets it up).

Everyone installs on their own PC and pairs their own phone. Nothing is shared between you.

## Everyday things

| I want to... | Do this |
|---|---|
| Pair another phone | Double-click **Pair-Phone** (also in the Start menu), scan the new code |
| Update to the newest version | Press **Update** on the phone page (System), or double-click **Update** |
| Something does not work | Double-click **Fix-It**. It checks everything and tells you what to do |
| Remove it | Double-click **Uninstall** |
| Add my own buttons, apps or games | [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md) |
| Change the colour or the name on the page | [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md) |

The **Pair-Phone**, **Fix-It**, **Update** and **Uninstall** shortcuts are in the Start menu under *RemortStartPc* after the install.

## Is it safe?

- **Nothing is opened to the internet.** Your phone talks to your PC through Tailscale (encrypted, private to your own devices). The program refuses every connection that does not come from your own devices.
- **No password to type or leak.** Each phone holds a long random key (in the link of the QR code). The PC stores only a fingerprint of it, and you can forget any phone at any time.
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
