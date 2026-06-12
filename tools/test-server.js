/* End-to-end LAN server test: boots server/lan-server.js on a test port,
   connects two real WebSocket clients, and checks the lobby protocol:
   welcome/host assignment, peer-join, message relay, and host handoff. */

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18099;
const srv = spawn('node', [path.join(__dirname, '..', 'server', 'lan-server.js'), PORT], {
  stdio: ['ignore', 'pipe', 'inherit']
});

let failures = 0;
const fail = (m) => { console.error('FAIL: ' + m); failures++; };

function client(name) {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT);
  const c = { ws, name, msgs: [], id: null, host: false };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'welcome') { c.id = m.id; c.host = m.host; }
    if (m.t === 'you-host') c.host = true;
  });
  return c;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  try {
    await sleep(700); // let the server boot

    const a = client('Alice');
    await sleep(300);
    const b = client('Bob');
    await sleep(300);

    if (!a.host) fail('first client was not made host');
    if (b.host) fail('second client should not be host');
    if (!a.msgs.some(m => m.t === 'peer-join' && m.name === 'Bob')) fail('host never saw Bob join');
    const welcomeB = b.msgs.find(m => m.t === 'welcome');
    if (!welcomeB || !welcomeB.peers.some(p => p.name === 'Alice')) fail('Bob welcome missing Alice in roster');

    // relay both directions
    a.ws.send(JSON.stringify({ t: 'msg', d: { t: 'start', map: 'house' } }));
    b.ws.send(JSON.stringify({ t: 'msg', d: { t: 'p', x: 1, y: 2 } }));
    await sleep(300);
    if (!b.msgs.some(m => m.t === 'msg' && m.d.t === 'start' && m.d.map === 'house')) fail('start not relayed to Bob');
    if (!a.msgs.some(m => m.t === 'msg' && m.d.t === 'p' && m.from === b.id)) fail('player state not relayed to Alice');

    // host handoff when the host leaves
    a.ws.close();
    await sleep(400);
    if (!b.host) fail('Bob was not promoted to host after Alice left');

    b.ws.close();
    console.log(failures ? failures + ' FAILURES' : 'LAN server test passed.');
  } catch (e) {
    fail('exception: ' + e.message);
  } finally {
    srv.kill();
    process.exit(failures ? 1 : 0);
  }
})();
