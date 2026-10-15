/* ============================================================
   联机客户端网络层：封装 WebSocket 连接与"路人之王"联机协议
   ------------------------------------------------------------
   协议（见 server/server.js）：
     → list/create/join/start/input/snap/leave
     ← rooms/created/joined/lobby/start/input/snap/peerLeft/roomEnded/error
   默认使用公共信令 + 浏览器 DataChannel，支持 GitHub Pages 静态托管。
   ?ws= 保留为开发者专用中继地址覆盖。
   ============================================================ */

import { PeerRoom } from './peer-room.js';

export function defaultWsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  if (q) return q;
  if (new URLSearchParams(location.search).get('transport') !== 'ws') return null;
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
    this.connecting = false;
    this.mode = defaultWsUrl() ? 'relay' : 'peer';
    this.peerRoom = null;
    this._connecting = null;
  }

  on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); return this; }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach((cb) => cb(...a)); }

  connect(url) {
    if(this.connected)return Promise.resolve();
    if(this._connecting)return this._connecting;
    const u = url || defaultWsUrl();
    this.url = u;this.connecting=true;
    this.mode=u?'relay':'peer';
    const attempt=u ? new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(u); }
      catch (e) { reject(e); return; }
      this.ws = ws;
      let settled = false;
      const timer=setTimeout(()=>{if(settled)return;settled=true;ws.close();reject(new Error('连接超时，请点击重新连接'));},12000);
      ws.onopen = () => { if(this.ws!==ws)return;clearTimeout(timer);this.connected = true; this.emit('open'); if (!settled) { settled = true; resolve(); } };
      ws.onclose = () => { clearTimeout(timer);if(this.ws!==ws)return;this.connected = false; this.emit('close');if(!settled){settled=true;reject(new Error('连接已关闭，请重试'));} };
      ws.onerror = () => { clearTimeout(timer);if (!settled) { settled = true; reject(new Error('暂时无法连接，请稍后重试')); } };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        this._on(m);
      };
    }) : (this.peerRoom ||= new PeerRoom(this)).connect();
    this._connecting=attempt.finally(()=>{this.connecting=false;this._connecting=null;});
    return this._connecting;
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
      case 'roomEnded': this.code=null;this.isHost=false;this.emit('roomEnded', m); break;
      case 'error': this.emit('error', m.msg || '错误'); break;
    }
  }

  _send(obj) {
    if(this.mode==='peer') { if(this.connected)this.peerRoom.send(obj);return; }
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    }
  }

  listRooms() { this._send({ t: 'list' }); }
  createRoom(name, charKey, carFile) { this._send({ t: 'create', name, charKey, carFile }); }
  joinRoom(code, name, charKey, carFile) { this._send({ t: 'join', code: ('' + code).toUpperCase(), name, charKey, carFile }); }
  updateMe(charKey, carFile) { this._send({ t: 'updateMe', charKey, carFile }); }
  startGame(roster) { this._send({ t: 'start', roster }); }
  sendInput(inp) {
    this._send({
      t: 'input',
      throttle: inp.throttle | 0, brake: inp.brake | 0, steer: inp.steer,
      boost: !!inp.boost, useItem: !!inp.useItem, aimLane: inp.aimLane | 0,
    });
  }
  sendSnapshot(data) { this._send({ t: 'snap', data }); }
  leave() {
    if(this.peerRoom)this.peerRoom.leave();
    else {this._send({t:'leave'});this.code=null;this.isHost=false;}
  }

  inviteUrl() {
    const url=new URL(location.href);url.search='';url.hash='';
    if(this.mode==='relay'&&this.url)url.searchParams.set('ws',this.url);
    if(this.code)url.searchParams.set('room',this.code);
    return url.href;
  }
}
