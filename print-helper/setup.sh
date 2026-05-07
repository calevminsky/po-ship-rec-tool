#!/bin/bash
set -e

USERNAME=$(whoami)
HELPER_PATH="/Users/$USERNAME/Documents/bin-label-printer/server.js"
PLIST_PATH="$HOME/Library/LaunchAgents/com.yakira.bin-label-printer.plist"

echo "Setting up bin label print helper for user: $USERNAME"

# Download helper script
mkdir -p ~/Documents/bin-label-printer
curl -fsSo "$HELPER_PATH" https://raw.githubusercontent.com/calevminsky/po-ship-rec-tool/main/print-helper/server.js
echo "Downloaded server.js"

# Write plist with correct path (using node to avoid requiring Xcode/python)
node -e "
const fs = require('fs');
const plist = [
  '<?xml version=\"1.0\" encoding=\"UTF-8\"?>',
  '<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">',
  '<plist version=\"1.0\">',
  '<dict>',
  '  <key>Label</key>',
  '  <string>com.yakira.bin-label-printer</string>',
  '  <key>ProgramArguments</key>',
  '  <array>',
  '    <string>/usr/local/bin/node</string>',
  '    <string>$HELPER_PATH</string>',
  '  </array>',
  '  <key>RunAtLoad</key>',
  '  <true/>',
  '  <key>KeepAlive</key>',
  '  <true/>',
  '  <key>StandardOutPath</key>',
  '  <string>/tmp/bin-label-printer.log</string>',
  '  <key>StandardErrorPath</key>',
  '  <string>/tmp/bin-label-printer.log</string>',
  '</dict>',
  '</plist>'
].join('\n');
fs.writeFileSync('$PLIST_PATH', plist);
console.log('Wrote plist');
"

# Unload if already running, then load
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "Service loaded"

# Verify
sleep 1
if curl -s http://localhost:9631/ >/dev/null 2>&1; then
  echo ""
  echo "All done! Print helper is running."
else
  echo ""
  echo "Something may have gone wrong. Check: cat /tmp/bin-label-printer.log"
fi
