#!/bin/bash
set -e

USERNAME=$(whoami)
HELPER_PATH="/Users/$USERNAME/Documents/bin-label-printer/server.js"
PLIST_PATH="$HOME/Library/LaunchAgents/com.yakira.bin-label-printer.plist"

# Find node binary
if [ -f /usr/local/bin/node ]; then
  NODE=/usr/local/bin/node
elif [ -f /opt/homebrew/bin/node ]; then
  NODE=/opt/homebrew/bin/node
else
  echo "Error: Node.js not found. Please install it from https://nodejs.org and try again."
  exit 1
fi

echo "Setting up bin label print helper for user: $USERNAME"

# Download helper script
mkdir -p ~/Documents/bin-label-printer
curl -fsSo "$HELPER_PATH" https://raw.githubusercontent.com/calevminsky/po-ship-rec-tool/main/print-helper/server.js
echo "Downloaded server.js"

# Write plist using only printf (no python/node needed)
{
  printf '<?xml version="1.0" encoding="UTF-8"?>\n'
  printf '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
  printf '<plist version="1.0">\n'
  printf '<dict>\n'
  printf '  <key>Label</key>\n'
  printf '  <string>com.yakira.bin-label-printer</string>\n'
  printf '  <key>ProgramArguments</key>\n'
  printf '  <array>\n'
  printf '    <string>%s</string>\n' "$NODE"
  printf '    <string>%s</string>\n' "$HELPER_PATH"
  printf '  </array>\n'
  printf '  <key>RunAtLoad</key>\n'
  printf '  <true/>\n'
  printf '  <key>KeepAlive</key>\n'
  printf '  <true/>\n'
  printf '  <key>StandardOutPath</key>\n'
  printf '  <string>/tmp/bin-label-printer.log</string>\n'
  printf '  <key>StandardErrorPath</key>\n'
  printf '  <string>/tmp/bin-label-printer.log</string>\n'
  printf '</dict>\n'
  printf '</plist>\n'
} > "$PLIST_PATH"
echo "Wrote plist"

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
