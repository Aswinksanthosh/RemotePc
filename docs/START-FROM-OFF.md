# Starting the PC from your phone

The phone page can do everything **while the PC is on**. Starting a PC that is **off or asleep** is a different problem, and it is worth understanding before you spend any money.

## The honest part

- A PC that is **off** runs no software, so nothing on the PC can answer your phone.
- A PC that is **asleep** usually cuts its network connection too. On many laptops the phone page and Tailscale stop answering within minutes of sleep. Test yours: put it to sleep, wait two minutes, open the page on the phone.
- So "start" always needs **something else that is awake** to send the signal (or a trick that works without any software). Below are the realistic ways, easiest first.

Pick the first one that fits you.

## Option 1: do not turn it off (easiest, free, always works)

Use **Lock** and **Screen off** on the page instead of Sleep or Turn off. The PC stays reachable and uses little power with the screen off.

To make that comfortable:

1. **Settings > System > Power & battery > Screen and sleep**: set "When plugged in, put my device to sleep after" to **Never** (and the screen to a short time, so it turns itself off).
2. Laptop: **Control Panel > Power Options > Choose what closing the lid does**: set "When I close the lid" (plugged in) to **Do nothing**.

## Option 2: Wake-on-LAN with a small always-on helper

Wake-on-LAN sends a special "magic packet" over your **home network**. It only travels inside the home network (Tailscale does not carry it), so something **at home** has to send it: a second PC that stays on, a Raspberry Pi, or a router that supports it. Your phone talks to that helper (through Tailscale), and the helper wakes the PC.

**What the PC needs**

- It must be connected by a **network cable (Ethernet)**. Almost no PC wakes from Wi-Fi when it is off.
- A BIOS/UEFI setting turned on. This is the part nobody can do for you, see step 2 below.
- Some PCs, especially thin laptops, cannot wake from *off* at all (only from sleep), or not at all. A free test is at the end.

**Step by step**

1. **On the PC you want to start**: double-click **Wake-on-LAN-Setup** (it is in the Start menu under *RemortStartPc*). It turns on the Windows part (the network card's wake setting, and it turns off *Fast startup*, which blocks waking after a normal shut down). It prints the PC's **MAC address** and the exact command for step 4.
2. **In the BIOS/UEFI** of that PC (press F2 or Del while it starts): look for an option named like *Wake on LAN*, *Power on by PCI-E*, *Wake on PCIe* or *Resume by LAN* and turn it on. Names differ per maker. Also look for "ErP" or "Deep sleep" options and turn them **off** (they cut the power the network card needs).
3. **Pick the helper.** Any of these, as long as it stays on and is in the same home network:
   - **Another Windows PC**: run **Install.cmd** on it (the same installer) and pair your phone with it.
   - **A Raspberry Pi** (a small one is plenty): see the Raspberry Pi recipe below.
4. **Tell the helper about the PC.** On the helper, run the command that Wake-on-LAN-Setup printed. It looks like this:

   ```
   node "%USERPROFILE%\.remortstartpc\app\bin\add-pc.mjs" "DESKTOP-1234" AA:BB:CC:DD:EE:FF http://100.101.102.103:8791
   ```

   (Name, the MAC address, and the PC's own remote page address. The last part is optional: it only adds an **Open** button next to **Start**.)
5. **On the phone**, open the **helper's** page, then **Other PCs**, then **Start** next to your PC. Give it up to a minute, then tap **Open**. (The first time, your phone has to be paired with that PC too: run **Pair-Phone** on it and scan its code. Each PC has its own pairing.)

**Free test before you build anything.** Turn the PC off. From your phone, on the **same Wi-Fi as the PC**, use any free "Wake on LAN" app from the app store with the MAC address. If that wakes the PC, steps 1 to 5 will work. If it does not, the PC or its BIOS cannot do it, and no software can fix that: use Option 1 or 4.

### Raspberry Pi helper recipe

On a Raspberry Pi with Raspberry Pi OS, in a terminal:

```bash
# 1. Tailscale (sign in with the same account as your phone and PC)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. Node.js 20 or newer. Try:
sudo apt install -y nodejs npm git
node --version      # must say v20 or higher. If not, install a newer one from nodejs.org

# 3. This program
git clone https://github.com/Aswinksanthosh/RemotePc.git
cd RemotePc

# 4. Tell it about your PC, then pair your phone (a QR code appears in the terminal)
node bin/add-pc.mjs "My PC" AA:BB:CC:DD:EE:FF http://100.101.102.103:8791
node bin/pair.mjs

# 5. Start it, and make it start by itself at every boot
node bin/remote.mjs        # try it first (Ctrl+C to stop)
```

To start it at every boot, copy `scripts/remortstartpc.service` to `/etc/systemd/system/`, change the user name and folder inside, and run `sudo systemctl enable --now remortstartpc`.

On a Pi the page shows only the **Other PCs** section (it has nothing of its own to control). If your phone is on the home Wi-Fi without Tailscale, add `"lan"` to `allow` in `~/.remortstartpc/config.json`.

## Option 3: your router

Some routers have Wake-on-LAN built in (look in the router's settings or app for "Wake on LAN" or "Wake devices"), and a few can do it from outside the house. If yours does, it replaces the helper. This is the same magic packet, so the PC still needs steps 1 and 2 above.

## Option 4: a smart plug (the plug is the power button)

Works for **desktop PCs** that have a BIOS option like **"Restore on AC power loss"**, **"After power failure: Power on"** or **"AC back"**. Set it to **Power on**. Then:

- Turn the PC off with **Turn off** on the phone page.
- Switch the smart plug off and on again from the plug's own app. The PC sees the power come back and starts.

Cheap Wi-Fi smart plugs cost roughly US$10 to US$25 (look for one that is rated for the PC's power and works with an app on your phone).

**Laptops** rarely work this way: the battery keeps them powered, so the plug changes nothing. A few have a BIOS option such as "Power on with AC attach" or "AC behavior: Wake on AC", which makes it work. Check your BIOS first, before you buy anything.

## Option 5: a finger robot

A small battery device that presses the power button for you (several brands sell a Wi-Fi/Bluetooth "button pusher" that you stick next to the button). It works for any PC where you can reach the button, and you control it from its own phone app. We have not tested one with this project.

## Which one for me?

| Your PC | Best choice |
|---|---|
| Any, and you do not mind leaving it on | **Option 1** |
| Desktop, or laptop with an Ethernet cable and a second always-on device at home | **Option 2** |
| Desktop with "restore on AC power" in the BIOS | **Option 4** (cheapest, no helper) |
| Laptop on Wi-Fi only | **Option 1** (or Option 5) |
