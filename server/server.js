/* ============================================================
   萌兽卡丁 · 联机中继服务器（Node + ws）
   ------------------------------------------------------------
   纯消息中继 + 房间管理，不做任何游戏逻辑。
   - 客户端连上来后 create / join 一个房间（按 4 位房间号）
   - 未入房的客户端会收到房间列表（rooms），可直接从列表里挑一间进
   - 房主点开始 -> 服务器把完整 roster 广播给房间内所有人
   - 比赛中：房主把快照 snapshot 发到服务器，服务器转发给其他人；
             其他玩家的输入 input 只转发给房主
   启动：node server/server.js   （端口 8080，可用 PORT 环境变量覆盖）
   ============================================================ */
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = 6;
const MAX_ROOMS = 10;          // 同时存在的房间上限

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混字符 I O 0 1
function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

const rooms = new Map();        // code -> room
let nextClientId = 1;

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}
function broadcast(room, obj, exceptId) {
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    send(p.ws, obj);
  }
}
function lobbyState(room) {
  return {
    t: 'lobby',
    code: room.code,
    host: room.hostId,
    state: room.state,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, charKey: p.charKey, carFile: p.carFile, isHost: p.isHost,
    })),
  };
}
function broadcastLobby(room) { broadcast(room, lobbyState(room)); }

function roomSummary(room) {
  const ps = [...room.players.values()];
  const host = ps.find((p) => p.id === room.hostId) || ps[0] || null;
  return {
    code: room.code,
    host: host ? host.name : '房主',
    hostChar: host ? host.charKey : '',
    count: ps.length,
    max: MAX_PLAYERS,
    state: room.state,            // lobby | racing
    names: ps.map((p) => p.name),
  };
}
function roomList() { return [...rooms.values()].map(roomSummary); }

/* 把最新房间列表推给所有"还没进房间"的客户端 */
function broadcastRooms() {
  const list = roomList();
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (findRoomByClient(ws.clientId)) continue;
    send(ws, { t: 'rooms', rooms: list, max: MAX_ROOMS });
  }
}

function findRoomByClient(id) {
  for (const r of rooms.values()) if (r.players.has(id)) return r;
  return null;
}

function safeName(n) { return ('' + (n || '玩家')).slice(0, 8); }
function safeChar(k) { return ('' + (k || '')).slice(0, 16); }
function safeCar(k) { return ('' + (k || '')).slice(0, 32); }

wss.on('connection', (ws) => {
  const id = 'c' + (nextClientId++);
  ws.clientId = id;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'create': {
        // 退出可能还在的旧房间
        const old = findRoomByClient(id);
        if (old) leaveRoom(old, id);

        if (rooms.size >= MAX_ROOMS) {
          send(ws, { t: 'error', msg: '房间已达上限（' + MAX_ROOMS + ' 个），请稍后再试' });
          return;
        }

        let code = genCode();
        while (rooms.has(code)) code = genCode();
        const room = {
          code, hostId: id, state: 'lobby',
          players: new Map(),
        };
        room.players.set(id, {
          id, name: safeName(m.name), charKey: safeChar(m.charKey),
          carFile: safeCar(m.carFile), isHost: true, ws,
        });
        rooms.set(code, room);
        send(ws, { t: 'created', code, you: id, isHost: true });
        broadcastLobby(room);
        broadcastRooms();
        break;
      }

      case 'list': {
        send(ws, { t: 'rooms', rooms: roomList(), max: MAX_ROOMS });
        break;
      }

      case 'join': {
        const code = ('' + (m.code || '')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        const room = rooms.get(code);
        if (!room) { send(ws, { t: 'error', msg: '房间不存在，请检查房间号' }); return; }
        if (room.state !== 'lobby') { send(ws, { t: 'error', msg: '该房间已开始比赛' }); return; }
        if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: '房间已满（最多 ' + MAX_PLAYERS + ' 人）' }); return; }

        const old = findRoomByClient(id);
        if (old) leaveRoom(old, id);

        room.players.set(id, {
          id, name: safeName(m.name), charKey: safeChar(m.charKey),
          carFile: safeCar(m.carFile), isHost: false, ws,
        });
        send(ws, { t: 'joined', code, you: id, isHost: false });
        broadcastLobby(room);
        broadcastRooms();
        break;
      }

      case 'start': {
        const room = findRoomByClient(id);
        if (!room) return;
        if (room.hostId !== id) { send(ws, { t: 'error', msg: '只有房主可以开始' }); return; }
        if (room.state !== 'lobby') return;
        const roster = Array.isArray(m.roster) ? m.roster : null;
        if (!roster) { send(ws, { t: 'error', msg: '缺少 roster' }); return; }
        room.state = 'racing';
        broadcast(room, { t: 'start', host: room.hostId, roster });
        broadcastRooms();
        break;
      }

      case 'input': {
        const room = findRoomByClient(id);
        if (!room || room.state !== 'racing') return;
        // 只转发给房主
        const host = room.players.get(room.hostId);
        if (host && host.id !== id) {
          send(host.ws, {
            t: 'input', from: id,
            throttle: +m.throttle || 0, brake: +m.brake || 0, steer: +m.steer || 0,
            boost: !!m.boost, useItem: !!m.useItem, aimLane: +m.aimLane || 3,
          });
        }
        break;
      }

      case 'snap': {
        const room = findRoomByClient(id);
        if (!room || room.state !== 'racing') return;
        // 快照只来自房主，转发给其他人
        if (room.hostId !== id) return;
        broadcast(room, { t: 'snap', data: m.data }, id);
        break;
      }

      case 'leave': {
        const room = findRoomByClient(id);
        if (room) leaveRoom(room, id);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = findRoomByClient(ws.clientId);
    if (room) leaveRoom(room, ws.clientId);
  });
  ws.on('error', () => {});
});

function leaveRoom(room, id) {
  const p = room.players.get(id);
  room.players.delete(id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    broadcastRooms();
    return;
  }
  // 房主离开 -> 房间关闭
  if (room.hostId === id) {
    rooms.delete(room.code);
    broadcast(room, { t: 'roomEnded', msg: '房主已离开，房间关闭' });
    broadcastRooms();
    return;
  }
  // 比赛中其他人离开：通知房主移除该赛车手
  if (room.state === 'racing') {
    const host = room.players.get(room.hostId);
    if (host) send(host.ws, { t: 'peerLeft', id });
  }
  broadcastLobby(room);
  broadcastRooms();
}

// 心跳：踢掉死连接
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);
wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
wss.on('close', () => clearInterval(heartbeat));

console.log(`[moe-kart] relay server listening on ws://${HOST}:${PORT}`);
