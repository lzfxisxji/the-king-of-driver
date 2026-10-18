export async function runGameplayChecks() {
 const {Race}=await import('/src/race.js');const {TRACK_LEN,SHORTCUT,samplePath,sampleRoute}=await import('/src/track.js');const {FEATURES,featureState}=await import('/src/course.js');
 const game=window.__game;const wasPaused=game.state.paused;game.state.paused=true;
 const roster=game.state._rosterAll;
 const fixtures=[];
 const checks=[],assert=(name,ok,data)=>{checks.push({name,ok:!!ok,data});if(!ok)console.warn(name,data);};
 const make=(all=false)=>{const r=new Race(all?roster:roster.slice(0,1),new THREE.Scene());r.phase='running';r.countdown=0;fixtures.push(r);return r;};
 const input={throttle:1,brake:0,steer:0,boost:false,drift:false,useItem:false};
 const step=(race,n,inp=input)=>{for(let i=0;i<n;i++)race.step(1/60,inp);};
 for(const s of [SHORTCUT.s0,SHORTCUT.s1]){const main=samplePath(s),branch=sampleRoute(s,'shortcut');assert('branch endpoint joins inner lane '+s.toFixed(0),Math.hypot(branch.x-main.x-main.ux*SHORTCUT.offset,branch.z-main.z-main.uz*SHORTCUT.offset)<.02);}
 let race=make(),p=race.player;p.s=SHORTCUT.s0-.1;p.lat=-3.6;p.v=20;step(race,1);assert('inner lane enters shortcut',p.route==='shortcut',p.route);let branchTime=0;
 while(p.route==='shortcut'&&branchTime<10){race.step(1/60,{...input,steer:Math.max(-1,Math.min(1,-p.lat*3))});branchTime+=1/60;}assert('shortcut merges within bounds',p.route==='main'&&Number.isFinite(p.x)&&p.lat>-6.4,{branchTime,lat:p.lat});assert('shortcut is physically shorter',SHORTCUT.factor<.98,SHORTCUT);
 race=make();p=race.player;p.s=SHORTCUT.s0-.1;p.lat=0;p.v=20;step(race,1);assert('center lane stays on main road',p.route==='main');
 race=make();p=race.player;p.s=90;p.lat=0;p.v=22;let curveS=0;for(let s=20;s<TRACK_LEN;s+=2)if(samplePath(s).kappa>.025){curveS=s;break;}
 for(let i=0;i<48;i++){p.s=curveS;p.lat=0;p.latV=0;race.step(1/60,{...input,steer:.4,drift:true});}const charge=p.driftCharge;race.step(1/60,input);assert('drift release awards mini boost',charge>.4&&p.miniBoost>.5,{charge,boost:p.miniBoost});
 race=make();p=race.player;p.s=30;p.v=22;step(race,60,{...input,steer:.2,drift:true});race.step(1/60,input);assert('straight drift cannot farm a boost',p.miniBoost===0,p.miniBoost);
 race=make();p=race.player;p.item='jump';race.fireItem(p);step(race,30);assert('jump reaches obstacle-clearing height',p.jumpY>2,p.jumpY);step(race,42);assert('landing returns to ground with boost',p.jumpY===0&&p.miniBoost>0,{y:p.jumpY,boost:p.miniBoost});
 race=make();p=race.player;p.s=40;p.lat=0;p.v=24;p.item='barrier';race.fireItem(p);const b=race.barriers[0];p.s=b.s;p.lat=b.lat;race.handleCourse(1/60);assert('placed barrier gives warning grace',p.v===24&&b.age<1.25,{v:p.v,age:b.age});b.age=2;p.lat=race.barrierState(b).lat;p.hazardCooldown=0;race.handleCourse(.01);assert('armed barrier slows a grounded car',p.v<20,p.v);
 p.v=24;p.jumpY=2;p.hazardCooldown=0;race.handleCourse(.01);assert('airborne car clears barrier',p.v===24,p.v);
 const ramp=FEATURES.find(f=>f.kind==='ramp');const rampRace=make();const rp=rampRace.player;rp.route='shortcut';rp.s=ramp.s;rp.lat=0;rampRace.handleCourse(0);assert('bridge center does not auto-clear the risk',rp.jumpTime===0);rp.lat=ramp.lat;rampRace.handleCourse(0);assert('aligning with ramp launches car',rp.jumpTime>0);
 const snap=race.serialize();const client=make();client.applySnapshot(snap);assert('snapshot preserves jump and barrier',client.player.jumpY===2&&client.barriers.length===1,{y:client.player.jumpY,barriers:client.barriers.length});
 race=make(true);p=race.player;p.isPlayer=false;p.isLocal=false;p.ai={...race.racers[1].ai,aggr:.9};let branches=new Set();for(let i=0;i<60*190;i++){race.step(1/60,input);for(const r of race.racers)if(r.route==='shortcut')branches.add(r.id);if(race.racers.every(r=>r.finished))break;}assert('all five cars finish three laps',race.racers.every(r=>r.finished),race.racers.map(r=>({id:r.id,finished:r.finished,s:r.s,v:r.v,lap:r.lap})));assert('finished cars do not reverse',race.racers.every(r=>r.v>=0));assert('AI uses alternate route',branches.size>0,[...branches]);assert('simulation remains finite',race.racers.every(r=>[r.s,r.lat,r.x,r.z,r.v].every(Number.isFinite)));
 for(const r of fixtures){for(const b of r.barriers||[]){b.mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}for(const p of r.racers)p.view.kart.dispose?.();}
 game.state.paused=wasPaused;return {checks,passed:checks.filter(c=>c.ok).length,total:checks.length,trackLength:TRACK_LEN};
}
