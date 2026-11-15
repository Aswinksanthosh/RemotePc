# Troubleshooting

**First, always: double-click Fix-It** (Start menu, *RemortStartPc*). It checks every part and tells you what to do in plain words. Most problems are fixed by running **Install.cmd** again, which is safe to repeat and keeps your phones and settings.

## The phone says "Cannot reach the PC"

1. Is the PC **on and signed in** to Windows? A PC that is asleep or off cannot answer. (Starting it: [START-FROM-OFF.md](START-FROM-OFF.md).)
2. Is **Tailscale on, on the phone**? Open the Tailscale app: it should say Connected.
3. Is Tailscale on the **PC** connected (tray icon), and are both signed in to the **same account**?
4. Fix-It on the PC. If it says "Remote running: nothing answers", run **Install.cmd** again.

## The QR code page says "Pair this phone again"

The phone was forgotten, or you opened an old link. Double-click **Pair-Phone** on the PC and scan the new code.

## The installer stopped at Tailscale

Install Tailscale by hand from tailscale.com/download, sign in, then run **Install.cmd** again.

## Windows says "Windows protected your PC" (SmartScreen) when I double-click Install.cmd

The file came from the internet and is not signed. Click **More info**, then **Run anyway**. You can read every file first: it is all plain text in this repository.

## The installer says Node.js could not be installed

Install the **LTS** version from nodejs.org yourself, then run the installer again.

## It stopped working after a Windows restart or sign-in

It starts when **you sign in** (not before). Sign in to Windows once; the page works from then on. Make Windows sign in by itself if you want a hands-free restart (a Windows setting, and a trade-off for security: only on a PC nobody else can touch).

## Steam buttons are empty, or a game is missing

Steam must be installed and signed in on the PC. The game list is found from Steam's own files, so a game appears once it is installed (give it a minute). Games Steam does not list can be added in `games.json` ([CUSTOMIZE.md](CUSTOMIZE.md)).

## "Close game" says it could not close something

Some games and their anti-cheat protect themselves. Close those inside the game.

## A button does nothing on the PC

Look at the message that shows at the top of the page: it says what went wrong in plain words. For more detail, the last lines of `C:\Users\<you>\.remortstartpc\remote.log` help (Fix-It prints them when the program is not running).

## The home-screen icon opens a "pair" page

Some phones forget the key when the icon was added from a page without it. Open the pairing link from the QR code again, then add the icon again from that page.

## I want to start over

Double-click **Uninstall**, then **Install.cmd** again.

## Still stuck

Open an issue on the repository and attach `install.log` and `remote.log` from `C:\Users\<you>\.remortstartpc` (they never contain your pairing link or key).
