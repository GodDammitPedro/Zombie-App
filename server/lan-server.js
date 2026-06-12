/* Deadlight LAN server: serves the game over HTTP and relays game messages
   between everyone connected over WebSocket. Run on any computer on your
   Wi-Fi, then open http://<this-computer's-IP>:8080 on each phone.

     npm install
     npm start            (or: node server/lan-server.js [port])
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const PORT = parseInt(process.argv[2], 10) || 8080;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

// ---- lobby: one shared room per server, first player in is host ----
const wss = new WebSocket.Server({ server });
let nextId = 1;
const clients = new Map(); // id -> {ws, name}
let hostId = null;

function broadcast(obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const [id, c] of clients) {
    if (id !== exceptId && c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.t === 'hello') {
      const name = String(msg.name || 'Survivor').slice(0, 14);
      clients.set(id, { ws, name });
      if (hostId === null) hostId = id;
      ws.send(JSON.stringify({
        t: 'welcome', id, host: hostId === id,
        peers: [...clients].filter(([pid]) => pid !== id)
          .map(([pid, c]) => ({ id: pid, name: c.name }))
      }));
      broadcast({ t: 'peer-join', id, name }, id);
      console.log(`+ ${name} (#${id})${hostId === id ? ' [host]' : ''} — ${clients.size} connected`);
    } else if (msg.t === 'msg' && clients.has(id)) {
      broadcast({ t: 'msg', from: id, d: msg.d }, id);
    }
  });

  ws.on('close', () => {
    if (!clients.has(id)) return;
    const name = clients.get(id).name;
    clients.delete(id);
    broadcast({ t: 'peer-left', id });
    if (hostId === id) {
      hostId = clients.size ? clients.keys().next().value : null;
      if (hostId !== null) {
        const c = clients.get(hostId);
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ t: 'you-host' }));
        broadcast({ t: 'new-host', id: hostId }, hostId);
      }
    }
    console.log(`- ${name} (#${id}) — ${clients.size} connected`);
  });
});

server.listen(PORT, () => {
  console.log('Deadlight LAN server running. Open one of these on each phone:');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`  http://localhost:${PORT}  (this machine)`);
});
