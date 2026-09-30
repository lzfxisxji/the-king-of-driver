/* ============================================================
   资源加载 + 程序化贴图（沥青赛道 / 路肩 / 草地 / 道具箱 / 光晕 ...）
   ============================================================ */
import { CHARACTERS, CARS } from './config.js';

export const IMG = {};      // HTMLImageElement
export const TEX = {};      // THREE.Texture

function loadImage(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { console.warn('图片缺失:', url); res(null); };
    im.src = url;
  });
}

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function seeded(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 沥青赛道条带 ----------------
   横向(v) 映射整条赛道宽度，纵向(u) 沿赛道平铺  */
function roadCanvas() {
  const W = 512, H = 512;
  const c = cv(W, H), g = c.getContext('2d');
  const rnd = seeded(7);
  g.fillStyle = '#4a4f58';
  g.fillRect(0, 0, W, H);
  // 细颗粒
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * W, y = rnd() * H;
    const v = 60 + rnd() * 60;
    g.fillStyle = `rgba(${v},${v + 4},${v + 10},${0.10 + rnd() * 0.16})`;
    g.fillRect(x, y, 1 + rnd() * 1.7, 1 + rnd() * 1.7);
  }
  // 大块深浅
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, r = 40 + rnd() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.030)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // 边缘白实线
  g.fillStyle = 'rgba(238,240,245,0.92)';
  g.fillRect(W * 0.022, 0, 5, H);
  g.fillRect(W * 0.978 - 5, 0, 5, H);
  // 4 条车道虚线
  for (let k = 1; k <= 4; k++) {
    const x = (k / 5) * W;
    let y = 0;
    while (y < H) {
      g.fillStyle = 'rgba(240,242,248,0.85)';
      g.fillRect(x - 2.5, y, 5, 32);
      y += 66;
    }
  }
  return c;
}

/* ---------------- 路肩（红白块，沿赛道交替） ---------------- */
function kerbCanvas() {
  const W = 64, H = 64;
  const c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#e8353f'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f6f7fb'; g.fillRect(0, 0, W, H / 2);
  g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, H / 2 - 2, W, 2);
  return c;
}

