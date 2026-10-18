import { MAPS } from './maps.js';
/* ============================================================
   UI 层：选择页 / 匹配页 / HUD / 小地图 / 结算
   ============================================================ */
import { CHARACTERS, CARS, ITEMS, RULES, TRACK, carSize, driverMetrics } from './config.js';
import { IMG, makeInkSplat } from './assets.js';
import { createKart } from './kart3d.js';
import { samplePath, sampleRoute, SHORTCUT, ACTIVE_MAP, TRACK_LEN, GAPS, gapAt } from './track.js';

export const $ = (id) => document.getElementById(id);
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 道具图标（内联 SVG） ---------------- */
const ICONS = {
  jump:`<svg viewBox="0 0 64 64"><path d="M12 44Q32 2 52 44M24 16l8-9 8 9" fill="none" stroke="#20bd98" stroke-width="7" stroke-linecap="round"/><path d="M10 54h44" stroke="#187c69" stroke-width="6"/></svg>`,
  barrier:`<svg viewBox="0 0 64 64"><path d="M14 22v35M50 22v35" stroke="#334155" stroke-width="7"/><rect x="5" y="17" width="54" height="23" rx="3" fill="#ffac36"/><path d="M9 37l14-19m2 21 15-21m3 21 13-19" stroke="#28374a" stroke-width="6"/></svg>`,
  banana: `<svg viewBox="0 0 64 64"><path d="M10 16c6 26 24 36 42 30-6 12-22 16-34 8C6 46 4 28 10 16z" fill="#ffd63d" stroke="#b98a00" stroke-width="3" stroke-linejoin="round"/><path d="M12 15l-4-7 8 2z" fill="#7a5a00"/><circle cx="47" cy="14" r="4" fill="#f5c400" opacity=".6"/></svg>`,
  ink: `<svg viewBox="0 0 64 64"><path d="M32 6c10 14 20 22 20 32a20 20 0 11-40 0C12 28 22 20 32 6z" fill="#8b5cf6" stroke="#4c1d95" stroke-width="3"/><ellipse cx="25" cy="36" rx="6" ry="8" fill="#fff" opacity=".35"/></svg>`,
  potion: `<svg viewBox="0 0 64 64"><rect x="26" y="6" width="12" height="10" rx="3" fill="#c9a227" stroke="#7a5a00" stroke-width="2.5"/><path d="M24 16h16v8l8 14a14 14 0 01-12 22H28a14 14 0 01-12-22l8-14z" fill="#7ee787" stroke="#1f7a3a" stroke-width="3" stroke-linejoin="round"/><ellipse cx="26" cy="44" rx="5" ry="7" fill="#fff" opacity=".4"/></svg>`,
  bolt: `<svg viewBox="0 0 64 64"><path d="M36 4L14 36h14l-4 24 22-32H32z" fill="#5cd2ff" stroke="#0d5f8a" stroke-width="3" stroke-linejoin="round"/></svg>`,
  missile: `<svg viewBox="0 0 64 64"><path d="M32 4c5 11 5 18 5 24 6 2 11 7 11 14a11 11 0 11-22 0c0-7 5-12 11-14 0-6 0-13 5-24z" fill="#ff7a3c" stroke="#9c2b00" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="40" r="4" fill="#ffd9a0"/></svg>`,
  shield: `<svg viewBox="0 0 64 64"><path d="M32 5l22 8v16c0 16-10 26-22 30C20 55 10 45 10 29V13z" fill="#66e0ff" stroke="#0d6f9c" stroke-width="3" stroke-linejoin="round"/><path d="M32 16l11 4v11c0 8-5 13-11 16-6-3-11-8-11-16V20z" fill="#bff3ff" opacity=".7"/></svg>`,
};

function racerIcon(kind) { return ICONS[kind] || ''; }

/* ---------------- 选择页 ---------------- */
export const selection = { charKey: CHARACTERS[0].key, carFile: CARS[0].file, nick: 'winner', mapId:ACTIVE_MAP.id };
let selHook = null;   // 选择变化回调（联机时同步到房间，由 main.js 注入）
export function setSelectionHook(fn) { selHook = fn; }

