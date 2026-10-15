// Real browser integration check against PeerJS Cloud. Requires a dedicated
// headless Chrome with CDP on 9339 and static site on 8235. No mock signaling.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.RACE_QA_ORIGIN||'http://127.0.0.1:8235';
const cdp='http://127.0.0.1:9339';
const pages=[];const evidence=[];
async function page(path,server=cdp){
  const target=await(await fetch(server+'/json/new?'+encodeURIComponent(origin+path),{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);let seq=0;const pending=new Map();
  const errors=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
  function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
  async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  async function wait(expression,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await new Promise(r=>setTimeout(r,150));}
    throw new Error('Timeout: '+expression+'; '+await evaluate('document.body.innerText.slice(0,900)'));}
  await send('Runtime.enable');const tab={id:target.id,server,ws,send,evaluate,wait,errors};pages.push(tab);
  await wait('!!window.__game');return tab;
}
function record(name,value=true){evidence.push({name,value});console.log('PASS '+name+' '+JSON.stringify(value));}
async function close(tab){await fetch(tab.server+'/json/close/'+tab.id);tab.ws.close();}
try{
  const host=await page('/?online=1&char=driver');
  await host.wait('window.__game.net.connected');
  assert.equal(await host.evaluate('window.__game.net.code'),null);
  await host.evaluate("document.getElementById('btnCreateRoom').click()");
  const code=await host.wait('window.__game.net.code&&window.__game.net.rooms.some(r=>r.code===window.__game.net.code)&&window.__game.net.code');
  record('static-only host publishes public room',{code,mode:await host.evaluate('window.__game.net.mode')});
  const guest=await page('/?online=1&char=doubao&car=car_skyblue','http://127.0.0.1:9340');
  await guest.wait(`window.__game.net.rooms.some(r=>r.code===${JSON.stringify(code)})`);
  assert.equal(await guest.evaluate('window.__game.net.code'),null);
  record('uninvited menu discovers existing room',await guest.evaluate('document.getElementById("roomList").innerText'));
  fs.mkdirSync('tools/out',{recursive:true});
  const shot=await guest.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('tools/out/online-public-lobby.png',Buffer.from(shot.data,'base64'));
  await guest.evaluate("document.getElementById('btnRandomJoin').click()");
  await guest.wait(`window.__game.net.code===${JSON.stringify(code)}`);
  await host.wait('window.__game.net.peerRoom.players.size===2');
  record('random join enters room without invitation');
  await guest.evaluate("document.querySelector('#carGrid [data-key=car_orange]').click()");
  await host.wait("[...window.__game.net.peerRoom.players.values()].some(p=>p.charKey==='doubao'&&p.carFile==='car_orange')");
  record('selection synchronization');
  await host.evaluate("document.getElementById('btnOnline').click()");
  await guest.wait('window.__game.state.mode==="race"');
  assert.equal(await guest.evaluate('window.__game.race.player.id===window.__game.net.id'),true);
  assert.equal(await guest.evaluate('window.__game.race.player.charKey'),'doubao');
  record('client camera and controls belong to its own racer');
  await guest.wait('window.__game.race.phase==="running"');
  await guest.send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  await host.wait("window.__game.race.racers.some(r=>r.charKey==='doubao'&&r.v>3)");
  await guest.wait('window.__game.race.player.v>3');
  record('remote keyboard input and race snapshots',await guest.evaluate('({speed:window.__game.race.player.v,time:window.__game.race.time})'));
  await guest.send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  await host.wait('window.__game.net.rooms.some(r=>r.code===window.__game.net.code&&r.state==="racing")');
  record('started room advertised as racing');
  await guest.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await guest.evaluate("document.getElementById('btnPauseLeave').click()");
  await host.wait('window.__game.race.racers.length===4');
  record('departing guest removed from race');
  await guest.evaluate("document.getElementById('btnOnline').click()");
  await close(host);
  await guest.wait(`!window.__game.net.rooms.some(r=>r.code===${JSON.stringify(code)})`,25000);
  await guest.wait('!!window.__game.net.peerRoom.directory.coordinator',25000);
  record('directory failover after coordinator browser exits');
  await guest.evaluate("document.getElementById('btnCreateRoom').click()");
  const replacement=await guest.wait('window.__game.net.code&&window.__game.net.rooms.some(r=>r.code===window.__game.net.code)&&window.__game.net.code');
  const fresh=await page('/?online=1&char=nailong');
  await fresh.wait(`window.__game.net.rooms.some(r=>r.code===${JSON.stringify(replacement)})`);
  record('new browser discovers republished room',replacement);
  await fresh.evaluate(`document.querySelector('#roomList .rp-room').click()`);
  await fresh.wait(`window.__game.net.code===${JSON.stringify(replacement)}`);
  record('direct room-list join');
  await guest.evaluate("document.getElementById('btnLeaveMenu').click()");
  await fresh.wait('window.__game.net.code===null&&document.getElementById("roomPanel").hidden');
  record('host departure closes guest room');
  const failure=await page('/?online=1&ws=ws://127.0.0.1:18359');
  await failure.wait('!window.__game.net.connecting&&document.getElementById("btnOnline").textContent==="重新连接"');
  assert.equal(await failure.evaluate('document.getElementById("btnOnline").disabled'),false);
  record('failed connection releases retry button');
  for(const tab of pages)assert.deepEqual(tab.errors,[]);
  fs.writeFileSync('tools/out/online-verification.json',JSON.stringify(evidence,null,2));
}finally{
  for(const tab of pages){try{await close(tab);}catch{}}
}
