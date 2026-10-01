/* ============================================================
   联机客户端网络层：封装 WebSocket 连接与"萌兽卡丁"联机协议
   ------------------------------------------------------------
   协议（见 server/server.js）：
     → list/create/join/start/input/snap/leave
     ← rooms/created/joined/lobby/start/input/snap/peerLeft/roomEnded/error
   WebSocket 地址：默认 ws(s)://<当前页面主机>:8080；
   可用 ?ws=wss://your-host:8080 覆盖（用于部署到公网 / 反代）。
   ============================================================ */

export function defaultWsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  if (q) return q;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname;
  if (!host) return 'ws://127.0.0.1:8080';            // 理论上不该出现（ES Module 必须走 HTTP）
  // 8231 是开发用的纯静态服务器（serve.py），联机中继固定在同一台机器的 8080；
  // 其余情况优先「同源」——中继服务器可以同端口把站点一起发出去，此时页面与 ws 同端口。
  if (location.port !== '8231') return proto + '://' + location.host;
  return proto + '://' + host + ':8080';
}

export class Net {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.url = null;      // 最近一次连接的服务器地址
    this.id = null;       // 服务器分配的客户端 id
    this.code = null;     // 房间号
    this.isHost = false;
    this.rooms = [];      // 最近一次收到的房间列表
    this.handlers = {};
  }

  on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); return this; }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach((cb) => cb(...a)); }

  connect(url) {
    const u = url || defaultWsUrl();
    this.url = u;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(u); }
      catch (e) { reject(e); return; }
      this.ws = ws;
      let settled = false;
      ws.onopen = () => { this.connected = true; this.emit('open'); if (!settled) { settled = true; resolve(); } };
      ws.onclose = () => { this.connected = false; this.emit('close'); };
      ws.onerror = (e) => { this.emit('error', '连接服务器失败'); if (!settled) { settled = true; reject(new Error('ws connect error')); } };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        this._on(m);
      };
    });
  }

  _on(m) {
    switch (m.t) {
      case 'created': this.code = m.code; this.id = m.you; this.isHost = true; this.emit('created', m); break;
      case 'joined': this.code = m.code; this.id = m.you; this.isHost = false; this.emit('joined', m); break;
      case 'rooms': this.rooms = m.rooms || []; this.emit('rooms', this.rooms, m.max); break;
      case 'lobby': this.emit('lobby', m); break;
      case 'start': this.emit('start', m); break;
      case 'input': this.emit('input', m); break;
      case 'snap': this.emit('snap', m.data); break;
      case 'peerLeft': this.emit('peerLeft', m); break;
      case 'roomEnded': this.emit('roomEnded', m); break;
      case 'error': this.emit('error', m.msg || '错误'); break;
    }
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    }
  }

  listRooms() { this._send({ t: 'list' }); }
  createRoom(name, charKey, carFile) { this._send({ t: 'create', name, charKey, carFile }); }
  joinRoom(code, name, charKey, carFile) { this._send({ t: 'join', code: ('' + code).toUpperCase(), name, charKey, carFile }); }
  startGame(roster) { this._send({ t: 'start', roster }); }
  sendInput(inp) {
    this._send({
      t: 'input',
      throttle: inp.throttle | 0, brake: inp.brake | 0, steer: inp.steer,
      boost: !!inp.boost, useItem: !!inp.useItem, aimLane: inp.aimLane | 0,
    });
  }
  sendSnapshot(data) { this._send({ t: 'snap', data }); }
  leave() { this._send({ t: 'leave' }); }
}