export function buildSelectors() {
  const cg = $('charGrid');
  cg.innerHTML = '';
  CHARACTERS.forEach((ch) => {
    const el = document.createElement('div');
    el.className = 'card' + (ch.key === selection.charKey ? ' sel' : '');
    el.dataset.key = ch.key;
    el.innerHTML = `<span class="tag">${ch.tag}</span><span class="check">✓</span>
      <img src="./assets/chars/${ch.portrait}.png" alt="${ch.name}">
      <span class="nm">${ch.name}</span>`;
    el.onclick = () => {
      selection.charKey = ch.key;
      [...cg.children].forEach((c) => c.classList.toggle('sel', c.dataset.key === ch.key));
      refreshPreview();
      if (selHook) selHook();
    };
    cg.appendChild(el);
  });

  const kg = $('carGrid');
  kg.innerHTML = '';
  CARS.forEach((car) => {
    const el = document.createElement('div');
    el.className = 'card' + (car.file === selection.carFile ? ' sel' : '');
    el.dataset.key = car.file;
    el.innerHTML = `<span class="tag">${car.group}</span><span class="check">✓</span>
      <img src="./assets/cars/${car.file}.png" alt="${car.name}">
      <span class="nm">${car.name}</span>`;
    el.onclick = () => {
      selection.carFile = car.file;
      [...kg.children].forEach((c) => c.classList.toggle('sel', c.dataset.key === car.file));
      refreshPreview();
      if (selHook) selHook();
    };
    kg.appendChild(el);
  });
  refreshPreview();
}

