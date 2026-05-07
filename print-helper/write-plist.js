const fs = require('fs');
const home = process.env.HOME;
const username = require('os').userInfo().username;
const nodePath = fs.existsSync('/usr/local/bin/node') ? '/usr/local/bin/node' : '/opt/homebrew/bin/node';
const helperPath = home + '/Documents/bin-label-printer/server.js';
const plistPath = home + '/Library/LaunchAgents/com.yakira.bin-label-printer.plist';

fs.mkdirSync(home + '/Library/LaunchAgents', { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.yakira.bin-label-printer</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${helperPath}</string>
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
</plist>`;

fs.writeFileSync(plistPath, plist);
console.log('Plist written to', plistPath);
