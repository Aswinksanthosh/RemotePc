# Security: what it protects, and what it does not

This program lets a phone control a PC, so it is worth knowing exactly how it is protected.

## What is protected, and how

**Who can connect.** The program only answers connections from your own devices: the PC itself, your phone through **Tailscale** (an encrypted private network that only your own devices join), and, only if you turn it on, your home network. Every other address, including the whole internet, is refused by the program **and** by a Windows Firewall rule the installer adds. Nothing is opened to the internet and nothing is forwarded on your router.

**Who is let in.** Two things: a key and a PIN. Each paired phone holds a **192-bit random key** (inside the link of its QR code). The PC keeps only a fingerprint (SHA-256) of each key, compares in constant time, and locks a device out for five minutes after eight wrong tries. **Forget** a phone (page, Paired phones) and its key stops working at once. The **PIN** (4 to 8 digits, chosen in the installer, weak ones like 0000 refused) is stored only as a salted scrypt hash. Typing it gives that one phone a session token for 12 hours (`pinHours` in `config.json`); the token stops working when the PIN is changed, and five wrong PINs lock a device out for five minutes. A key is sent in a request header, never in a cookie, so other websites cannot make your browser send it.

**What a phone can do.** Only the actions in a fixed list (lock, sleep, restart, turn off, media keys, Steam, open an app, ...). The phone sends a *name* (a game, an app, a button) and the program looks it up in **its own lists**: Steam's installed games, the Start-menu apps, and your `buttons.json`. Nothing typed on the phone is ever run as a command. The one place commands run is `buttons.json`, which you write by hand on the PC, and the phone cannot change it.

**The page itself.** It is served with a strict content policy: its own script and style only, no inline code, no outside connections, no frames. Text that comes from the PC (game names, your Steam name, button names) is always put on the page as plain text, never as HTML. The page and its pictures are never fetched from the internet.

**What it runs as.** Your normal Windows user, not an administrator. The installer asks for administrator rights **once**, to install Tailscale, add the firewall rule and create the start-at-sign-in task. Nothing keeps those rights.

**The Settings page on the PC.** It opens without a phone key, but only for requests from this PC itself (loopback), only for the settings calls, and only when the request carries our own header and a local Host and Origin, so a web page you visit cannot use it. If you set a PIN it still asks for it. The buttons that control the PC never work without a paired phone.

## What you should know

- **The link in the QR code is the key.** It is shown on the PC screen, or on a paired phone's Settings page when you add another phone (and never written to the install log). It also ends up in the address of the page on your phone, so it is in that browser's history and on your home-screen icon. Do not share screenshots of the address bar or the QR code. If a phone is lost, forget it from another phone or run **Pair-Phone** and use the page's *Paired phones* list.
- **Prefer Tailscale.** Over Tailscale the traffic is encrypted end to end. On the plain home network (`lan`) the page is plain HTTP, so anyone on that same Wi-Fi could see the key as it passes. Use `lan` only at home, on a network you control.
- **Protect your Tailscale account** with two-step sign-in: anyone who can sign in to it can join your private network (they still need a paired key to do anything).
- **Updating runs code from GitHub.** The **Update App** button downloads the newest version of this project from the repository named in `package.json` and runs it. You are trusting the owner of that repository. If you want to review changes first, fork the project, change `repository` in `package.json`, and update from your fork.
- **A phone can turn the PC off** (after a hold or a confirmation) and **cannot turn it back on** (see [START-FROM-OFF.md](START-FROM-OFF.md)).

## What it does not protect against

- Malware already running on your PC, or someone sitting at your unlocked PC. They can read `buttons.json` and the list of phone fingerprints (never the keys themselves), and change settings.
- Someone holding your unlocked phone with the page open or the home-screen icon. Lock your phone.
- A stolen Tailscale account **plus** a stolen key.

## Reporting a problem

If you find a security problem, please use GitHub's **private vulnerability reporting** (the repository's *Security* tab) rather than a public issue. Everything else: a normal issue is fine.