let mapHook=null;
export function setMapSelectionHook(fn){mapHook=fn;}
function mapArtwork(map){
 const nodes=map.nodes,xs=nodes.map(p=>p[0]),zs=nodes.map(p=>p[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),k=Math.min(250/(maxX-minX),115/(maxZ-minZ));
 const pt=p=>[180+(p[0]-(minX+maxX)/2)*k,77+(p[1]-(minZ+maxZ)/2)*k];
 const path=nodes.map((b,i)=>{const a=nodes[(i-1+nodes.length)%nodes.length],c=nodes[(i+1)%nodes.length],d=nodes[(i+2)%nodes.length],p=pt(b),q=pt(c),c1=pt([b[0]+(c[0]-a[0])/6,b[1]+(c[1]-a[1])/6]),c2=pt([c[0]-(d[0]-b[0])/6,c[1]-(d[1]-b[1])/6]);return (i?'':'M'+p.join(','))+' C'+c1.join(',')+' '+c2.join(',')+' '+q.join(',');}).join(' ')+' Z';
 const elevated=nodes.map((b,i)=>{if((map.heights[i]+map.heights[(i+1)%nodes.length])/2<12)return '';const a=nodes[(i-1+nodes.length)%nodes.length],c=nodes[(i+1)%nodes.length],d=nodes[(i+2)%nodes.length],p=pt(b),q=pt(c),c1=pt([b[0]+(c[0]-a[0])/6,b[1]+(c[1]-a[1])/6]),c2=pt([c[0]-(d[0]-b[0])/6,c[1]-(d[1]-b[1])/6]),segment=`M${p} C${c1} ${c2} ${q}`;return `<path d="${segment}" fill="none" stroke="white" stroke-width="14"/><path d="${segment}" fill="none" stroke="${map.accent}" stroke-width="9"/>`;}).join('');
 const decor=map.id==='city'?'<g fill="#b5c8d7"><rect x="14" y="18" width="21" height="41"/><rect x="42" y="12" width="12" height="31"/><rect x="311" y="89" width="28" height="46"/><rect x="290" y="113" width="14" height="29"/></g>':map.id==='desert'?'<g fill="#bf8056"><path d="M0 80 22 35 45 40 69 80ZM282 155 306 109 335 102 360 155Z"/></g><circle cx="318" cy="28" r="16" fill="#ffdb98"/>':'<g fill="#9ac8d8"><path d="M0 71 30 12 67 71ZM275 155 318 87 360 155Z"/></g><g fill="#f6fdff"><path d="m19 33 11-21 14 23-13-7ZM306 107l12-20 13 21-13-7Z"/></g>';
 const b0=pt(nodes[8]),b1=pt(nodes[11]),sp=pt(nodes[0]);
 return `<svg viewBox="0 0 360 155" style="background:${map.id==='desert'?'#f1d0a4':map.id==='ice'?'#e1f2f5':'#e5edf3'}" aria-hidden="true"><rect width="360" height="155" fill="${map.id==='desert'?'#f1d0a4':map.id==='ice'?'#e1f2f5':'#e5edf3'}"/>${decor}<path d="${path}" fill="none" stroke="white" stroke-width="15"/><path d="${path}" fill="none" stroke="#465668" stroke-width="10"/><path d="${path}" fill="none" stroke="#c3d2dd" stroke-width=".9" stroke-dasharray="3 6"/>${elevated}<path d="M${b0} L${b1}" stroke="${map.accent}" stroke-width="3.5"/><circle cx="${sp[0]}" cy="${sp[1]}" r="4" fill="${map.accent}" stroke="white" stroke-width="2"/></svg>`;
}
export function buildMapSelectors(){
 const grid=$('mapGrid');grid.innerHTML='';
 MAPS.forEach((map,i)=>{const button=document.createElement('button');button.type='button';button.className='map-card';button.dataset.map=map.id;button.style.setProperty('--map-accent',map.accent);button.setAttribute('aria-label',map.name+'，'+map.tag);button.innerHTML=`<div class="map-art">${mapArtwork(map)}<span class="map-index">0${i+1}</span><span class="map-tick">✓</span></div><div class="map-copy"><div class="map-title">${map.name}<span>${map.difficulty}</span></div><div class="map-sub">${map.subtitle} · ${map.tag}</div><p>${map.description}</p></div>`;
 button.onclick=()=>{if(mapHook&&mapHook(map.id)===false)return;selection.mapId=map.id;refreshMapSelection();};grid.appendChild(button);});refreshMapSelection();
}
export function refreshMapSelection(){
 const map=MAPS.find(m=>m.id===selection.mapId)||MAPS[0];
 for(const b of $('mapGrid').children){const on=b.dataset.map===map.id;b.classList.toggle('sel',on);b.setAttribute('aria-pressed',String(on));}
 $('mapDetail').textContent='当前赛道：'+map.name+' · '+map.subtitle+' / 3 圈';
}
export function resetMinimap(){_mm.pts=null;_mm.tf=null;}

function currentChar() { return CHARACTERS.find((c) => c.key === selection.charKey) || CHARACTERS[0]; }
function currentCar() { return CARS.find((c) => c.file === selection.carFile) || CARS[0]; }

/* 预览舞台：每「世界单位」对应的像素数。
   这里刻意用和 src/race.js 完全相同的度量（carSize / driverMetrics），
   所以预览里「人坐进车」的组合比例与实际比赛画面必然一致，
   换车 / 换角色只换图片，尺寸与位置自动推导。

   选人界面固定用 **正面** 贴图（{key}_drive_front.png）：角色正对着玩家。
   比赛里用背面贴图（{key}_drive.png）：第三人称跟车视角看背影。
   两套贴图共用同一张 240x320 画布与同一套骨架，所以尺寸完全一致。 */
const PV_SCALE = 90;    // px / 世界单位（车身宽 1.95 → 约 176px）
const PV_GROUND = 24;   // 车轮着地线距舞台底部的像素

export function layoutPreview() {
  const ch = currentChar(), car = currentCar();
  const pc = $('pvChar'), pr = $('pvCar');
  if (!pc || !pr || !pc.naturalWidth || !pr.naturalWidth) return;   // 图还没解码完

  const carAR = pr.naturalHeight / pr.naturalWidth;     // 高 / 宽
  const box = carSize(carAR);
  const m = driverMetrics(carAR, pc.naturalHeight / pc.naturalWidth, ch.scale);

  pr.style.objectFit = 'fill';                          // 与 race.js 一样按世界尺寸拉伸
  pr.style.width = (box.w * PV_SCALE).toFixed(1) + 'px';
  pr.style.height = (box.h * PV_SCALE).toFixed(1) + 'px';
  pr.style.bottom = PV_GROUND + 'px';

  pc.style.width = (m.chW * PV_SCALE).toFixed(1) + 'px';
  pc.style.height = 'auto';
  pc.style.bottom = (PV_GROUND + m.seatY * PV_SCALE).toFixed(1) + 'px';

  if (typeof location !== 'undefined' && location.search.indexOf('pvdbg') >= 0) {
    console.log('[pvdbg] carNat=' + pr.naturalWidth + 'x' + pr.naturalHeight
      + ' chNat=' + pc.naturalWidth + 'x' + pc.naturalHeight
      + ' box=' + box.w.toFixed(3) + 'x' + box.h.toFixed(3)
      + ' ch=' + m.chW.toFixed(3) + 'x' + m.chH.toFixed(3)
      + ' carPx=' + pr.style.width + '/' + pr.style.height
      + ' chPx=' + pc.style.width + '/auto/' + pc.style.bottom
      + ' chBox=' + pc.clientWidth + 'x' + pc.clientHeight
      + ' carBox=' + pr.clientWidth + 'x' + pr.clientHeight);
  }
}

export function refreshPreview() {
  const ch = currentChar(), car = currentCar();
  rebuildPreviewKart(ch, car);
  const nm = $('pvName');
  if (nm) nm.textContent = `${ch.name} · ${car.name}`;
}

/* ---------------- 选角页 3D 预览（自动 360° 旋转，按视角切换正/侧/背精灵） ----------------
   复用与比赛完全相同的 createKart，所以选人看到的就是比赛里开的那台车。 */
let pv = null;     // { renderer, scene, cam, kart, angle, raf, last }
function initPreview() {
  if (pv && pv.renderer) return;
  const THREE = window.THREE;
  const canvas = $('pv3d');
  if (!canvas || !THREE) return;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { console.warn('预览渲染器创建失败', e); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  cam.position.set(0, 2.3, 4.6);
  cam.lookAt(0, 0.8, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb0c4, 0.95);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(3, 6, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.5);
  fill.position.set(-4, 3, -2); scene.add(fill);

  // 接触阴影
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 28),
    new THREE.MeshBasicMaterial({ color: 0x12304a, transparent: true, opacity: 0.16, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015;
  scene.add(shadow);

  pv = { renderer, scene, cam, kart: null, angle: 0.6, raf: 0, last: 0 };
  pvFrame();
}

function rebuildPreviewKart(ch, car) {
  initPreview();
  if (!pv || !pv.renderer) return;
  if (pv.kart) { pv.scene.remove(pv.kart.group); pv.kart.dispose(); }
  pv.kart = createKart({ style: car.style, model: car.model, bodyColor: car.bodyColor, accent: car.accent, charKey: ch.key });
  pv.scene.add(pv.kart.group);
}

function pvFrame(now) {
  if (!pv || !pv.renderer) return;
  pv.raf = requestAnimationFrame(pvFrame);
  const sel = document.getElementById('scr-select');
  if (!sel || !sel.classList.contains('on')) return;     // 仅选人页可见时渲染
  const canvas = pv.renderer.domElement;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
  if (w < 2 || h < 2) return;
  if (pv.renderer.domElement.width !== w * pv.renderer.getPixelRatio() ||
      pv.renderer.domElement.height !== h * pv.renderer.getPixelRatio()) {
    pv.renderer.setSize(w, h, false);
  }
  if (pv.cam.aspect !== w / h) { pv.cam.aspect = w / h; pv.cam.updateProjectionMatrix(); }
  const dt = pv.last ? Math.min(0.05, (now - pv.last) / 1000) : 0.016;
  pv.last = now || 0;
  pv.angle += dt * 0.55;                                  // 自动 360° 旋转
  const R = 4.6, H = 2.3;
  pv.cam.position.set(Math.sin(pv.angle) * R, H, Math.cos(pv.angle) * R);
  pv.cam.lookAt(0, 0.8, 0);
  if (pv.kart) { pv.kart.orientToCamera(pv.cam); pv.kart.update(dt); }
  pv.renderer.render(pv.scene, pv.cam);
}

/* ---------------- 匹配页 ---------------- */
export function initMatchScreen() {
  const wrap = $('matchSlots');
  wrap.innerHTML = '';
  for (let i = 0; i < RULES.racers; i++) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.id = 'slot' + i;
    wrap.innerHTML += '';
    wrap.appendChild(el);
  }
}

export function renderSlots(entries) {
  for (let i = 0; i < RULES.racers; i++) {
    const el = $('slot' + i);
    const e = entries[i];
    if (!e) {
      el.className = 'slot';
      el.innerHTML = `<div style="font-size:22px;opacity:.5">＋</div><div class="who">等待中</div>`;
      continue;
    }
    el.className = 'slot filled' + (e.isPlayer ? ' me' : '');
    const ch = CHARACTERS.find((c) => c.key === e.charKey) || CHARACTERS[0];
    el.innerHTML = `<img src="./assets/chars/${ch.portrait}.png" alt="">
      <div class="who">${e.name}</div>
      <div class="kind">${e.isPlayer ? '真人玩家' : 'AI 电脑'}</div>`;
  }
}

export function setMatchTimer(sec) {
  $('matchNum').textContent = Math.max(0, Math.ceil(sec));
  const p = (1 - sec / RULES.matchSeconds) * 100;
  $('matchRing').style.setProperty('--p', p.toFixed(1) + '%');
}

/* ---------------- HUD ---------------- */
let inkUrl = null;

export function initHUD() {
  inkUrl = makeInkSplat(7);
  $('ink').style.backgroundImage = `url(${inkUrl})`;
  const aim = $('aimLanes');
  aim.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const d = document.createElement('div');
    d.className = 'ln';
    d.id = 'aim' + i;
    d.textContent = i;
    aim.appendChild(d);
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function setCountdown(txt) {
  const el = $('countdown');
  if (!txt) { el.classList.remove('on'); el.textContent = ''; return; }
  if (el.textContent !== txt) {
    el.textContent = txt;
    el.classList.toggle('go', txt === 'GO!');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }
}

export function updateHUD(race, opts = {}) {
  const p = race.player;
  if (!p) return;
  $('rankNum').textContent = p.rank;
  $('hudLap').textContent = `圈数 ${p.lap}/${RULES.laps}`;

  // 前三名实时榜（仍在左上角）
  const t3 = $('hudTop3');
  if (t3 && race.standings) {
    const me = race.player;
    const n = Math.min(3, race.standings.length);
    let html = '';
    for (let i = 0; i < n; i++) {
      const r = race.standings[i];
      const isMe = me && r === me;
      const cls = `t3 p${i + 1}${isMe ? ' me' : ''}`;
      const name = escHtml(r.name || '');
      html += `<div class="${cls}"><span class="pos">${i + 1}</span><span class="nm">${name}${isMe ? '<span class="me-tag">你</span>' : ''}</span></div>`;
    }
    t3.innerHTML = html;
  }
  $('timeVal').textContent = fmtTime(race.time);
  $('stamNum').textContent = `${Math.round(p.stamina)} / 100`;
  const fill = $('stamFill');
  fill.style.width = (p.stamina / 100 * 100) + '%';
  $('hudStam').classList.toggle('boosting', p.boosting);
  $('spdVal').textContent = Math.round(Math.max(0, p.v) * 3.9);

  // 发车倒计时
  if (race.phase === 'countdown') {
    const n = Math.ceil(race.countdown);
    setCountdown(n > 1 ? String(n - 1) : 'GO!');
  } else if (race.time < 0.85) {
    setCountdown('GO!');
  } else {
    setCountdown(null);
  }

  const slot = $('hudItem');
  if (p.item) {
    slot.classList.add('has');
    $('itemPh').innerHTML = `${racerIcon(p.item)}`;
    $('itemKey').textContent = `${ITEMS[p.item].name} · E 使用`;
  } else {
    slot.classList.remove('has');
    $('itemPh').innerHTML = '暂无道具<br>撞蓝色 ? 获取';
    $('itemKey').textContent = '';
  }

  // 护盾状态徽标
  const sh = $('hudShield');
  if (sh) {
    if (p.shield > 0) {
      sh.classList.add('on');
      sh.textContent = `🛡 护盾 ${p.shield.toFixed(1)}s`;
    } else {
      sh.classList.remove('on');
    }
  }

  // 瞄准提示
  const progress=((p.s%TRACK_LEN)+TRACK_LEN)%TRACK_LEN;
  $('courseStatus').textContent=p.fallTime>0?'飞跃失败 · 正在返回起跳点':p.jumpY>.3?'腾空飞跃 · 落地冲刺':p.route==='shortcut'?ACTIVE_MAP.tips:progress>SHORTCUT.s0-35&&progress<SHORTCUT.s0?'前方分岔：内侧进入'+ACTIVE_MAP.branchName:ACTIVE_MAP.name+(ACTIVE_MAP.id==='ice'?' · 提前刹车，注意外滑':' · 主路补给');
  $('elevationInfo').textContent=(p.groundY>12?'高架层':p.groundY>5?'坡道层':'地面层')+' · 高度 '+Math.round(p.groundY||0)+' m'+(p.pitch<-.07?' · 正在爬升':p.pitch>.07?' · 俯冲下坡':'');
  $('driftFill').style.width=Math.min(100,(p.driftCharge||0)/1.6*100)+'%';
  $('driftLabel').textContent=p.miniBoost>0?'冲刺！':p.driftCharge>=.4?'松开 Shift 冲刺':p.drifting?'漂移蓄能中':'弯道 Shift + 转向 蓄能';
  const aiming = !!race.pendingUse;
  $('aim').classList.toggle('on', aiming);
  if (aiming) {
    for (let i = 1; i <= 5; i++) $('aim' + i).classList.toggle('sel', i === race.aimLane);
  }

  // 墨水 / 闪电闪白
  $('ink').classList.toggle('on', race.inkTimer > 0);
  $('flash').style.opacity = race.flashTimer > 0 ? Math.min(1, race.flashTimer * 2.4) : 0;
}

/* ---------------- 小地图（从真实赛道中心线数据绘制） ----------------
   赛道 = 圆角矩形环道（track.js 的 SEGS/samplePath），
   这里采样中心线折线，世界坐标 -> 画布坐标用同一套等比变换，
   保证圆点精确落在路面上。 */
const MM_W = 220, MM_H = 160, MM_PAD = 9;
const _mm = { pts: null, tf: null };
function mmBuild() {
  if (_mm.pts) return _mm;
  // 1) 采样真实中心线（路径点数据，非目视假设）
  const N = 260, pts = [];
  for (let i = 0; i <= N; i++) {
    const p = samplePath((i / N) * TRACK_LEN, {});
    pts.push([p.x, p.z, p.y, i/N*TRACK_LEN]);
  }
  // 2) 等比缩放：以赛道外缘范围（中心线矩形 + 半宽）fit 进画布
  const hw = TRACK.halfWidth;
  const minX=Math.min(...pts.map(p=>p[0]))-hw,maxX=Math.max(...pts.map(p=>p[0]))+hw,minZ=Math.min(...pts.map(p=>p[1]))-hw,maxZ=Math.max(...pts.map(p=>p[1]))+hw;
  const w=maxX-minX,h=maxZ-minZ;
  const k = Math.min((MM_W - MM_PAD * 2) / w, (MM_H - MM_PAD * 2 - 14) / h);
  _mm.pts = pts;
  _mm.tf = { k, hw, cx: MM_W / 2-(minX+maxX)/2*k, cy: (MM_H-14) / 2-(minZ+maxZ)/2*k };
  return _mm;
}
export function drawMinimap(race) {
  const c = $('mini');
  const g = c.getContext('2d');
  const { pts, tf } = mmBuild();
  const X = (x) => tf.cx + x * tf.k;
  const Y = (z) => tf.cy + z * tf.k;
  g.clearRect(0, 0, c.width, c.height);
  // 3) 赛道：浅色边线（路宽+2）打底，深灰路面盖中间
  const strokePath = () => {
    g.beginPath();
    g.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1]));
    g.closePath();
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  strokePath(); g.lineWidth = (tf.hw * 2 + 2.4) * tf.k;
  g.strokeStyle = 'rgba(214,231,255,.9)'; g.stroke();
  strokePath(); g.lineWidth = tf.hw * 2 * tf.k;
  g.strokeStyle = '#3a3f4b'; g.stroke();
  const layers=pts.slice(0,-1).map((p,i)=>({a:p,b:pts[i+1],y:(p[2]+pts[i+1][2])/2})).filter(p=>p.y>10).sort((a,b)=>a.y-b.y);
  for(const {a,b} of layers){g.beginPath();g.moveTo(X(a[0]),Y(a[1]));g.lineTo(X(b[0]),Y(b[1]));g.strokeStyle='#d8f6ff';g.lineWidth=4.8;g.stroke();g.strokeStyle='#50bfde';g.lineWidth=2.6;g.stroke();}
  g.beginPath();for(let i=0;i<=40;i++){const p=sampleRoute(SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*i/40,'shortcut');if(i)g.lineTo(X(p.x),Y(p.z));else g.moveTo(X(p.x),Y(p.z));}g.lineWidth=4;g.strokeStyle='#ffb340';g.stroke();
  for(const gap of GAPS){const a=sampleRoute(gap.start,gap.route),b=sampleRoute(gap.end,gap.route);g.beginPath();g.moveTo(X(a.x),Y(a.z));g.lineTo(X(b.x),Y(b.z));g.lineWidth=4;g.strokeStyle='#ff7965';g.stroke();}
  g.font='8px sans-serif';g.fillStyle='#cce7f3';g.fillText('蓝：高架   橙：近道   红：断桥',8,155);
  // 起终点线（黄色短线，跨路面）
  const sp = samplePath(0, {});
  g.beginPath();
  g.moveTo(X(sp.x - sp.ux * tf.hw), Y(sp.z - sp.uz * tf.hw));
  g.lineTo(X(sp.x + sp.ux * tf.hw), Y(sp.z + sp.uz * tf.hw));
  g.lineWidth = 2.5; g.lineCap = 'butt';
  g.strokeStyle = 'rgba(255,210,61,.95)'; g.stroke();
  // 4) 车手圆点：世界坐标经同一变换，直线/弯道都同步
  for (const r of race.racers) {
    const x = X(r.x), y = Y(r.z);
    if (!isFinite(x) || !isFinite(y)) continue;
    g.beginPath();
    g.arc(x, y, r.isPlayer ? 5 : 4, 0, 7);
    g.fillStyle = r.color;
    g.fill();
    g.lineWidth = r.isPlayer ? 2.4 : 1.8;
    g.strokeStyle = r.isPlayer ? '#ffffff' : 'rgba(255,255,255,.85)';
    g.stroke();
  }
}

/* ---------------- 结算 ---------------- */
export function showResult(race) {
  const list = $('resList');
  const me = race.player;
  list.innerHTML = '';
  const st = race.standings;
  st.forEach((r, i) => {
    const ch = CHARACTERS.find((c) => c.key === r.charKey) || CHARACTERS[0];
    const car = CARS.find((c) => c.file === r.carFile) || CARS[0];
    const row = document.createElement('div');
    row.className = 'res-row' + (r.isPlayer ? ' me' : '');
    const cls = i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : '';
    const tm = r.finished ? fmtTime(r.finishTime) : '<span class="live">比赛中…</span>';
    row.innerHTML = `<div class="p ${cls}">${i + 1}</div>
      <img class="car" src="./assets/cars/${car.file}.png" alt="">
      <div class="info">
        <img class="face" src="./assets/chars/${ch.portrait}.png" alt="">
        <span class="who">${r.name}<span class="k">${r.isPlayer ? '你' : 'AI'}</span></span>
      </div>
      <div class="tm${r.finished ? '' : ' live'}">${tm}</div>`;
    list.appendChild(row);
  });
  const myRank = me ? me.rank : 0;
  $('resTitle').textContent = myRank === 1 ? '🏆 冠军！' : `第 ${myRank} 名`;
  $('resSub').textContent = me && me.finished
    ? `完赛用时 ${fmtTime(me.finishTime)} · 共 ${RULES.laps} 圈`
    : (race.allFinished ? '全部车手完赛' : '其他车手仍在比赛中…');
}

/* ---------------- 杂项 ---------------- */
let toastTimer = 0;
export function toast(text, ms = 1100) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

export function showScreen(id) {
  ['scr-select', 'scr-match', 'scr-result', 'scr-preview'].forEach((s) => $(s).classList.toggle('on', s === id));
  $('hud').classList.toggle('on', id === 'hud');
}

export function setHUDVisible(on) { $('hud').classList.toggle('on', on); }

/* ---------------- 联机：菜单页房间面板 ----------------
   房间信息直接嵌在选人页顶部（roomPanel），选人换车随时可改。 */
export function renderLobby(m, isHost) {
  const code = $('rpCode');
  if (code) code.textContent = m.code || '----';
  const wrap = $('rpSlots');
  if (!wrap) return;
  wrap.innerHTML = '';
  const players = m.players || [];
  const MAX = 6;
  for (let i = 0; i < MAX; i++) {
    const el = document.createElement('div');
    const p = players[i];
    if (!p) {
      el.className = 'rp-slot empty';
      el.textContent = '等待中';
      wrap.appendChild(el);
      continue;
    }
    const ch = CHARACTERS.find((c) => c.key === p.charKey) || CHARACTERS[0];
    const car = CARS.find((c) => c.file === p.carFile) || CARS[0];
    el.className = 'rp-slot' + (p.isHost ? ' me' : '');
    el.innerHTML = `<img src="./assets/chars/${ch.portrait}.png" alt="">
      <div class="meta">
        <div class="who">${escHtml(p.name || '')}${p.isHost ? ' 👑' : ''}</div>
        <div class="k">${escHtml(car.name)}</div>
      </div>`;
    wrap.appendChild(el);
  }
  const hint = $('rpHint');
  if (hint) hint.textContent = isHost
    ? '你是房主 · 人齐后点「开始游戏」'
    : '已加入房间，等待房主开始…';
}

/* ---------------- 联机服务器连接状态 ----------------
   kind：'wait' 连接中 | 'ok' 已连接 | 'err' 连接失败 | '' 未知 */
export function setOnlineStatus(kind, text) {
  const el = $('onlineStatus');
  if (!el) return;
  el.classList.remove('ok', 'err', 'wait');
  if (kind) el.classList.add(kind);
  const s = el.querySelector('span');
  if (s) s.textContent = text;
}

/* ---------------- 房间列表（菜单页面板里的紧凑胶囊） ----------------
   最多展示 MAX_ROOMS 间；点击可进入的房间触发 onJoin(room)；自己的房间只做标记。 */
export const MAX_ROOMS_SHOWN = 10;
export function renderRooms(rooms, onJoin, myCode) {
  const wrap = $('roomList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const list = (rooms || []).slice(0, MAX_ROOMS_SHOWN);
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'rp-roomempty';
    d.textContent = '暂无公开房间，可以先创建一个';
    wrap.appendChild(d);
    return;
  }
  for (const r of list) {
    const full = (r.count | 0) >= (r.max | 0);
    const racing = r.state === 'racing';
    const busy = full || racing;
    const mine = myCode && r.code === myCode;
    const el = document.createElement('button');
    el.className = 'rp-room' + (busy ? ' busy' : '') + (mine ? ' mine' : '');
    el.innerHTML = mine
      ? `<b>${escHtml(r.code)}</b>本房间 · ${r.count}/${r.max}`
      : `<b>${escHtml(r.code)}</b>${escHtml(r.host||'玩家')} · ${r.count}/${r.max}${racing ? ' · 赛中' : full ? ' · 已满' : ' · 加入'}`;
    el.onclick = () => {
      if (mine) return;
      if (onJoin) onJoin(r, busy);
    };
    wrap.appendChild(el);
  }
}
