/* Invite rooms for static hosting. PeerJS Cloud handles signaling; the host
   browser runs the existing authoritative simulation and exchanges DataChannel
   messages. No account, deployment, webcam or microphone is required. */
import { CARS, CHARACTERS } from './config.js';
import { PeerLobby, LOBBY_PEER_ID } from './peer-lobby.js';

const PREFIX = 'kop-driver-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 6;
const cleanPlayer = (m, id, isHost = false) => ({
  id, isHost, name: String(m.name || '玩家').slice(0, 8),
  charKey: CHARACTERS.some(c => c.key === m.charKey) ? m.charKey : CHARACTERS[0].key,
  carFile: CARS.some(c => c.file === m.carFile) ? m.carFile : CARS[0].file,
});
let loading;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer=setTimeout(()=>{script.remove();reject(new Error('联机组件加载超时，请刷新重试'));},12000);
    script.src = new URL('../assets/vendor/peerjs-1.5.5.min.js', import.meta.url).href;
    script.onload = () => {clearTimeout(timer);window.Peer ? resolve(window.Peer) : reject(new Error('联机组件加载失败，请刷新重试'));};
    script.onerror = () => {clearTimeout(timer);script.remove(); reject(new Error('联机组件加载失败，请刷新重试')); };
    document.head.append(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => ALPHABET[n % ALPHABET.length]).join('');
}
function send(connection, message) {
  if (!connection?.open) return;
  // Discard stale snapshots when a slow connection is congested.
  if (message.t === 'snap' && connection.dataChannel?.bufferedAmount > 128 * 1024) return;
  try { connection.send(message); } catch { /* close/error handlers handle loss */ }
}