/* ---------------- 草地 ---------------- */
function grassCanvas() {
  const W = 512, H = 512;
  const c = cv(W, H), g = c.getContext('2d');
  const rnd = seeded(19);
  g.fillStyle = '#4f9b4a';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 34; i++) {
    const x = rnd() * W, y = rnd() * H, r = 50 + rnd() * 150;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rnd() < 0.5 ? 'rgba(120,190,90,0.30)' : 'rgba(46,110,58,0.30)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W, y = rnd() * H;
    const l = 2 + rnd() * 4;
    g.strokeStyle = `rgba(${40 + rnd() * 90},${120 + rnd() * 90},${40 + rnd() * 60},${0.25 + rnd() * 0.35})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y - l); g.stroke();
  }
  return c;
}

/* ---------------- 蓝色 "?" 道具箱 ---------------- */
function itemBoxCanvas() {
  const S = 256;
  const c = cv(S, S), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#8ceaff');
  grd.addColorStop(0.45, '#2f9dfb');
  grd.addColorStop(1, '#1c5fd6');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // 玻璃高光
  g.fillStyle = 'rgba(255,255,255,0.30)';
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(S * 0.62, 0); g.lineTo(S * 0.26, S); g.lineTo(0, S);
  g.closePath(); g.fill();
  // 边框
  g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 13;
  g.strokeRect(7, 7, S - 14, S - 14);
  // ?
  g.font = 'bold 168px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 16; g.strokeStyle = 'rgba(10,40,90,0.75)';
  g.strokeText('?', S / 2, S / 2 + 10);
  g.fillStyle = '#ffffff';
  g.fillText('?', S / 2, S / 2 + 10);
  return c;
}

/* ---------------- 光晕（加色混合） ---------------- */
function glowCanvas(inner, outer) {
  const S = 128;
  const c = cv(S, S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return c;
}

/* ---------------- 圆形软阴影（贴地） ---------------- */
function blobCanvas() {
  const S = 128;
  const c = cv(S, S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.30)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return c;
}

/* ---------------- 起终点格纹 ---------------- */
function checkerCanvas() {
  const S = 64;
  const c = cv(S, S), g = c.getContext('2d');
  g.fillStyle = '#f7f8fc'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#20242c';
  g.fillRect(0, 0, S / 2, S / 2);
  g.fillRect(S / 2, S / 2, S / 2, S / 2);
  return c;
}

/* ---------------- 弯道指示牌 ---------------- */
function chevronCanvas() {
  const W = 160, H = 120;
  const c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#f5b825'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2a2110'; g.lineWidth = 8; g.strokeRect(5, 5, W - 10, H - 10);
  g.fillStyle = '#221d12';
  for (let i = 0; i < 2; i++) {
    const x = 28 + i * 52;
    g.beginPath();
    g.moveTo(x, 22); g.lineTo(x + 42, 60); g.lineTo(x, 98);
    g.lineTo(x + 16, 60); g.closePath(); g.fill();
  }
  return c;
}

/* ---------------- 氮气焰 ---------------- */
function flameCanvas() {
  const S = 128;
  const c = cv(S, S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,232,140,0.95)');
  grd.addColorStop(0.5, 'rgba(255,140,40,0.55)');
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return c;
}

/* ---------------- 观众席人群（分层看台 + 人头） ---------------- */
function crowdCanvas() {
  const W = 256, H = 96;
  const c = cv(W, H), g = c.getContext('2d');
  const rnd = seeded(41);
  const pal = ['#ef6f6c', '#f4b942', '#59b7f0', '#7cd68a', '#c98bf0', '#f7f3ea', '#5a6270', '#ffd6a5'];
  g.fillStyle = '#5c6577'; g.fillRect(0, 0, W, H);
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const y0 = (r / rows) * H, y1 = ((r + 1) / rows) * H;
    g.fillStyle = r % 2 ? '#4e5766' : '#5a6373';
    g.fillRect(0, y0, W, y1 - y0);
    g.fillStyle = 'rgba(18,24,36,.55)';
    g.fillRect(0, y1 - 2.5, W, 2.5);
    const n = 38;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5 + rnd() * 0.6) * (W / n);
      const yy = y0 + (y1 - y0) * 0.52 + rnd() * 2.2;
      g.fillStyle = pal[(rnd() * pal.length) | 0];
      g.beginPath(); g.arc(x, yy, 2.5 + rnd() * 1.9, 0, 7); g.fill();
    }
  }
  return c;
}

function toTexture(canvas, repeatX, repeatY, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeatX) t.repeat.set(repeatX, repeatY);
  if (srgb && THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------------- 入口 ---------------- */
export async function loadAssets(base = '.') {
  const jobs = [];
  for (const ch of CHARACTERS) {
    jobs.push(loadImage(`${base}/assets/chars/${ch.portrait}.png`).then((im) => { IMG['ch_' + ch.key + '_p'] = im; }));
    jobs.push(loadImage(`${base}/assets/chars/${ch.back}.png`).then((im) => { IMG['ch_' + ch.key + '_b'] = im; }));
    // 驾驶位贴图：只有「头 + 肩 + 一点胸」的上半身（无方向盘 / 无双手）
    //   _drive       = 背面，比赛第三人称跟车视角用
    //   _drive_front = 正面，选人界面「角色正对玩家」用
    jobs.push(loadImage(`${base}/assets/chars/${ch.key}_drive.png`).then((im) => { IMG['ch_' + ch.key + '_drive'] = im; }));
    jobs.push(loadImage(`${base}/assets/chars/${ch.key}_drive_front.png`).then((im) => { IMG['ch_' + ch.key + '_drive_front'] = im; }));
  }
  for (const car of CARS) {
    jobs.push(loadImage(`${base}/assets/cars/${car.file}.png`).then((im) => { IMG['car_' + car.file] = im; }));
  }
  jobs.push(loadImage(`${base}/素材/map.png`).then((im) => { IMG.map = im; }));
  await Promise.all(jobs);

  TEX.road = toTexture(roadCanvas(), 1, 1);
  TEX.kerb = toTexture(kerbCanvas(), 1, 1);
  TEX.grass = toTexture(grassCanvas(), 60, 34);
  TEX.itembox = toTexture(itemBoxCanvas(), 1, 1);
  TEX.blob = toTexture(blobCanvas(), 1, 1);
  TEX.checker = toTexture(checkerCanvas(), 1, 1);
  TEX.chevron = toTexture(chevronCanvas(), 1, 1);
  TEX.flame = toTexture(flameCanvas(), 1, 1);
  TEX.crowd = toTexture(crowdCanvas(), 1, 1);
  TEX.glowCyan = toTexture(glowCanvas('rgba(190,245,255,0.95)', 'rgba(60,170,255,0.45)'), 1, 1);
  TEX.glowWarm = toTexture(glowCanvas('rgba(255,246,214,0.95)', 'rgba(255,196,90,0.42)'), 1, 1);

  // 非重复贴图
  for (const k of ['itembox', 'blob', 'flame', 'glowCyan', 'glowWarm']) {
    TEX[k].wrapS = TEX[k].wrapT = THREE.ClampToEdgeWrapping;
  }

  /* 小地图底图（把 map.png 缩到合适尺寸并稍微压暗） */
  if (IMG.map) {
    const mw = 460, mh = Math.round(mw * IMG.map.height / IMG.map.width);
    const c = cv(mw, mh), g = c.getContext('2d');
    g.drawImage(IMG.map, 0, 0, mw, mh);
    g.fillStyle = 'rgba(10,16,26,0.28)';
    g.fillRect(0, 0, mw, mh);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    TEX.minimap = t;
    IMG.minimapCanvas = c;
  }
}

/* 生成墨水遮挡图（HUD 用）：全屏均匀散布中小墨点，保留可透视缺口，不糊死视野中心 */
export function makeInkSplat(seed = 3) {
  const S = 512;
  const c = cv(S, S), g = c.getContext('2d');
  const rnd = seeded(seed);
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(15,10,24,0.90)';
  const blob = (x, y, r, lobes, jit) => {
    g.beginPath();
    for (let k = 0; k <= lobes; k++) {
      const th = (k / lobes) * Math.PI * 2;
      const rr = r * (1 - jit + rnd() * jit * 2);
      const px = x + Math.cos(th) * rr, py = y + Math.sin(th) * rr;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  };
  // 主体墨点：绕开正中心一段距离，确保车前方有可视缺口
  let placed = 0, guard = 0;
  while (placed < 27 && guard++ < 600) {
    const x = 34 + rnd() * (S - 68);
    const y = 28 + rnd() * (S - 56);
    if (Math.hypot(x - S * 0.5, y - S * 0.5) < 86) continue;
    blob(x, y, 20 + rnd() * 24, 22, 0.14);
    placed++;
  }
  // 少量中心小血斑，保证中心也不是完全空白，但不影响观察
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 70;
    blob(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, 9 + rnd() * 10, 18, 0.2);
  }
  // 四周零散溅点
  for (let i = 0; i < 54; i++) {
    const x = 12 + rnd() * (S - 24);
    const y = 12 + rnd() * (S - 24);
    if (Math.hypot(x - S * 0.5, y - S * 0.5) < 42) continue;
    g.beginPath();
    g.arc(x, y, 2.5 + rnd() * 9, 0, 7);
    g.fill();
  }
  return c.toDataURL('image/png');
}
