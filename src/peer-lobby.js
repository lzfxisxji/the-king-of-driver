/* Public room discovery over the same signaling service. Online browsers elect
   one temporary directory peer. Hosts renew their room advertisements; all
   clients republish if the directory browser leaves. No player runs a server. */
export const LOBBY_PEER_ID='kop-driver-public-lobby-v1';
const LEASE_MS=20000;

function summary(value) {
  if(!value||!/^[A-Z0-9]{6}$/.test(value.code))return null;
  return {code:value.code,host:String(value.host||'玩家').slice(0,8),
    hostChar:String(value.hostChar||'').slice(0,16),count:Math.max(1,Math.min(6,value.count|0)),
    max:6,state:value.state==='racing'?'racing':'lobby'};
}

export class PeerLobby {
  constructor(owner) {
    this.owner=owner;this.net=owner.net;this.peer=owner.peer;
    this.coordinator=null;this.connection=null;this.clients=new Map();this.records=new Map();
    this.electing=false;this.stopped=false;this.followTimer=0;this.retryTimer=0;this.tickTimer=0;
    this.lastResponse=0;
    this.ready=false;this.noticeTimer=0;
  }
  start() {this.watchRecovery();this.follow();this.tickTimer=setInterval(()=>this.refresh(),4000);}
  watchRecovery() {
    if(this.noticeTimer)return;
    this.noticeTimer=setTimeout(()=>{
      this.noticeTimer=0;
      if(!this.stopped&&!this.ready)this.net.emit('status','err','公开大厅暂时不可用，点击「刷新房间」重试');
    },15000);
  }
  stop() {
    this.stopped=true;clearInterval(this.tickTimer);clearTimeout(this.followTimer);clearTimeout(this.retryTimer);
    clearTimeout(this.noticeTimer);
    if(this.connection)this.connection.close();
    for(const conn of this.clients.values())conn.close();
    this.clients.clear();this.records.clear();if(this.coordinator)this.coordinator.destroy();
  }
  advertisement() {
    if(!this.net.isHost||!this.net.code)return null;
    const host=this.owner.players.get(this.net.id);
    return {code:this.net.code,host:host?.name||'玩家',hostChar:host?.charKey||'',
      count:this.owner.players.size,max:6,state:this.owner.state};
  }
  send(conn,message) {if(conn?.open)try{conn.send(message);}catch{/* watchdog retries */}}
  follow() {
    if(this.stopped||this.electing||this.coordinator||this.connection||this.peer.destroyed||this.peer.disconnected)return;
    const conn=this.peer.connect(LOBBY_PEER_ID,{reliable:true,serialization:'json',metadata:{game:'kop-directory-v1'}});
    this.connection=conn;
    this.followTimer=setTimeout(()=>{if(this.connection===conn&&!conn.open)this.unavailable();},4500);
    conn.on('open',()=>{
      clearTimeout(this.followTimer);
      if(this.stopped||this.coordinator||this.connection!==conn){conn.close();return;}
      this.lastResponse=Date.now();
      this.send(conn,{t:'sync',room:this.advertisement()});
    });
    conn.on('data',message=>{
      if(this.connection!==conn||message?.t!=='directory')return;
      this.lastResponse=Date.now();
      this.deliver((message.rooms||[]).map(summary).filter(Boolean));
    });
    const lost=()=>{
      if(this.connection!==conn)return;
      this.connection=null;clearTimeout(this.followTimer);this.retryElection();
    };
    conn.on('close',lost);conn.on('error',lost);
  }
  unavailable() {
    if(this.stopped||this.coordinator)return;
    const conn=this.connection;this.connection=null;clearTimeout(this.followTimer);
    if(conn)conn.close();this.deliver([],false);this.retryElection();
  }
  retryElection() {
    if(this.stopped||this.electing)return;
    clearTimeout(this.retryTimer);
    this.retryTimer=setTimeout(()=>this.elect(),150+Math.random()*450);
  }
  async elect() {
    if(this.stopped||this.electing||this.coordinator)return;
    this.electing=true;
    try {
      const peer=await this.owner.openPeer(LOBBY_PEER_ID);
      if(this.stopped){peer.destroy();return;}
      this.coordinator=peer;
      if(this.connection){const old=this.connection;this.connection=null;old.close();}
      peer.on('connection',conn=>this.accept(conn));
      peer.on('close',()=>{
        if(this.coordinator!==peer)return;
        this.coordinator=null;this.clients.clear();this.records.clear();this.retryElection();
      });
      this.record(this.peer.id,this.advertisement());this.publish();
    }catch{
      if(!this.stopped){clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.follow(),700);}
    }finally{this.electing=false;}
  }
  accept(conn) {
    if(!/^kop-player-[a-f0-9-]{36}$/.test(conn.peer)){conn.close();return;}
    const coordinator=this.coordinator;
    const timer=setTimeout(()=>{if(this.clients.get(conn.peer)!==conn)conn.close();},6000);
    conn.on('data',message=>{
      if(this.stopped||coordinator!==this.coordinator||message?.t!=='sync')return;
      if(this.clients.size>=150&&!this.clients.has(conn.peer)){conn.close();return;}
      this.clients.set(conn.peer,conn);clearTimeout(timer);
      const changed=this.record(conn.peer,message.room);
      if(changed)this.publish();else this.send(conn,{t:'directory',rooms:this.rooms()});
    });
    const lost=()=>{
      clearTimeout(timer);
      if(this.clients.get(conn.peer)!==conn)return;
      this.clients.delete(conn.peer);this.records.delete(conn.peer);this.publish();
    };
    conn.on('close',lost);conn.on('error',lost);
  }
  record(id,value) {
    const room=summary(value),old=this.records.get(id);
    if(!room){this.records.delete(id);return !!old;}
    this.records.set(id,{room,expires:Date.now()+LEASE_MS});
    return !old||JSON.stringify(old.room)!==JSON.stringify(room);
  }
  rooms() {
    for(const [id,record]of this.records)if(record.expires<Date.now())this.records.delete(id);
    return [...this.records.values()].map(r=>r.room).slice(0,50);
  }
  deliver(rooms,ready=true) {
    this.ready=ready;
    if(ready){clearTimeout(this.noticeTimer);this.noticeTimer=0;}
    else {this.watchRecovery();this.net.emit('status','wait','公开大厅正在恢复，请稍候…');}
    this.net._on({t:'rooms',rooms,max:50});
  }
  publish() {
    const rooms=this.rooms();this.deliver(rooms);
    for(const conn of this.clients.values())this.send(conn,{t:'directory',rooms});
  }
  refresh() {
    if(this.stopped)return;
    if(this.coordinator){
      this.record(this.peer.id,this.advertisement());this.publish();
    }else if(this.connection?.open){
      if(Date.now()-this.lastResponse>10000){this.unavailable();return;}
      this.send(this.connection,{t:'sync',room:this.advertisement()});
    }
    else if(!this.connection&&!this.electing)this.follow();
  }
}
