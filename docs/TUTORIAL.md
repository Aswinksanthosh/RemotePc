# Tutorial: the whole installation, step by step

This walks through everything, in order, with what you will see. You do **not** need to know anything about Tailscale, Node.js or the command line: the installer takes care of all of it. Plan about **10 minutes** the first time.

**You need:** a Windows 10 or 11 PC that you are signed in to as an administrator (normal on your own PC), a phone, and an internet connection on both.

## Part 1. On the PC

### 1. Start the installer (pick one way)

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

### 2. Say Yes to the permission question

Windows shows a box asking whether the app may make changes to your device. Click **Yes**. The installer needs this once, to install the helper programs, allow your phone through the firewall, and set up the automatic start. A new window opens and shows the progress. Leave it open.

### 3. Wait while it installs the helpers (about 2 to 5 minutes)

The window prints each step. It does these on its own:

| Step | What happens | If you already have it |
|---|---|---|
| **Node.js** | The small engine this program runs on is installed. | Skipped |
| **Putting the program in place** | The program is copied to a folder in your user folder (`.remortstartpc`). | Replaced by the newer copy |
| **Tailscale** | The private link between your phone and your PC is installed. | Skipped |
| **Settings, firewall, automatic start** | Windows is told to start the remote when you sign in, and to let only your own devices connect. | Updated |

### 4. Sign in to Tailscale (the only account you create)

**You do not need to have Tailscale already.** The installer installs it. Then a **web page opens in your browser** asking you to sign in:

1. Choose **Google, Microsoft, Apple or GitHub** and sign in with an account you already have. That *is* the Tailscale account, there is no separate password to invent. It is free for personal use.
2. If it asks to **connect** this device, click **Connect**.
3. Go back to the installer window. It notices on its own and continues.

Remember which account you used: your **phone needs the same one**.

If no browser page opens, the installer prints a link that starts with `https://login.tailscale.com/` in its window. Copy it into any browser.

### 5. The QR code appears

When the steps are done, the installer opens a page with a big **QR code**, and also shows a smaller one in the installer window. **Leave it on the screen.** Do not close the installer window yet.

## Part 2. On the phone

### 6. Install Tailscale on the phone

1. Open the **App Store** (iPhone) or **Google Play** (Android), search for **Tailscale**, install it.
2. Open it and **sign in with the same account** you used on the PC (step 4).
3. Allow the **VPN** question your phone asks (this is how Tailscale works: a private network just for your own devices). Turn the switch **on**. It should say **Connected**.

### 7. Scan the QR code

1. Open the phone's normal **Camera** app and point it at the QR code on the PC screen.
2. A link appears at the top of the camera view. **Tap it.**
3. The browser opens the **Remote** page, showing your PC's name with a green dot and **online**. Your phone is now paired.

### 8. Put it on the home screen

So you can open it with one tap, like an app:

- **iPhone** (use Safari): tap the **Share** button (square with an arrow), scroll down, tap **Add to Home Screen**, then **Add**.
- **Android** (Chrome or Brave): tap the **menu** (three dots), then **Add to Home screen** or **Install app**.

Use the icon from now on. It keeps working without scanning again.

### 9. Finish on the PC

Back on the PC, in the installer window, press **Enter**. It removes the QR page (it contains your private key) and prints **All done**. You can close the window.

## Part 3. Try it

On the phone page, try these (you cannot break anything with them):

1. **Lock**: the PC locks. Sign back in on the PC.
2. **Media: Vol +**: the volume goes up.
3. Open **Steam**, pick a game in the picture box, press **Start game**.
4. Open the **power icon** (top right): hold it and slide to an option, or just tap it.

Risky buttons (Turn off, Restart, Close game) ask you to **hold** the button for a moment, or ask "are you sure?". That is on purpose.

## Part 4. Later

| I want to... | Do this |
|---|---|
| Add another phone | On the PC, search the Start menu for **Pair-Phone**, open it, scan the new code |
| Update | Phone page, **System**, **Update** |
| It does not work | On the PC, search the Start menu for **Fix-It**. It tells you what is wrong |
| Start the PC when it is off | Read [START-FROM-OFF.md](START-FROM-OFF.md) first: a turned-off PC cannot answer, so this needs extra help |
| Add my own buttons or apps | [CUSTOMIZE.md](CUSTOMIZE.md) |
| Remove everything | Start menu, **Uninstall** |

## If a step goes wrong

- **The installer stops at Tailscale.** Install it from tailscale.com/download, sign in, then run the installer again. Running it again is always safe.
- **The phone says "Cannot reach the PC".** Is the PC on and signed in? Is Tailscale **on** and **Connected** on the phone, and signed in to the same account as the PC?
- **The QR link says "Pair this phone again".** Scan a new code from **Pair-Phone** on the PC.
- More: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## What does it install, and is it safe?

It installs **Node.js** (from the official source, a standard programming tool), **Tailscale** (an established private-network app), and this program's own files in `C:\Users\<you>\.remortstartpc`. It adds a Windows Firewall rule and a task that starts it when you sign in. **Uninstall** removes the task, the rule and the shortcuts (and the folder if you say yes). Nothing is opened to the internet. Full details: [SECURITY.md](SECURITY.md).
