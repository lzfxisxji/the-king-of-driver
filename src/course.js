/* Shared course obstacles: visible geometry and collision use the same clock/data. */
import { TRACK_LEN, SHORTCUT, ACTIVE_MAP, GAPS, sampleRoute, roadHeight } from './track.js';
export let FEATURES=[];
export function configureCourse(){
FEATURES=[
 {id:'pad',kind:'pad',s:TRACK_LEN*.16,lat:3.4,width:2.5,route:'main'},
 {id:'cones',kind:'gate',s:TRACK_LEN*.30,lat:0,width:2.6,route:'main'},
 {id:'ramp',kind:'ramp',s:SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*.34,lat:-1.25,width:1.5,route:'shortcut'},
 {id:'bridge-gate',kind:'gate',s:SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*.57,lat:0,width:2,route:'shortcut'},
 {id:'pad2',kind:'pad',s:TRACK_LEN*.73,lat:-3.4,width:2.5,route:'main'},
 ];
 if(ACTIVE_MAP.id==='desert')FEATURES=[
  {id:'sand-pad1',kind:'pad',s:TRACK_LEN*.07,lat:0,width:3.4,route:'main'},
  {id:'sand-ramp',kind:'ramp',s:TRACK_LEN*.125,lat:3.5,width:2.4,route:'main'},
  {id:'sand-pad2',kind:'pad',s:TRACK_LEN*.39,lat:-3.4,width:3,route:'main'},
  {id:'ramp',kind:'ramp',s:SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*.35,lat:0,width:3.8,route:'shortcut'},
  {id:'sand-pad3',kind:'pad',s:TRACK_LEN*.82,lat:0,width:3.4,route:'main'},
 ];
 if(ACTIVE_MAP.id==='ice')FEATURES=[
  {id:'ice-pad',kind:'pad',s:TRACK_LEN*.06,lat:0,width:2.8,route:'main'},
  {id:'ice-gate',kind:'gate',s:TRACK_LEN*.37,lat:0,width:2.2,route:'main'},
  {id:'ramp',kind:'ramp',s:SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*.32,lat:-1.25,width:1.5,route:'shortcut'},
  {id:'bridge-gate',kind:'gate',s:SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*.59,lat:0,width:2.3,route:'shortcut'},
  {id:'ice-pad2',kind:'pad',s:TRACK_LEN*.91,lat:-3.4,width:2.6,route:'main'},
 ];
 for(const gap of GAPS){const factor=gap.route==='shortcut'?SHORTCUT.factor:1;FEATURES.push({id:gap.id+'-launch',kind:'ramp',s:gap.start-2.8/factor,lat:0,width:gap.route==='shortcut'?4.8:13.9,route:gap.route,gap:true});}
}
configureCourse();
export function featureState(f,time) {
 const phase=((time+(f.id==='bridge-gate'?1:0))%5+5)%5;
 return {...f,lat:f.lat+(f.kind==='gate'?Math.sin(time*1.25)*(f.route==='shortcut'?1.15:3.5):0),armed:f.kind!=='gate'||phase>=1.3,warning:f.kind==='gate'&&phase<1.3};
}
export function createCourseMesh(f) {
 const g=new THREE.Group(), color=f.kind==='ramp'?0x43d9c0:f.kind==='pad'?0x50c8ff:0xffa52e;
 const mat=new THREE.MeshLambertMaterial({color,emissive:color,emissiveIntensity:.18});
 const deck=new THREE.Mesh(new THREE.BoxGeometry(f.width,f.kind==='gate'?.95:.13,f.kind==='ramp'?4:1.35),mat);
 deck.position.y=f.kind==='gate'?.52:.12;g.add(deck);
 for(let x=-f.width/2+.25;x<f.width/2;x+=.65){
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(.27,.025,1.15),new THREE.MeshBasicMaterial({color:f.kind==='gate'?0x172236:0xffffff}));
  stripe.position.set(x,f.kind==='gate'?1.01:.20,0);g.add(stripe);
 }
 if(f.kind==='gate'){
   g.children.forEach(m=>m.userData.baseY=m.position.y);
   const warning=new THREE.Mesh(new THREE.BoxGeometry(f.width+.5,.025,2.9),new THREE.MeshBasicMaterial({color:0xff9c23,transparent:true,opacity:.6,depthWrite:false}));warning.position.y=.07;warning.name='warning';g.add(warning);
 }
 if(f.kind==='ramp'){deck.rotation.x=-.13;deck.position.y=.30;}
 const p=sampleRoute(f.s,f.route);g.position.set(p.x+p.ux*f.lat,roadHeight(f.s,f.lat,f.route),p.z+p.uz*f.lat);g.rotation.order='YXZ';g.rotation.x=-Math.atan(p.grade);g.rotation.y=Math.atan2(p.ux,p.uz)+Math.PI/2;
 return g;
}
export function positionCourseMesh(mesh,f,time) {
 const st=featureState(f,time),p=sampleRoute(f.s,f.route);
 mesh.position.set(p.x+p.ux*st.lat,roadHeight(f.s,st.lat,f.route),p.z+p.uz*st.lat);
 if(f.kind==='gate')setGateVisual(mesh,st.armed,time);
}

export function setGateVisual(mesh,armed,time){
 for(const m of mesh.children){if(m.name==='warning'){m.visible=!armed;m.material.opacity=.35+.3*Math.abs(Math.sin(time*10));}else m.position.y=m.userData.baseY-(armed?0:.96);}
 mesh.children[0].material.emissiveIntensity=armed?.12:.6;
}
