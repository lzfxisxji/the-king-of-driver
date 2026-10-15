/* Driving appearance sampled from the original character art. Coordinates are
   normalized to the portrait canvas; source PNGs are never changed. Polygons
   exclude the adjacent torso so each cutout contains only that character's hand. */
const APPEARANCE = {
  lulu: { body:'#ffda54', arm:'#f7cc43', hand:[[.034,.655],[.126,.624],[.169,.645],[.141,.725],[.115,.777],[.055,.752]], handSize:.155, width:.25 },
  kangaroo: { body:'#ffe66a', arm:'#ffdf59', hand:[[.012,.611],[.107,.591],[.140,.633],[.108,.699],[.047,.718],[.006,.681]], handSize:.160, width:.235 },
  nailong: { body:'#ffe36a', arm:'#ffda56', hand:[[.014,.609],[.123,.596],[.154,.632],[.113,.695],[.037,.691],[.003,.651]], handSize:.165, width:.26 },
  niulai: { body:'#e4ad36', arm:'#dfaa36', hand:[[.014,.724],[.104,.718],[.132,.762],[.096,.776],[.112,.819],[.064,.833],[.009,.799]], handSize:.160, width:.27, fur:true },
  doubao: { body:'#26282b', arm:'#f3bda9', hand:[[.017,.577],[.089,.576],[.116,.614],[.088,.631],[.087,.660],[.047,.671],[.001,.638]], handSize:.135, width:.205, sleeves:true },
  driver: { body:'#484e58', arm:'#484e58', hand:[[.015,.651],[.128,.645],[.156,.691],[.118,.747],[.069,.759],[.008,.718]], handSize:.145, width:.235 },
};
const cache = new Map();

export function driverAppearance(key) { return APPEARANCE[key] || APPEARANCE.driver; }

export function characterHandTexture(THREE, key, portrait) {
  if (cache.has(key)) return cache.get(key);
  if (!portrait) return null;
  const profile=driverAppearance(key), points=profile.hand;
  const left=Math.min(...points.map(p=>p[0])), top=Math.min(...points.map(p=>p[1]));
  const width=Math.max(...points.map(p=>p[0]))-left, height=Math.max(...points.map(p=>p[1]))-top;
  const canvas=document.createElement('canvas');
  canvas.height=192;canvas.width=Math.round(192*width*portrait.width/(height*portrait.height));
  const ctx=canvas.getContext('2d');
  ctx.beginPath();
  points.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo']((x-left)/width*canvas.width,(y-top)/height*canvas.height));
  ctx.closePath();ctx.clip();
  ctx.drawImage(portrait,left*portrait.width,top*portrait.height,width*portrait.width,height*portrait.height,0,0,canvas.width,canvas.height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const result={texture,aspect:canvas.width/canvas.height};cache.set(key,result);return result;
}

export function characterFurTexture(THREE, portrait) {
  // A small opaque patch of the original bull's shoulder provides its own fur.
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  canvas.getContext('2d').drawImage(portrait,portrait.width*.25,portrait.height*.43,portrait.width*.13,portrait.height*.12,0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