export class PeerRoom {
  constructor(net) {
    this.net = net; this.peer = null; this.hostPeer = null; this.hostConn = null;
    this.players = new Map(); this.connections = new Map(); this.state = 'lobby';
    this.operation = 0; this.pendingJoin = null;
  }
  async openPeer(id) {
    const Peer = await loadPeer();
    const peer = new Peer(id, { debug: 0 });
    const ready = new Promise((resolve, reject) => {
      let settled=false;
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('连接超时，请检查网络后点击重新连接')); }, 12000);
      peer.once('open', () => { settled=true; clearTimeout(timer); resolve(peer); });
      peer.once('error', error => { if(settled)return; settled=true; clearTimeout(timer); peer.destroy(); reject(error); });
    });
    await ready;
    // Initial failures were handled above; ongoing errors must also have a listener.
    peer.on('error', error => {
      if(error.type==='peer-unavailable'&&error.message?.includes(LOBBY_PEER_ID)){this.directory?.unavailable();return;}
      if (error.type === 'peer-unavailable' && this.pendingJoin) this.pendingJoin.fail('房间不存在或房主已离开，请检查房间号');
      else if (error.type !== 'unavailable-id') this.net.emit('error', '联机网络暂时不可用，请稍后重试');
    });
    peer.on('disconnected', () => {
      if (peer.destroyed) return;
      this.net.emit('status', 'wait', '联机连接正在恢复…');
      try { peer.reconnect(); } catch { /* timeout below provides recovery */ }
      const timer = setTimeout(() => {
        if (peer.destroyed || !peer.disconnected) return;
        if (peer === this.peer) {
          this.net.connected = false;
          if (this.net.code) this.net._on({t:'roomEnded',msg:'联机连接中断，请重新创建或加入房间'});
          this.net.emit('close');
        } else if (peer === this.hostPeer) {
          this.net._on({t:'roomEnded',msg:'房间连接中断，请重新创建房间'});
        }
      }, 12000);
      peer.once('open', () => { clearTimeout(timer); this.net.emit('status', 'ok', '联机已恢复 · 可在公开大厅创建或加入房间'); });
      peer.once('close', () => clearTimeout(timer));
    });
    return peer;
  }
  async connect() {
    this.directory?.stop();
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peer = await this.openPeer('kop-player-' + crypto.randomUUID());
    this.net.id = this.peer.id; this.net.connected = true;
    this.directory=new PeerLobby(this);this.directory.start();
    this.net.emit('open');
  }
  clearRoom() {
    this.net.code = null; this.net.isHost = false;
    const host = this.hostConn; this.hostConn = null;
    if (host) { send(host, {t:'leave'}); host.close(); }
    for (const conn of this.connections.values()) { send(conn,{t:'roomEnded',msg:'房主已离开，房间关闭'}); conn.close(); }
    this.connections.clear(); this.players.clear();
    if (this.hostPeer) { const old=this.hostPeer; this.hostPeer=null; old.destroy(); }
    this.state='lobby';
  }
  leave() {
    this.operation++;
    if (this.pendingJoin) this.pendingJoin.cancel();
    this.clearRoom(); this.listRooms();
  }
  async create(message) {
    this.leave();
    const operation = this.operation;
    this.net.emit('status','wait','正在创建好友房间…');
    for (let attempt=0; attempt<3; attempt++) {
      const code=roomCode();
      try {
        const host=await this.openPeer(PREFIX+code);
        if (operation!==this.operation) { host.destroy(); return; }
        this.hostPeer=host;
        this.players.set(this.net.id,cleanPlayer(message,this.net.id,true));
        host.on('connection', conn => this.accept(conn));
        this.net._on({t:'created',code,you:this.net.id});
        this.lobby();
        this.net.emit('status','ok',this.net.rooms.some(room=>room.code===code)?'房间已公开 · 其他玩家可从大厅直接加入':'房间已创建 · 正在发布到公开大厅…');
        return;
      } catch(error) {
        if(operation!==this.operation)return;
        if(error.type==='unavailable-id')continue;
        this.net.emit('status','err','建房失败，请点击「创建房间」重试');
        this.net.emit('error',error.message || '创建房间失败，请重试');return;
      }
    }
    this.net.emit('error','房间号暂时不可用，请重新创建房间');
    this.net.emit('status','err','建房失败，请重新创建房间');
  }
  accept(conn) {
    if(!/^kop-player-[a-f0-9-]{36}$/.test(conn.peer)){conn.close();return;}
    const host=this.hostPeer;
    const timer=setTimeout(()=>{if(!this.connections.has(conn.peer))conn.close();},6000);
    conn.on('data',m=>{
      if(host!==this.hostPeer || !m || typeof m!=='object')return;
      if(!this.players.has(conn.peer)) {
        if(m.t!=='join'||m.version!==1)return;
        let error=this.state!=='lobby'?'该房间已开始比赛':(this.players.size>=MAX_PLAYERS?'房间已满（最多 6 人）':null);
        if(error){send(conn,{t:'error',msg:error});clearTimeout(timer);setTimeout(()=>conn.close(),200);return;}
        this.connections.set(conn.peer,conn);this.players.set(conn.peer,cleanPlayer(m,conn.peer));clearTimeout(timer);
        send(conn,{t:'joined',code:this.net.code,you:conn.peer});this.lobby();return;
      }
      if(this.connections.get(conn.peer)!==conn)return;
      if(m.t==='leave'){this.remove(conn);conn.close();}
      else if(m.t==='updateMe'&&this.state==='lobby'){
        this.players.set(conn.peer,cleanPlayer({...this.players.get(conn.peer),...m},conn.peer));this.lobby();
      } else if(m.t==='input'&&this.state==='racing'){
        this.net._on({t:'input',from:conn.peer,throttle:Math.max(-1,Math.min(1,+m.throttle||0)),
          brake:Math.max(0,Math.min(1,+m.brake||0)),steer:Math.max(-1,Math.min(1,+m.steer||0)),
          boost:!!m.boost,drift:!!m.drift,useItem:!!m.useItem,aimLane:Math.max(1,Math.min(5,m.aimLane|0))});
      }
    });
    conn.on('close',()=>{clearTimeout(timer);this.remove(conn);});
    conn.on('error',()=>{clearTimeout(timer);this.remove(conn);conn.close();});
  }
  remove(conn) {
    if(this.connections.get(conn.peer)!==conn)return;
    this.connections.delete(conn.peer);this.players.delete(conn.peer);
    if(this.state==='racing')this.net._on({t:'peerLeft',id:conn.peer});this.lobby();
  }
  join(message) {
    if(this.net.code===message.code)return;
    if(this.pendingJoin)this.pendingJoin.cancel();
    const operation=++this.operation;
    const conn=this.peer.connect(PREFIX+message.code,{reliable:true,serialization:'json',metadata:{game:'kop-driver-v1'}});
    this.net.emit('status','wait','正在连接好友房间…');
    const finish=()=>{clearTimeout(timer);if(this.pendingJoin?.conn===conn)this.pendingJoin=null;};
    const fail=msg=>{
      if(operation!==this.operation)return;
      finish();conn.close();this.net.emit('error',msg);
      this.net.emit('status',this.net.code?'ok':'err',this.net.code?'仍在原房间，可以再次邀请或加入':'加入失败，请核对房号后重试');
    };
    const timer=setTimeout(()=>fail('连接房主超时，请确认房主仍在线；网络受限时可换一个网络重试'),15000);
    this.pendingJoin={conn,fail,cancel:()=>{finish();conn.close();}};
    conn.on('open',()=>{if(operation===this.operation)send(conn,{...message,t:'join',version:1});else conn.close();});
    conn.on('data',m=>{
      if(operation!==this.operation||!m||typeof m!=='object')return;
      if(m.t==='joined'){
        finish();this.clearRoom();this.hostConn=conn;
        this.net._on({...m,you:this.peer.id});this.net.emit('status','ok','已加入好友房间');
      } else if(this.hostConn===conn&&['lobby','start','snap','roomEnded'].includes(m.t))this.net._on(m);
      else if(m.t==='error')fail(String(m.msg||'无法加入房间'));
    });
    conn.on('close',()=>{
      if(this.pendingJoin?.conn===conn)fail('连接已关闭，请重新加入');
      if(this.hostConn===conn){this.hostConn=null;this.net._on({t:'roomEnded',msg:'房主已离开或连接中断，房间关闭'});}
    });
    conn.on('error',()=>{if(this.pendingJoin?.conn===conn)fail('无法连接房主，请核对房号或换一个网络重试');});
  }
  broadcast(message) { for(const conn of this.connections.values())send(conn,message); }
  lobby() {
    if(!this.net.isHost)return;
    const message={t:'lobby',code:this.net.code,host:this.net.id,state:this.state,players:[...this.players.values()]};
    this.net._on(message);this.broadcast(message);this.listRooms();
  }
  listRooms() { this.directory?.refresh(); }
  send(message) {
    switch(message.t){
      case 'create':this.create(message);break;
      case 'join':this.join(message);break;
      case 'list':this.listRooms();break;
      case 'leave':this.leave();break;
      case 'updateMe':
        if(this.net.isHost&&this.state==='lobby'){
          this.players.set(this.net.id,cleanPlayer({...this.players.get(this.net.id),...message},this.net.id,true));this.lobby();
        }else send(this.hostConn,message);break;
      case 'start':
        if(this.net.isHost&&Array.isArray(message.roster)){
          this.state='racing';const start={t:'start',host:this.net.id,roster:message.roster,mapId:['city','desert','ice'].includes(message.mapId)?message.mapId:'city'};
          this.broadcast(start);this.net._on(start);this.listRooms();
        }break;
      case 'snap':if(this.net.isHost)this.broadcast(message);break;
      case 'input':if(!this.net.isHost)send(this.hostConn,message);break;
    }
  }
}
