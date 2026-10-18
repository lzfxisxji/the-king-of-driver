/** Run in the local menu: await (await import('/tools/map-checks.js')).runMapChecks() */
export async function runMapChecks(){
 const T=await import('/src/track.js'),C=await import('/src/course.js'),{MAPS}=await import('/src/maps.js'),{Race}=await import('/src/race.js'),{TRACK}=await import('/src/config.js');
 const g=window.__game,checks=[],maps=[];const assert=(name,ok,data)=>checks.push({name,ok:!!ok,data});
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const exit=()=>{g.state.paused=false;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));document.getElementById('btnPauseLeave').click();};
 const rosterChoices=await import('/src/ui.js');const picked={char:rosterChoices.selection.charKey,car:rosterChoices.selection.carFile};
 for(const map of MAPS){
  document.querySelector(`[data-map="${map.id}"]`).click();
  assert(map.id+' card switches actual course',T.ACTIVE_MAP.id===map.id&&document.querySelector('.map-card.sel').dataset.map===map.id);
  assert(map.id+' selection preserves character and car',rosterChoices.selection.charKey===picked.char&&rosterChoices.selection.carFile===picked.car);
  assert(map.id+' stores map preference',localStorage.getItem('kart-map')===map.id);
  assert(map.id+' replaces scenery without stacking roots',g.scene.children.length===1,g.scene.children.length);
  for(let i=0;i<=100;i++){const p=T.samplePath(T.TRACK_LEN*i/100);if(![p.x,p.z,p.kappa,p.tx,p.tz].every(Number.isFinite))throw new Error('Invalid '+map.id+' geometry');}
  assert(map.id+' shortcut joins both main-road endpoints',[T.SHORTCUT.s0,T.SHORTCUT.s1].every(s=>{const a=T.samplePath(s),b=T.sampleRoute(s,'shortcut');return Math.hypot(b.x-a.x-a.ux*T.SHORTCUT.offset,b.z-a.z-a.uz*T.SHORTCUT.offset)<.02;}));
  document.getElementById('btnStart').click();g.state.matchT=0;
  for(let i=0;i<50&&!g.race;i++)await wait(100);
  assert(map.id+' practice starts selected map',g.race&&T.ACTIVE_MAP.id===map.id&&g.race.itemBoxes===g.world.itemBoxes);
  g.state.paused=true;
  const roster=g.state._rosterAll.map(r=>({...r,isPlayer:false,isLocal:false}));const scene=new THREE.Scene();const r=new Race(roster,scene,{world:{itemBoxes:[]}});r.phase='running';r.countdown=0;
  let usesBranch=false;for(let i=0;i<60*260;i++){r.step(1/60,{throttle:0,brake:0,steer:0,boost:false,useItem:false});if(r.racers.some(p=>p.route==='shortcut'))usesBranch=true;if(r.racers.every(p=>p.finished))break;}
  assert(map.id+' five AI cars finish three laps',r.racers.every(p=>p.finished),r.racers.map(p=>({lap:p.lap,finished:p.finished,s:p.s})));
  assert(map.id+' AI uses shortcut',usesBranch);
  assert(map.id+' all racer state remains finite',r.racers.every(p=>[p.s,p.lat,p.v,p.x,p.z].every(Number.isFinite)));
  maps.push({id:map.id,length:T.TRACK_LEN,grip:TRACK.grip,finishTime:r.time,features:C.FEATURES.map(f=>f.kind),boxes:g.world.itemBoxes.length});
  for(const p of r.racers)p.view.kart.dispose();
  for(const b of r.barriers||[])b.mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  exit();assert(map.id+' exits to menu with map retained',g.state.mode==='select'&&g.race===null&&T.ACTIVE_MAP.id===map.id);
 }
 assert('three maps have distinct circuit lengths',new Set(maps.map(m=>m.length.toFixed(1))).size===3);
 assert('ice course has lower grip than city and desert',maps[2].grip<maps[0].grip&&maps[0].grip<maps[1].grip);
 document.querySelector('[data-map="city"]').click();
 return {passed:checks.filter(c=>c.ok).length,total:checks.length,checks,maps};
}
