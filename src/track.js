/** Shared 3D arc-length geometry for road meshes, racers, items and minimaps. */
import { TRACK } from './config.js';
import { getMap, rememberedMap } from './maps.js';
export let ACTIVE_MAP=getMap(rememberedMap());
export let TRACK_LEN=0;
export let START_POINT={};
export let ITEM_GROUPS=[];
export let GAPS=[];
export const WAYPOINT_S=[];
export const SHORTCUT={s0:0,s1:0,halfWidth:2.4,offset:-3.6};
let nodes=[],heights=[],count=0;
const table=[],bridgeTable=[];
let bridgeLength=0,startFrame,endFrame;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=s=>{const q=s%TRACK_LEN;return q<0?q+TRACK_LEN:q;};
function curve(t){
  const j=Math.floor(t),f=t-j,n=nodes.length;
  const at=k=>{
    const v=i=>k===2?heights[(i+n)%n]:nodes[(i+n)%n][k];
    const a=v(j-1),b=v(j),c=v(j+1),d=v(j+2);
    return .5*(2*b+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f);
  };
  return {x:at(0),z:at(1),y:at(2)};
}
function frame(list,lo,hi,target,out={}){
  const a=list[lo],b=list[hi],f=clamp((target-a.s)/(b.s-a.s),0,1);
  const dx=b.x-a.x,dz=b.z-a.z,flat=Math.hypot(dx,dz);
  const tx=dx/flat,tz=dz/flat;
  return Object.assign(out,{x:a.x+dx*f,z:a.z+dz*f,y:a.y+(b.y-a.y)*f,tx,tz,ux:-tz,uz:tx,grade:(b.y-a.y)/flat});
}
function find(list,s){let lo=0,hi=list.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(list[m].s<=s)lo=m;else hi=m;}return [lo,hi];}
export function samplePath(s,out={}){
  s=wrap(s);const [lo,hi]=find(table,s);
  frame(table,lo,hi,s,out);
  const a=table[lo],b=table[hi],pre=table[(lo-2+count)%count],post=table[(hi+2)%count];
  const ax=a.x-pre.x,az=a.z-pre.z,bx=post.x-b.x,bz=post.z-b.z;
  const signed=Math.atan2(ax*bz-az*bx,ax*bx+az*bz)/Math.max(.001,(Math.hypot(ax,az)+Math.hypot(bx,bz))*.5+Math.hypot(b.x-a.x,b.z-a.z));
  return Object.assign(out,{kappa:Math.abs(signed),signedKappa:signed,outward:signed>0?-1:1,bank:clamp(-signed*2.5,-.15,.15),factor:1});
}
export function sampleRoute(s,route,out={}){
  const q=wrap(s);
  if(route!=='shortcut'||q<SHORTCUT.s0-1e-7||q>SHORTCUT.s1+1e-7)return samplePath(s,out);
  const f=clamp((q-SHORTCUT.s0)/(SHORTCUT.s1-SHORTCUT.s0),0,1),target=f*bridgeLength;
  const [lo,hi]=find(bridgeTable,target);frame(bridgeTable,lo,hi,target,out);
  return Object.assign(out,{kappa:0,signedKappa:0,outward:1,bank:startFrame.bank+(endFrame.bank-startFrame.bank)*f,factor:SHORTCUT.factor});
}
export function roadHeight(s,lat=0,route='main'){const p=sampleRoute(s,route);return p.y+lat*Math.tan(p.bank);}
export function gapAt(s,route='main'){const q=wrap(s);return GAPS.find(g=>g.route===route&&q>=g.start&&q<=g.end);}
export function setTrack(id){
  ACTIVE_MAP=getMap(id);nodes=ACTIVE_MAP.nodes;heights=ACTIVE_MAP.heights;count=nodes.length*120;
  Object.assign(TRACK,{mapId:ACTIVE_MAP.id,name:ACTIVE_MAP.name+' · '+ACTIVE_MAP.subtitle,grip:ACTIVE_MAP.grip});
  table.length=0;WAYPOINT_S.length=0;let length=0;
  for(let i=0;i<=count;i++){
    const p=curve(i/count*nodes.length),prev=table[i-1];
    if(prev)length+=Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z);
    table.push({...p,s:length});if(i%120===0)WAYPOINT_S.push(length);
  }
  TRACK_LEN=length;START_POINT={...table[0]};
  Object.assign(SHORTCUT,{s0:WAYPOINT_S[8],s1:WAYPOINT_S[11]});
  startFrame=samplePath(SHORTCUT.s0);endFrame=samplePath(SHORTCUT.s1);
  const endpoint=p=>({x:p.x+p.ux*SHORTCUT.offset,z:p.z+p.uz*SHORTCUT.offset,y:p.y+Math.tan(p.bank)*SHORTCUT.offset});
  const a=endpoint(startFrame),b=endpoint(endFrame);
  const c={x:a.x+startFrame.tx*18,z:a.z+startFrame.tz*18,y:a.y+startFrame.grade*18};
  const d={x:b.x-endFrame.tx*18,z:b.z-endFrame.tz*18,y:b.y-endFrame.grade*18};
  bridgeTable.length=0;bridgeLength=0;
  for(let i=0;i<=240;i++){
    const t=i/240,u=1-t,at=k=>u*u*u*a[k]+3*u*u*t*c[k]+3*u*t*t*d[k]+t*t*t*b[k];
    const p={x:at('x'),z:at('z'),y:at('y')+Math.sin(Math.PI*t)**2*(ACTIVE_MAP.id==='city'?3:5)};
    const prev=bridgeTable[i-1];if(prev)bridgeLength+=Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z);
    bridgeTable.push({...p,s:bridgeLength});
  }
  Object.assign(SHORTCUT,{length:bridgeLength,factor:bridgeLength/(SHORTCUT.s1-SHORTCUT.s0)});
  GAPS=[];
  if(id==='desert'){
    const span=WAYPOINT_S[7]-WAYPOINT_S[6];
    GAPS.push({id:'canyon-gap',name:'跨谷断桥',route:'main',start:WAYPOINT_S[6]+span*.26,end:WAYPOINT_S[6]+span*.46,minSpeed:16});
  }
  if(id==='ice'){
    const span=SHORTCUT.s1-SHORTCUT.s0;
    GAPS.push({id:'ice-gap',name:'冰桥飞跃',route:'shortcut',start:SHORTCUT.s0+span*.49,end:SHORTCUT.s0+span*.56,minSpeed:16});
  }
  ITEM_GROUPS=[.045,.15,.26,.38,.50,.64,.78,.93].map(f=>({s:f*TRACK_LEN}));
  return ACTIVE_MAP;
}
export function toWorld(s,lat,out={}){const p=samplePath(s,out);p.x+=p.ux*lat;p.z+=p.uz*lat;p.y+=lat*Math.tan(p.bank);return p;}
export function buildPolyline(step=.7){const n=Math.max(64,Math.ceil(TRACK_LEN/step));return {n,step:TRACK_LEN/n,pts:Array.from({length:n+1},(_,i)=>({...samplePath(i/n*TRACK_LEN),s:i/n*TRACK_LEN}))};}
export function curvatureAhead(s,look){let k=0;for(let d=0;d<=look;d+=2.5)k=Math.max(k,samplePath(s+d).kappa);return k;}
export function sdf(x,z){let best=Infinity,value=0;for(let i=0;i<count;i+=4){const p=table[i],d=Math.hypot(x-p.x,z-p.z);if(d<best){best=d;const q=samplePath(p.s);value=(x-p.x)*q.ux+(z-p.z)*q.uz;}}return value;}
export function sdfNormal(x,z,out={}){const dx=sdf(x+.1,z)-sdf(x-.1,z),dz=sdf(x,z+.1)-sdf(x,z-.1),l=Math.hypot(dx,dz)||1;return Object.assign(out,{x:dx/l,z:dz/l});}
export function buildItemBoxes(){const out=[];ITEM_GROUPS.forEach((g,gi)=>{for(const lane of (gi%2?[2,4]:[1,3,5])){const s=g.s,lat=(3-lane)*TRACK.laneW,p=toWorld(s,lat);if(gapAt(s))continue;out.push({id:`ib_${gi}_${lane}`,s,lat,x:p.x,z:p.z,baseY:p.y+.95,active:true,timer:0,item:gi===3&&lane===4?'jump':gi===5&&lane===4?'barrier':null});}});return out;}
export function scatterOutside(count,seed){const {pts,n}=buildPolyline(1.2),res=[];let st=seed>>>0;const rnd=()=>{st=(st*1664525+1013904223)>>>0;return st/4294967296;};for(let i=0;i<count;i++){const p=pts[Math.floor(rnd()*n)],side=rnd()<.62?1:-1,dist=TRACK.halfWidth+4+rnd()*16;res.push({x:p.x+p.ux*dist*side,z:p.z+p.uz*dist*side,scale:.7+rnd()*.85,rot:rnd()*Math.PI*2,rnd:rnd()});}return res;}
setTrack(ACTIVE_MAP.id);
