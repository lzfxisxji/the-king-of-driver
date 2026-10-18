/** Local browser checks for 3D track geometry, render/collision agreement and gaps. */
export async function runElevationChecks(){
 const T=await import('/src/track.js'),C=await import('/src/course.js'),{Race}=await import('/src/race.js'),CFG=await import('/src/config.js'),{MAPS}=await import('/src/maps.js');
 const g=window.__game,checks=[],fixtures=[];const assert=(name,ok,data)=>checks.push({name,ok:!!ok,data});
 const roster=CFG.CHARACTERS.slice(0,1).map((ch,i)=>({id:'elevation-test',isPlayer:true,isLocal:true,name:'QA',charKey:ch.key,charBack:ch.back,charScale:ch.scale,carFile:CFG.CARS[0].file,color:'#ff842b'}));
 const make=()=>{const r=new Race(roster,new THREE.Scene());r.phase='running';r.countdown=0;fixtures.push(r);return r;};
 const input={throttle:1,brake:0,steer:0,boost:false,drift:false,useItem:false};
 const step=(r,n)=>{for(let i=0;i<n;i++)r.step(1/60,input);};
 const crossingPairs=pts=>{const out=[];for(let i=0;i<pts.length-1;i++)for(let j=i+20;j<pts.length-1;j++){
  const a=pts[i],b=pts[i+1],c=pts[j],d=pts[j+1];if(T.TRACK_LEN-(c.s-a.s)<35)continue;
  const ax=b.x-a.x,az=b.z-a.z,bx=d.x-c.x,bz=d.z-c.z,den=ax*bz-az*bx;if(Math.abs(den)<1e-8)continue;
  const ux=c.x-a.x,uz=c.z-a.z,t=(ux*bz-uz*bx)/den,v=(ux*az-uz*ax)/den;
  if(t>=0&&t<1&&v>=0&&v<1)out.push({s:a.s+(b.s-a.s)*t,other:c.s+(d.s-c.s)*v,clearance:Math.abs(a.y+(b.y-a.y)*t-c.y-(d.y-c.y)*v)});
 }return out;};
 for(const map of MAPS){
  document.querySelector(`[data-map="${map.id}"]`).click();
  const pts=T.buildPolyline(2).pts,range=Math.max(...pts.map(p=>p.y))-Math.min(...pts.map(p=>p.y));
  assert(map.id+' has substantial elevation',range>15,{range});
  const crossings=crossingPairs(pts);assert(map.id+' has real grade-separated crossings',crossings.length>0&&crossings.every(c=>c.clearance>7),crossings);
  const pairRoster=[roster[0],{...roster[0],id:'cross-other',isLocal:false}],pair=new Race(pairRoster,new THREE.Scene());fixtures.push(pair);pair.phase='running';pair.countdown=0;Object.assign(pair.racers[0],{s:crossings[0].s,v:20,lat:0});Object.assign(pair.racers[1],{s:crossings[0].other,v:20,lat:0});pair.racers[1].netInput.throttle=1;
  const solo=make();Object.assign(solo.player,{s:crossings[0].s,v:20,lat:0});step(solo,1);pair.step(1/60,input);
  assert(map.id+' crossing levels do not collide',Math.abs(pair.player.v-solo.player.v)<1e-6&&Math.abs(pair.racers[0].y-pair.racers[1].y)>7);
  assert(map.id+' smooth heights close at start line',Math.abs(T.samplePath(.001).y-T.samplePath(T.TRACK_LEN-.001).y)<.01);
  assert(map.id+' branch joins road in 3D',[T.SHORTCUT.s0,T.SHORTCUT.s1].every(s=>Math.abs(T.sampleRoute(s,'shortcut').y-T.roadHeight(s,T.SHORTCUT.offset))<.02));
  let race=make(),p=race.player;p.s=pts.reduce((a,b)=>a.y>b.y?a:b).s;p.lat=1;p.v=0;step(race,1);
  assert(map.id+' car rests on elevated road',Math.abs(p.y-T.roadHeight(p.s,p.lat,p.route))<1e-6&&p.y>15,{y:p.y});
  race.syncViews(1/60,0,g.camera);assert(map.id+' visual car agrees with road height',Math.abs(p.view.grp.position.y-p.y)<1e-6);
  assert(map.id+' item boxes follow road elevation',g.world.itemBoxes.every(b=>Math.abs(b.baseY-T.roadHeight(b.s,b.lat)-.95)<1e-6));
  g.world.update(0,7,7);assert(map.id+' moving hazards stay on their deck',C.FEATURES.every((f,i)=>{const st=C.featureState(f,7);return Math.abs(g.world.courseMeshes[i].position.y-T.roadHeight(f.s,st.lat,f.route))<.001;}));
  // Check actual triangles, independently of racer height sampling.
  g.scene.updateMatrixWorld(true);const ray=new THREE.Raycaster();let surfaces=0;
  for(const fraction of [.12,.21,.45,.7,.86]){const s=T.TRACK_LEN*fraction,q=T.samplePath(s);if(T.gapAt(s))continue;ray.set(new THREE.Vector3(q.x,q.y+1.2,q.z),new THREE.Vector3(0,-1,0));if(ray.intersectObjects(g.scene.children,true).some(hit=>Math.abs(hit.point.y-q.y-.02)<.055))surfaces++;}
  assert(map.id+' road mesh matches height sampler',surfaces>=3,surfaces);
  race=make();p=race.player;p.route='shortcut';p.s=(T.SHORTCUT.s0+T.SHORTCUT.s1)*.5;p.lat=0;step(race,1);p.item='banana';race.fireItem(p,3);const banana=race.bananas[0];
  assert(map.id+' banana remains on correct elevated branch',Math.abs(banana.mesh.position.y-T.roadHeight(banana.s,banana.lat,'shortcut'))<.001);
  p.item='barrier';race.fireItem(p);const barrier=race.barriers[0];race.positionBarrier(barrier);const state=race.barrierState(barrier);
  assert(map.id+' placed barrier follows elevated branch',Math.abs(barrier.mesh.position.y-T.roadHeight(barrier.s,state.lat,barrier.route))<.001);
  const client=make();client.applySnapshot(race.serialize());assert(map.id+' snapshot preserves vertical position',Math.abs(client.player.y-p.y)<.001&&Math.abs(client.player.pitch-p.pitch)<.001);
  document.getElementById('btnMapPreview').click();assert(map.id+' overview controls visible',document.getElementById('scr-preview').classList.contains('on')&&g.state.mode==='preview');document.getElementById('btnPreviewBack').click();assert(map.id+' overview returns to menu',g.state.mode==='select'&&document.getElementById('scr-select').classList.contains('on'));
  for(const gap of T.GAPS){
   const q=T.sampleRoute((gap.start+gap.end)/2,gap.route);g.scene.updateMatrixWorld(true);ray.set(new THREE.Vector3(q.x,q.y+.4,q.z),new THREE.Vector3(0,-1,0));assert(map.id+' gap has no hidden road triangles',!ray.intersectObjects(g.scene.children,true).some(hit=>Math.abs(hit.point.y-q.y)<.3));
   race=make();p=race.player;p.route=gap.route;p.s=gap.start-8/(gap.route==='shortcut'?T.SHORTCUT.factor:1);p.lat=0;p.v=23;let airborne=false;for(let i=0;i<120;i++){race.step(1/60,input);if(p.jumpY>.5)airborne=true;}
   assert(map.id+' fast approach clears gap',airborne&&p.s>gap.end&&p.recoveries===0,{s:p.s,airborne,recoveries:p.recoveries});
   race=make();p=race.player;p.route=gap.route;p.s=gap.start+.5;p.v=2;p.lat=0;step(race,47);
   assert(map.id+' slow miss returns to launch approach',p.recoveries===1&&p.s<gap.start&&p.fallY===0,{s:p.s,recoveries:p.recoveries});
   assert(map.id+' recovery cannot advance lap',p.lap===1);
  }
 }
 // Physical slope response, independent of appearance.
 const pts=T.buildPolyline(1).pts,up=pts.find(p=>p.grade>.15&&!T.gapAt(p.s)),down=pts.find(p=>p.grade<-.15&&!T.gapAt(p.s));
 const a=make(),b=make();Object.assign(a.player,{s:up.s,v:15,lat:0});Object.assign(b.player,{s:down.s,v:15,lat:0});step(a,1);step(b,1);assert('downhill accelerates more than uphill',b.player.v>a.player.v,{up:a.player.v,down:b.player.v});
 for(const r of fixtures){for(const p of r.racers)p.view.kart.dispose();for(const o of [...r.bananas,...r.missiles,...(r.barriers||[])])o.mesh?.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});}
 document.querySelector('[data-map="city"]').click();return {passed:checks.filter(c=>c.ok).length,total:checks.length,checks};
}
