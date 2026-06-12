/* LAN multiplayer client. Connects to the bundled WebSocket relay server
   (server/lan-server.js) over the same host the page was served from.
   The first player to connect is the lobby host; the host's machine runs
   the authoritative zombie simulation in-game. */

var Net = (function () {
  var ws = null;
  var myId = null;
  var host = false;
  var peers = {};        // id -> name
  var handlers = {};     // game-message type -> fn(data, fromId)
  var lobbyCb = null;    // re-render lobby UI on roster changes

  function notifyLobby() { if (lobbyCb) lobbyCb(); }

  function connect(name, cb) {
    if (ws) disconnect();
    if (location.protocol === 'https:' || location.protocol === 'file:') {
      cb('LAN play needs the bundled server. On a computer on your Wi-Fi run:\n' +
         'npm install && npm start\n' +
         'then open http://<that-computer’s-IP>:8080 on every phone.');
      return;
    }
    var settled = false;
    try {
      ws = new WebSocket('ws://' + location.host);
    } catch (e) {
      cb('Could not open a connection.');
      return;
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({ t: 'hello', name: name }));
    };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') {
        myId = m.id;
        host = m.host;
        peers = {};
        m.peers.forEach(function (p) { peers[p.id] = p.name; });
        if (!settled) { settled = true; cb(null); }
        notifyLobby();
      } else if (m.t === 'peer-join') {
        peers[m.id] = m.name;
        notifyLobby();
      } else if (m.t === 'peer-left') {
        delete peers[m.id];
        if (handlers['peer-left']) handlers['peer-left'](m.id);
        notifyLobby();
      } else if (m.t === 'you-host') {
        host = true;
        notifyLobby();
      } else if (m.t === 'msg') {
        var h = handlers[m.d && m.d.t];
        if (h) h(m.d, m.from);
      }
    };
    ws.onclose = function () {
      ws = null;
      myId = null;
      if (handlers['disconnect']) handlers['disconnect']();
      notifyLobby();
    };
    ws.onerror = function () {
      if (!settled) {
        settled = true;
        cb('Could not reach the LAN server — is it running on this address?');
      }
    };
  }

  function disconnect() {
    if (ws) {
      var s = ws;
      ws = null;
      try { s.onclose = null; s.close(); } catch (e) {}
    }
    myId = null;
    host = false;
    peers = {};
    handlers = {};
    notifyLobby();
  }

  return {
    connect: connect,
    disconnect: disconnect,
    active: function () { return !!ws && myId !== null; },
    id: function () { return myId; },
    isHost: function () { return host; },
    peers: function () { return peers; },
    peerCount: function () { return Object.keys(peers).length; },
    peerName: function (id) { return peers[id] || 'Survivor'; },
    send: function (d) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'msg', d: d }));
    },
    on: function (type, fn) { handlers[type] = fn; },
    onLobby: function (fn) { lobbyCb = fn; }
  };
})();
