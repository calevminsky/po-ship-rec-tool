# Bin Label Printer — Mac Setup Guide

This sets up your Mac to automatically print bin labels from the app directly to the Brother QL-810W with no print dialog.

---

## Requirements

- Mac with macOS
- Brother QL-810W connected via USB or WiFi
- Node.js installed

---

## Step 1 — Install Node.js

If you don't have Node.js installed:

1. Go to **https://nodejs.org**
2. Click the **LTS** download button
3. Open the downloaded file and follow the installer

To check if it's already installed, open Terminal and run:
```
node --version
```
If you see a version number, you're good.

---

## Step 2 — Add the Brother Printer

1. Connect the Brother QL-810W via USB or join the same WiFi network
2. Open **System Settings → Printers & Scanners**
3. Click **+** to add a printer and select the Brother QL-810W
4. Finish adding it

To confirm the printer name is correct, open Terminal and run:
```
lpstat -p
```
You should see `Brother_QL_810W` in the list. The name must match exactly.

---

## Step 3 — Download the Print Helper

Open Terminal and run this command (paste the whole thing at once):

```
mkdir -p ~/Documents/bin-label-printer && curl -o ~/Documents/bin-label-printer/server.js https://raw.githubusercontent.com/calevminsky/po-ship-rec-tool/main/print-helper/server.js
```

This creates a folder at `Documents/bin-label-printer` and downloads the helper file into it.

---

## Step 4 — Install as a Background Service

This makes the helper start automatically every time you log in.

**4a.** In Terminal, run this to find your username:
```
whoami
```
Note the result (e.g. `janesmith`).

**4b.** Paste this entire block into Terminal, replacing `YOURUSERNAME` with your actual username from above:

```
cat > ~/Library/LaunchAgents/com.yakira.bin-label-printer.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.yakira.bin-label-printer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOURUSERNAME/Documents/bin-label-printer/server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/bin-label-printer.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/bin-label-printer.log</string>
</dict>
</plist>
EOF
```

**4c.** Start the helper now (no reboot needed):
```
launchctl load ~/Library/LaunchAgents/com.yakira.bin-label-printer.plist
```

---

## Step 5 — Verify It's Working

Run:
```
curl -s http://localhost:9631/ ; echo " — helper is running"
```

You should see `— helper is running`. You're all set.

---

## Troubleshooting

**Nothing printed / wrong size**
```
cat /tmp/bin-label-printer.log
```
This shows any errors from the helper.

**Helper stopped running**
```
launchctl unload ~/Library/LaunchAgents/com.yakira.bin-label-printer.plist
launchctl load ~/Library/LaunchAgents/com.yakira.bin-label-printer.plist
```

**App says "Print helper not running — opened PDF in new tab"**
The helper isn't running. Run the verify command above. If it doesn't respond, run the restart commands above.

**Brother printer name doesn't match**
Run `lpstat -p` to see the exact name. If it's different from `Brother_QL_810W`, open `~/Documents/bin-label-printer/server.js` in TextEdit and change line 5 to match.
