#!/usr/bin/env node
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3200);
const ROOM_LIMIT = Number(process.env.ROOM_LIMIT || 200);
const KEEPALIVE_MS = Number(process.env.KEEPALIVE_MS || 30000);

const rooms = new Map();
const clients = new Set();

function now() {
  return Date.now();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function frameText(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function frameClose(code = 1000, reason = '') {
  const reasonBuf = Buffer.from(reason);
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
}

function framePong(payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x8A, payload.length]), payload]);
}

function createClient(socket, request) {
  return {
    id: crypto.randomUUID(),
    socket,
    request,
    connectedAt: now(),
    lastSeenAt: now(),
    roomId: null,
    playerId: null,
    isAlive: true,
    buffer: Buffer.alloc(0),
  };
}

function pruneRooms() {
  while (rooms.size > ROOM_LIMIT) {
    const oldestKey = rooms.keys().next().value;
    rooms.delete(oldestKey);
  }
}

function joinRoom(client, roomId, playerId) {
  if (!roomId) return;
  const room = rooms.get(roomId) || { clients: new Set(), updatedAt: now(), playerIds: new Set() };
  room.clients.add(client);
  if (playerId) room.playerIds.add(playerId);
  room.updatedAt = now();
  rooms.set(roomId, room);
  client.roomId = roomId;
  client.playerId = playerId || client.playerId;
  pruneRooms();
}

function leaveRoom(client) {
  const { roomId } = client;
  if (!roomId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  room.clients.delete(client);
  room.updatedAt = now();
  if (!room.clients.size) {
    rooms.delete(roomId);
    return;
  }
  rooms.set(roomId, room);
}

function send(client, data) {
  if (client.socket.destroyed) return false;
  try {
    client.socket.write(frameText(JSON.stringify(data)));
    return true;
  } catch {
    return false;
  }
}

function broadcast(sender, envelope) {
  const roomId = envelope && envelope.roomId;
  if (!roomId) return;
  joinRoom(sender, roomId, envelope.senderId);
  const room = rooms.get(roomId);
  if (!room) return;
  room.updatedAt = now();
  for (const client of room.clients) {
    if (client === sender) continue;
    send(client, envelope);
  }
}

function normalizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return null;
  if (!envelope.type || !envelope.roomId || !envelope.senderId) return null;
  return {
    v: envelope.v || '1.0',
    type: envelope.type,
    roomId: String(envelope.roomId),
    senderId: String(envelope.senderId),
    seq: Number.isFinite(envelope.seq) ? envelope.seq : 0,
    ts: Number.isFinite(envelope.ts) ? envelope.ts : now(),
    payload: envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {},
  };
}

function handleMessage(client, message) {
  client.lastSeenAt = now();
  const envelope = normalizeEnvelope(safeJsonParse(message));
  if (!envelope) {
    send(client, {
      v: '1.0',
      type: 'error',
      roomId: client.roomId || 'unknown',
      senderId: 'signal-server',
      seq: 0,
      ts: now(),
      payload: { code: 'INVALID_MESSAGE', message: 'message must be a valid match envelope' },
    });
    return;
  }
  broadcast(client, envelope);
}

function parseFrames(client) {
  let buffer = client.buffer;
  while (buffer.length >= 2) {
    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const opcode = firstByte & 0x0f;
    const masked = Boolean(secondByte & 0x80);
    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (buffer.length < 4) break;
      payloadLen = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buffer.length < 10) break;
      const bigLen = buffer.readBigUInt64BE(2);
      if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
        client.socket.end(frameClose(1009, 'payload too large'));
        return Buffer.alloc(0);
      }
      payloadLen = Number(bigLen);
      offset = 10;
    }

    const maskBytes = masked ? 4 : 0;
    if (buffer.length < offset + maskBytes + payloadLen) break;

    let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + payloadLen);
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      const unmasked = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i += 1) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    buffer = buffer.subarray(offset + maskBytes + payloadLen);

    if (opcode === 0x8) {
      client.socket.end(frameClose());
      return Buffer.alloc(0);
    }
    if (opcode === 0x9) {
      client.socket.write(framePong(payload));
      continue;
    }
    if (opcode === 0x1) {
      handleMessage(client, payload.toString('utf8'));
    }
  }
  return buffer;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, clients: clients.size, rooms: rooms.size, now: now() }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('chinese-chess signal server running\n');
});

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  const upgrade = String(request.headers.upgrade || '').toLowerCase();
  if (!key || upgrade !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'binary')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey}\r\n`
      + '\r\n',
  );

  const client = createClient(socket, request);
  clients.add(client);

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    client.buffer = parseFrames(client);
  });

  socket.on('close', () => {
    leaveRoom(client);
    clients.delete(client);
  });

  socket.on('error', () => {
    leaveRoom(client);
    clients.delete(client);
  });
});

const interval = setInterval(() => {
  const cutoff = now() - KEEPALIVE_MS * 4;
  for (const client of clients) {
    if (client.lastSeenAt < cutoff) {
      try {
        client.socket.end(frameClose(1001, 'idle timeout'));
      } catch {}
      leaveRoom(client);
      clients.delete(client);
    }
  }
}, KEEPALIVE_MS);

interval.unref();

server.listen(PORT, HOST, () => {
  console.log(`[signal] listening on ws://${HOST}:${PORT}`);
  console.log(`[signal] health check: http://${HOST}:${PORT}/healthz`);
});
