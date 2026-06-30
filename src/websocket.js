const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;
const klienter = new Map();

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url    = new URL(req.url, 'ws://localhost');
    const token  = url.searchParams.get('token');
    let bruger   = null;

    try {
      bruger = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, 'Ugyldig token');
      return;
    }

    klienter.set(ws, bruger);

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') send(ws, 'pong', {});
      } catch {}
    });

    ws.on('close', () => klienter.delete(ws));
    ws.on('error', () => klienter.delete(ws));

    send(ws, 'tilsluttet', { id: bruger.id, navn: bruger.discord });
  });

  console.log('[WS] WebSocket klar ✓');
}

function send(ws, type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data, ts: Date.now() }));
  }
}

function broadcast(type, data) {
  klienter.forEach((_, ws) => send(ws, type, data));
}

module.exports = { init, broadcast, send };
