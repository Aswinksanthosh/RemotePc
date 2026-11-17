# RemotePc

**Control your Windows PC from your phone.** Lock it, put the screen off, restart it, open Steam and start a game, change the volume, open apps, and more. One tap to install, one QR code to pair. No account with us, no cloud, no subscription.

<p>
<img src="docs/img/phone-home.png" alt="The phone page: power menu, Lock, Screen off, Steam with game picker" width="260">
<img src="docs/img/phone-more.png" alt="The phone page: media keys, open apps, your own buttons" width="260">
</p>

## What you need

- A **Windows 10 or 11 PC** (a laptop or a desktop), and you signed in with an account that is an **administrator** (the normal case on your own PC)
- An **iPhone or Android phone**
- A **Google account** (Gmail) to sign in to Tailscale. Microsoft or Apple also work
- About **5 minutes**

The installer takes care of everything else (it installs Node.js and Tailscale for you, both free).

## Install: the whole process, step by step

You do **not** need to know anything about Tailscale, Node.js or the command line: the installer takes care of the rest, **including installing Tailscale on the PC**. Plan about **10 minutes** the first time. The order is: **phone first** (Tailscale + Google sign-in), then the PC, then scan.

### Part 1: on the phone (Tailscale first)

#### Step 1. Install the Tailscale app

Open the **App Store** (iPhone) or **Google Play** (Android), search for **Tailscale**, and install it. It is free for personal use.

#### Step 2. Sign in with Google

1. Open the **Tailscale** app and tap **Get started** (or **Log in**).
2. Choose **Sign in with Google** and pick your Google account. That *is* your Tailscale account: there is no new password to invent. (No Google account? Microsoft, Apple and GitHub work too.)
3. Allow the **VPN** question your phone asks. This is how Tailscale works: a private network just for your own devices. Turn the switch **on**. It should say **Connected**.

**Remember which Google account you used.** The PC needs the **same one** in step 6.

### Part 2: on the PC

#### Step 3. Start the installer (pick one way)

**Way A, one line.** This is the fastest.

1. Press the **Windows key**, type `PowerShell`, press **Enter**. A blue (or black) window opens.
2. Copy this line, paste it into the window (right-click pastes in PowerShell), press **Enter**:

   ```powershell
   irm https://raw.githubusercontent.com/Aswinksanthosh/RemotePc/main/install.ps1 | iex
   ```

   What it does: `irm` downloads the installer script from this repository, and `iex` runs it. Nothing else is downloaded until the script has asked your permission (next step). You can open the address in a browser first and read the script, it is plain text.

**Way B, double-click.**

1. On the repository page, click the green **Code** button, then **Download ZIP**.
2. Open your Downloads folder, right-click the ZIP, choose **Extract All**, then **Extract**.
3. Open the extracted folder and double-click **`Install.cmd`**.
   If Windows says **"Windows protected your PC"**, click **More info**, then **Run anyway** (the file is not signed, it just came from the internet).

#### Step 4. Say Yes to the permission question

Windows shows a box asking whether the app may make changes to your device. Click **Yes**. The installer needs this once, to install the helper programs, allow your phone through the firewall, and set up the automatic start. A new window opens and shows the progress. Leave it open.

#### Step 5. Wait while it installs the helpers (about 2 to 5 minutes)

The window prints each step. It does these on its own:

| Step | What happens | If you already have it |
|---|---|---|
| **Node.js** | The small engine this program runs on is installed. | Skipped |
| **Putting the program in place** | The program is copied to a folder in your user folder (`.remortstartpc`). | Replaced by the newer copy |
| **Tailscale** | The private link between your phone and your PC is installed. | Skipped |
| **Settings, firewall, automatic start** | Windows is told to start the remote when you sign in, and to let only your own devices connect. | Updated |

#### Step 6. Sign in to Tailscale on the PC (the same Google account)

The installer installs Tailscale on the PC. Then a **web page opens in your browser** asking you to sign in:

1. Choose **Sign in with Google** and use the **same Google account as on your phone** (step 2). This is what puts your phone and your PC on the same private network.
2. If it asks to **connect** this device, click **Connect**.
3. Go back to the installer window. It notices on its own and continues.

If no browser page opens, the installer prints a link that starts with `https://login.tailscale.com/` in its window. Copy it into any browser.

#### Step 7. The QR code appears

When the steps are done, the installer opens a page with a big **QR code**, and also shows a smaller one in the installer window. **Leave it on the screen.** Do not close the installer window yet.

### Part 3: on the phone again

#### Step 8. Scan the QR code

1. Open the phone's normal **Camera** app and point it at the QR code on the PC screen.
2. A link appears at the top of the camera view. **Tap it.**
3. The browser opens the **Remote** page, showing your PC's name with a green dot and **online**. Your phone is now paired.

#### Step 9. Put it on the home screen

So you can open it with one tap, like an app:

- **iPhone** (use Safari): tap the **Share** button (square with an arrow), scroll down, tap **Add to Home Screen**, then **Add**.
- **Android** (Chrome or Brave): tap the **menu** (three dots), then **Add to Home screen** or **Install app**.

Use the icon from now on. It keeps working without scanning again.

#### Step 10. Finish on the PC

Back on the PC, in the installer window, press **Enter**. It removes the QR page (it contains your private key) and prints **All done**. You can close the window.

### Part 4: try it

On the phone page, try these (you cannot break anything with them):

1. **Lock**: the PC locks. Sign back in on the PC.
2. **Media: Vol +**: the volume goes up.
3. Open **Steam**, pick a game in the picture box, press **Start game**.
4. Open the **power icon** (top right): hold it and slide to an option, or just tap it.

Risky buttons (Turn off, Restart, Close game) ask you to **hold** the button for a moment, or ask "are you sure?". That is on purpose.

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
