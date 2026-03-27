# BendGen

**Bend Program Generator for Langmuir BendControl**

Create bend programs on your computer, export a ZIP and restore onto your press brake via USB — or deploy directly over WiFi using the [Titan USB Bridge](https://github.com/shopEngineering/BendGen_USB_drive_PiZero).

---

## Download

Download the latest release for your platform:

| Platform | File |
|----------|------|
| Windows | [BendGen-Windows.zip](https://github.com/shopEngineering/BendGen/releases/latest) |
| macOS | [BendGen-macOS.zip](https://github.com/shopEngineering/BendGen/releases/latest) |
| Linux (x86_64) | [BendGen-Linux.zip](https://github.com/shopEngineering/BendGen/releases/latest) |
| Raspberry Pi OS | see below |

## Install & Run

### Windows / macOS / Linux

1. Download the ZIP for your platform from the link above
2. Unzip the file
3. Open the **BendGen** folder and double-click **BendGen** (macOS/Linux) or **BendGen.exe** (Windows)
4. Your browser will open to http://localhost:5050

No Python installation required. Everything is bundled in the download.

> **macOS note:** You may need to right-click > Open the first time to bypass Gatekeeper ("unidentified developer" warning).

### Raspberry Pi OS (run as a network server)

BendGen can run as a server on your Raspberry Pi so any computer on your network can access it from a browser — no install needed on the client side.

Run this one-liner on your Pi:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/shopEngineering/BendGen/main/install-pi.sh)
```

The installer will:
- Install Python dependencies via apt
- Download and install BendGen
- Optionally set it up as a background service that starts automatically on boot

Once running, open a browser on any device on the same network and go to:

```
http://<your-pi-ip>:5050
```

> **Tip:** Find your Pi's IP with `hostname -I` in the terminal.

## How to Use

### Via USB Drive (standard)

1. Create a program and add bends
2. Select tooling (die, punch, material) for each bend
3. Click **Export ZIP** to download the backup file
4. Copy the ZIP to a USB drive
5. On the press brake BendControl: **Backup** icon (upper right corner) > **Restore From** > select the ZIP on USB drive

> **Note on the restore screen:**
> - At the bottom it says FIRMWARE — this is not firmware, it will update your bend programs
> - When you hit Open, the file will appear as the name after the numbers in the filename, eg - the filename exported from BendGen will look something like B2603171502bendgen.zip but on the restor screen it will show bendgen in the list, hit **Restore** on that line item and the new bends will be added.  (DO NOT change the number letter combo of of the zip file name before "bendgen.zip".  you can change everything after B2603171502... of course your numbers for will be different, because it is a date:time format generated when the file is made on your computer.

### Via WiFi (Titan USB Bridge)

Skip the USB drive entirely — deploy programs directly from BendGen to the Titan over your shop WiFi network.

This requires a Raspberry Pi Zero W or Zero 2W permanently plugged into the Titan's USB port, running the [USB Drive Bridge](https://github.com/shopEngineering/BendGen_USB_drive_PiZero). The Pi acts as a virtual USB flash drive that BendGen can write to remotely.

1. Set up the Pi Zero with the USB Drive Bridge ([setup guide](https://github.com/shopEngineering/BendGen_USB_drive_PiZero))
2. In BendGen, click **Deploy to Titan** and enter the Pi's network address
3. BendGen sends the ZIP to the Pi, which writes it to the virtual USB drive
4. On the Titan: **Backup/Restore** > **Restore From** > select the file

You can also pull backups from the Titan using **Get Backup from Titan**.

See the **Help** page inside BendGen for detailed setup instructions with diagrams.

### Keeping Existing Bends

!!! SUPER IMPORTANT !!!
To preserve bends already on the machine: (See step 5 above, which is step 1 below ;)

1. On your press brake, Save a backup from BendControl to USB (if you don't do this first to put the list onto your computer, when you restore, the bend programs on your press brake will be deleted)
2. In BendGen, click **Import Backup** and upload that ZIP
3. Add your new programs/bends
4. Export and restore as usual

## Features

- **DXF Import** — upload flat-pattern DXF drawings to auto-detect bend lines and create programs
- **Backup Import/Export** — import existing BendControl backups and export new ones
- **Titan USB Bridge** — deploy programs directly over WiFi via a Pi Zero W
- **Custom Tooling** — add your own dies, punches, and materials with gauge-to-thickness tables
- **Unit Switching** — work in inches or millimeters, converts automatically
- **Check for Updates** — one-click update check against the latest GitHub release
- **Form & Table Views** — edit bends as cards or in a compact spreadsheet grid
- **Drag & Drop** — reorder bends by dragging

---

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.

**This is experimental software.** Use it entirely at your own risk. There are no guarantees of correctness, reliability, or suitability for any purpose. No support is provided. The user assumes all responsibility for verifying that generated bend programs are safe and accurate before use on any machine.
