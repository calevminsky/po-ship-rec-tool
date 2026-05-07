import http from 'http';
import { exec } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = 9631;
const PRINTER = 'Brother_QL_810W';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/print')) {
    const qty = Math.max(1, Math.min(50, parseInt(new URL(req.url, 'http://localhost').searchParams.get('qty')) || 1));
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const pdf = Buffer.concat(chunks);
      const tmpFile = join(tmpdir(), `bin-label-${Date.now()}.pdf`);
      try {
        writeFileSync(tmpFile, pdf);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Could not write temp file: ${e.message}` }));
        return;
      }
      exec(`lp -d ${PRINTER} -n ${qty} -o media=Custom.62x330mm -o fit-to-page "${tmpFile}"`, (err, _stdout, stderr) => {
        try { unlinkSync(tmpFile); } catch {}
        if (err) {
          console.error('Print error:', stderr || err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: stderr || err.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bin label print helper listening on http://localhost:${PORT}`);
});
