/* ============================================================
   路人之王 · 游戏内程序化 3D 赛车
   ------------------------------------------------------------
   用途：比赛视图（Race.makeView）与选角页 3D 预览（ui.js）共用。
   设计要点：
   - 直接用全局 window.THREE，不依赖 importmap / addons（网络稳健，
     不会因 unpkg 抖动而整页崩）。圆角几何用核心 THREE 自实现。
   - 角色贴图来自 IMG：正 _drive_front / 侧 _2 的统一头肩裁切 / 背 _drive
   - 手部来自各角色原立绘的独立裁区，身体/手臂按角色配色。
   - 车头朝 +Z，上 +Y，右 +X；整体缩放 1.0 时轮胎恰好着地（y=0）。
   createKart(opts) -> { group, wheels, driver, setSteer, setBoost,
     setRoll, setLean, setDriver, orientToCamera, update }
   ============================================================ */
import { IMG, TEX } from './assets.js';
import { driverAppearance, characterHandTexture, characterFurTexture } from './driver-appearance.js';

const THREE = window.THREE;   // 入口 main.js 已先把 three 挂在 window 上，再动态 import 本模块

// Shared across racers and preview rebuilds; released only with the document.
const driverTextures = new Map();

function sidePortrait(img) {
  if (!img) return null;
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, src.width, src.height).data;
  let l = src.width, r = 0, top = src.height, bottom = 0;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (pixels[(y * src.width + x) * 4 + 3] < 32) continue;
    l = Math.min(l, x); r = Math.max(r, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (r < l) return null;
  const w = r - l + 1, h = Math.min(bottom - top + 1, w * 0.90);
  const dst = document.createElement('canvas'); dst.width = 240; dst.height = 320;
  const scale = Math.min(240 * 0.88 / w, 320 * 0.78 / h);
  const dw = w * scale, dh = h * scale;
  dst.getContext('2d').drawImage(src, l, top, w, h, (240 - dw) / 2, Math.min(320, 320 * 0.74 + dh * 0.20) - dh, dw, dh);
  return dst;
}

function texFromImg(img) {
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.needsUpdate = true;
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------------- 圆角长方体（核心 THREE，无 addon） ----------------
   用 ExtrudeGeometry 把「圆角矩形截面」沿 Y 拉伸，并用 bevel 把上下两端也磨圆，
   得到 12 条棱都倒角的长方体，消除方块切角感。 */
function roundedRectShape(w, h, r) {
  r = Math.min(r, Math.min(w, h) / 2 - 1e-3);
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedBoxGeometry(w, h, d, r, seg = 4) {
  r = Math.min(r != null ? r : Math.min(w, h, d) * 0.22, Math.min(w, h, d) / 2 - 1e-3);
  const shape = roundedRectShape(w, d, r);     // 截面：X=w，Y=d
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h, bevelEnabled: true, bevelThickness: r, bevelSize: r,
    bevelSegments: seg, steps: 1, curveSegments: 10,
  });
  geo.rotateX(-Math.PI / 2);          // 拉伸轴(Z) → 世界 Y（竖直）
  geo.translate(0, -h / 2, 0);        // 居中到 Y=0
  return geo;
}

export function createKart(opts = {}) {
  const THREE = window.THREE;
  const style     = opts.style || 'sport';
  const aero = style === 'aero';
  const red = opts.model === 'red';
  const orange = opts.model === 'orange';
  const bodyColor = new THREE.Color(opts.bodyColor || '#eef2f7');
  const accent    = new THREE.Color(opts.accent   || '#ff6a3d');
  const tireColor = new THREE.Color(opts.tireColor || '#23262e');

  const group = new THREE.Group();

  const matBody   = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.08 });
  const matAccent = new THREE.MeshStandardMaterial({ color: accent,    roughness: 0.35, metalness: 0.18 });
  const matDark   = new THREE.MeshStandardMaterial({ color: 0x2a2f3a,  roughness: 0.55, metalness: 0.0  });
  const matTire   = new THREE.MeshStandardMaterial({ color: tireColor, roughness: 0.8,  metalness: 0.0  });
  const matMetal  = new THREE.MeshStandardMaterial({ color: 0xc2cbd8,  roughness: 0.25, metalness: 0.85 });
  const matGlass  = new THREE.MeshStandardMaterial({ color: 0xbfe6ff,  roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55 });
  const matCockpit= new THREE.MeshStandardMaterial({ color: 0x1b1f29, roughness: 0.7,  metalness: 0.0  });

  const RB = (w, h, d, r) => Math.min(r != null ? r : Math.min(w, h, d) * 0.22, Math.min(w, h, d) / 2 - 0.001);
  function rbox(w, h, d, mat, x, y, z, parent = group, r = null) {
    const geo = roundedBoxGeometry(w, h, d, RB(w, h, d, r));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    (parent || group).add(m);
    return m;
  }
  function box(w, h, d, mat, x, y, z, parent = group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function sphere(r, mat, x, y, z, parent = group) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const UP = new THREE.Vector3(0, 1, 0);
  function limb(parent, a, b, r, mat) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(0.001, dir.length());
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, 1, 6, 12), mat);
    m.scale.set(1, len, 1);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    parent.add(m);
    return m;
  }
  function cyl(rt, rb, h, mat, x, y, z, rotX = 0, parent = group) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 18), mat);
    m.rotation.x = rotX; m.position.set(x, y, z);
    m.castShadow = true; parent.add(m);
    return m;
  }

  const exhaustTips = [];
  // Faceted closed volumes: longitudinal stations [z, halfWidth, lowerY, upperY].
  // This produces a sloping nose and shoulders rather than stacked rounded blocks.
  function hull(stations, mat, x = 0) {
    const verts = [], indices = [];
    stations.forEach(([z, w, low, high]) => verts.push(x-w,low,z, x+w,low,z, x+w,high,z, x-w,high,z));
    for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < 4; j++) {
      const a = i * 4 + j, b = i * 4 + (j + 1) % 4, c = b + 4, d = a + 4;
      indices.push(a,b,c, a,c,d);
    }
    const end = (stations.length - 1) * 4;
    indices.push(0,2,1, 0,3,2, end,end+1,end+2, end,end+2,end+3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo.toNonIndexed(), mat); geo.dispose();
    mesh.geometry.computeVertexNormals(); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  }
  // A thin polygon on an arbitrary plane, with actual depth-tested occlusion.
  function panel(points, mat) {
    const geo = new THREE.BufferGeometry();
    const verts = [], indices = [];
    points.forEach(p => verts.push(...p));
    for (let i = 1; i < points.length - 1; i++) indices.push(0,i,i+1);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo,mat); group.add(mesh); return mesh;
  }
  if (aero) {
    const paint = matBody;
    paint.flatShading = true; paint.roughness = 0.32; paint.metalness = 0.28;
    const trim = matAccent; trim.flatShading = true;
    const silver = new THREE.MeshStandardMaterial({color:0xcbd2df,roughness:0.34,metalness:0.5,side:THREE.DoubleSide});
    const carbon = new THREE.MeshStandardMaterial({color:0x121722,roughness:0.62,metalness:0.16,side:THREE.DoubleSide});
    const stripe = new THREE.MeshStandardMaterial({color:red || orange ? accent : 0x138dff,roughness:0.34,metalness:0.3,side:THREE.DoubleSide});
    const headlight = new THREE.MeshStandardMaterial({color:0xd9faff,emissive:0x39cfff,emissiveIntensity:2.4,side:THREE.DoubleSide});
    const taillight = new THREE.MeshStandardMaterial({color:0xff3446,emissive:0xff1025,emissiveIntensity:1.8,side:THREE.DoubleSide});
    const amber = orange ? new THREE.MeshStandardMaterial({color:0xffb626,emissive:0xff7500,emissiveIntensity:1.7,side:THREE.DoubleSide}) : null;
    hull([[-1.52,.78,.20,.43],[-.82,.85,.20,.52],[.55,.85,.20,.52],[1.55,.84,.20,.34]], carbon);
    // Empty center cockpit; no body panel passing through the driver's shoulders.
    hull([[.40,.48,.32,.82],[.85,.57,.28,.75],[1.30,.59,.24,.56],[1.63,.45,.24,.42]], paint);
    hull([[-1.56,.75,.32,.65],[-1.16,.79,.32,.90],[-.66,.66,.32,.86]], paint);
    rbox(.86,.13,1.12,matCockpit,0,.46,-.08,null,.04);
    const seat = rbox(.66,.63,.17,matCockpit,0,.88,-.57,null,.06); seat.rotation.x = -.14;
    rbox(.56,.10,.52,matDark,0,.56,-.16,null,.03);
    rbox(.12,.47,.025,stripe,0,.94,-.465,null,.01);
    for (const s of [-1,1]) {
      // Full wheel arch shells follow the wheel circumference, open below the hub.
      for (const z of [-1.0,1.0]) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(.465,.085,4,20,Math.PI),paint);
        arch.rotation.y = Math.PI/2; arch.position.set(s*.91,.43,z); group.add(arch);
        // Broad top shoulder on the inside of each wheel arch.
        hull([[z-.45,.13,.50,.64],[z-.24,.17,.56,.92],[z+.20,.17,.55,.90],[z+.44,.13,.43,.62]],paint,s*.76);
      }
      hull([[-.72,.16,.30,.68],[-.36,.17,.24,.70],[.30,.15,.24,.64],[.56,.12,.28,.70]],paint,s*.78);
      panel([[s*.965,.29,-.63],[s*.965,.62,-.36],[s*.965,.61,.28],[s*.965,.27,.40]],red ? stripe : (orange ? paint : silver));
      panel([[s*.976,.34,-.49],[s*.976,.55,-.32],[s*.976,.54,-.08],[s*.976,.32,-.14]],carbon);
      for (let i=0;i<3;i++) box(.016,.17,.025,matDark,s*.984,.43,-.29+i*.065);
      hull([[-1.35,.095,.20,.28],[-.5,.10,.20,.30],[.6,.10,.20,.28],[1.48,.14,.20,.25]],stripe,s*.88);
      // Angular front lamp housings and narrow ice-blue LED strips.
      panel([[s*.40,.43,1.64],[s*.91,.46,1.48],[s*.85,.72,1.30],[s*.48,.59,1.52]],carbon);
      if (orange) {
        // Orange Dragon: tall amber eyes above low ice-blue daytime lamps.
        panel([[s*.55,.47,1.625],[s*.84,.50,1.48],[s*.82,.80,1.28],[s*.65,.79,1.34]],carbon);
        panel([[s*.63,.53,1.585],[s*.76,.56,1.49],[s*.76,.76,1.33],[s*.67,.75,1.39]],amber);
        panel([[s*.46,.38,1.665],[s*.84,.44,1.54],[s*.81,.50,1.51],[s*.47,.44,1.64]],headlight);
        panel([[s*.48,.75,.65],[s*.67,.86,.81],[s*.89,.67,1.30],[s*.81,.50,1.56],[s*.72,.69,1.37]],paint);
      } else {
        panel([[s*.46,.49,1.641],[s*.85,.55,1.505],[s*.84,.61,1.45],[s*.47,.55,1.60]],headlight);
        panel([[s*.47,.73,.64],[s*.69,.85,.80],[s*.89,.67,1.29],[s*.62,.57,1.36]],red ? stripe : (opts.model==='blue' ? silver : stripe));
      }
      const fin = box(.09,.24,.38,orange ? paint : stripe,s*.96,.32,1.39); fin.rotation.z = -s*.24;
      // Wide spoiler, endplates, rear angular light signatures and diffuser fins.
      const support = box(.075,.42,.10,carbon,s*.56,1.02,-1.29); support.rotation.x=-.20;
      box(.075,.27,.42,stripe,s*1.01,1.26,-1.39);
      if (orange) {
        panel([[s*.45,.78,-1.60],[s*.88,.78,-1.60],[s*.94,.46,-1.60],[s*.74,.38,-1.60],[s*.50,.56,-1.60]],paint);
        const bezel = new THREE.Mesh(new THREE.TorusGeometry(.145,.033,4,6),stripe);
        bezel.position.set(s*.68,.66,-1.62);group.add(bezel);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(.122,6),taillight);
        lens.position.set(s*.68,.66,-1.63);lens.rotation.y=Math.PI;group.add(lens);
        const core = new THREE.Mesh(new THREE.CircleGeometry(.062,6),amber);
        core.position.set(s*.68,.66,-1.634);core.rotation.y=Math.PI;group.add(core);
        panel([[s*.976,.35,-.51],[s*.976,.53,-.37],[s*.976,.51,-.13],[s*.976,.35,-.22]],stripe);
      } else {
        panel([[s*.40,.70,-1.577],[s*.85,.75,-1.577],[s*.77,.60,-1.577],[s*.43,.60,-1.577]],carbon);
        panel([[s*.45,.68,-1.581],[s*.80,.71,-1.581],[s*.73,.64,-1.581],[s*.48,.64,-1.581]],taillight);
      }
      box(.06,.20,.32,carbon,s*.72,.27,-1.49);
    }
    const wing=box(1.98,.085,.40,orange ? stripe : carbon,0,1.28,-1.39); wing.rotation.x=-.08;
    if (orange) for(const s of [-1,1]) box(.47,.075,.48,stripe,s*.76,1.31,-1.39);
    box(1.82,.018,.08,stripe,0,1.327,-1.55);
    // Hood stripe lies on the sloping hood, not on an invisible floating plate.
    if (orange) {
      panel([[-.23,.827,.41],[.23,.827,.41],[.18,.759,.84],[-.18,.759,.84]],stripe);
      const crown = new THREE.Shape();
      crown.moveTo(-.14,-.065);crown.lineTo(.14,-.065);crown.lineTo(.17,.065);
      crown.lineTo(.07,.015);crown.lineTo(0,.14);crown.lineTo(-.07,.015);crown.lineTo(-.17,.065);crown.closePath();
      const badge=new THREE.Mesh(new THREE.ExtrudeGeometry(crown,{depth:.014,bevelEnabled:false}),stripe);
      badge.rotation.x=-Math.PI/2+.40;badge.position.set(0,.657,1.10);group.add(badge);
    } else {
      panel([[-.065,.827,.41],[.065,.827,.41],[.07,.565,1.30],[-.07,.565,1.30]],opts.model==='skyblue' ? silver : stripe);
      panel([[-.07,.565,1.30],[.07,.565,1.30],[.055,.427,1.63],[-.055,.427,1.63]],opts.model==='skyblue' ? silver : stripe);
    }
    hull([[1.59,.39,.25,.39],[1.67,.33,.24,.37]],carbon);
    for (let i=-3;i<=3;i++) box(.025,.10,.018,matDark,i*.085,.305,1.681);
    box(1.82,.065,.15,carbon,0,.20,1.61);
    box(1.58,.23,.12,carbon,0,.34,-1.58);
    if (orange) {
      box(.43,.065,.025,amber,0,.73,-1.62);
      for(const x of [-.36,0,.36]) box(.065,.27,.30,carbon,x,.27,-1.66);
      for(const x of [-.27,.27]) exhaustTips.push({x,y:.34,z:-1.74,r:.085});
    } else if (red) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,.11,3),stripe);
      tip.rotation.x=Math.PI/2; tip.rotation.z=Math.PI; tip.position.set(0,.48,-1.67); group.add(tip);
      exhaustTips.push({x:0,y:.46,z:-1.74,r:.10});
    } else {
      for (const x of [-.28,.28]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.155,.035,4,6),matMetal);
        ring.position.set(x,.40,-1.67); group.add(ring);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(.135,6),carbon);
        hole.rotation.y=Math.PI; hole.position.set(x,.40,-1.672); group.add(hole);
        exhaustTips.push({x,y:.40,z:-1.73,r:.105});
      }
      box(.25,.07,.015,headlight,0,.71,-1.59);
    }
  } else {
  /* ---------------- Original silhouettes retained for other cars ---------------- */
  rbox(1.60, 0.30, 2.36, matBody, 0, 0.46, 0, null, 0.12);          // 主底盘
  rbox(0.98, 0.24, 0.58, matBody, 0, 0.42, 1.22, null, 0.10);        // 前鼻基座
  rbox(0.30, 0.46, 1.86, matBody,  0.82, 0.55, 0.0, null, 0.10);     // 右侧裙板
  rbox(0.30, 0.46, 1.86, matBody, -0.82, 0.55, 0.0, null, 0.10);     // 左侧裙板
  rbox(1.44, 0.56, 0.78, matBody,  0, 0.66, -1.06, null, 0.14);      // 后引擎舱

  /* 驾驶舱：圆角内凹 + 座椅靠背 + 坐垫 */
  rbox(0.80, 0.40, 1.20, matCockpit, 0, 0.50, 0.04, null, 0.16);     // 座舱内凹（深色）
  rbox(0.74, 0.30, 0.16, matBody, 0, 0.66, -0.54, null, 0.07);       // 座椅靠背
  rbox(0.70, 0.12, 0.66, matAccent, 0, 0.64, 0.06, null, 0.05);      // 坐垫
  cyl(0.40, 0.40, 0.10, matBody, 0, 0.62, 0.62, Math.PI / 2, group); // 座舱前缘圆角唇

  /* ---------------- 款式差异（前脸 / 尾翼 / 排气 / 挡泥板） ---------------- */
  if (style === 'sport') {
    rbox(0.54, 0.16, 0.44, matAccent, 0, 0.40, 1.54, null, 0.06);
    rbox(1.42, 0.10, 0.14, matAccent, 0, 0.40, 1.46, null, 0.04);
    rbox(1.04, 0.16, 0.48, matAccent, 0, 0.96, -1.18, null, 0.06);
    for (const sx of [-0.44, 0.44]) sphere(0.11, matGlass, sx, 0.50, 1.48);
    for (const sx of [-0.30, 0.30]) { cyl(0.07, 0.07, 0.32, matMetal, sx, 0.55, -1.44, Math.PI / 2); exhaustTips.push({ x: sx, y: 0.55, z: -1.62, r: 0.07 }); }
    rbox(0.08, 0.34, 0.08, matDark,  0.52, 1.16, -1.42, null, 0.03);
    rbox(0.08, 0.34, 0.08, matDark, -0.52, 1.16, -1.42, null, 0.03);
    rbox(1.30, 0.08, 0.46, matAccent, 0, 1.34, -1.44, null, 0.03);
  } else if (style === 'classic') {
    const nose = sphere(0.50, matBody, 0, 0.44, 1.30); nose.scale.set(1.15, 0.55, 0.95);
    const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.46, 12), matMetal);
    bumper.rotation.z = Math.PI / 2; bumper.position.set(0, 0.32, 1.60); bumper.castShadow = true; group.add(bumper);
    for (const sx of [-0.40, 0.40]) sphere(0.13, matGlass, sx, 0.56, 1.42);
    for (const [wx, wz] of [[0.82, 0.96], [-0.82, 0.96], [0.86, -0.96], [-0.86, -0.96]]) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.50, 0.09, 10, 20, Math.PI), matBody);
      f.rotation.y = Math.PI / 2; f.position.set(wx, 0.42, wz); f.castShadow = true; group.add(f);
    }
    for (const sx of [-0.96, 0.96]) rbox(0.03, 0.10, 1.40, matAccent, sx, 0.60, 0, null, 0.02);
    const ex = cyl(0.11, 0.11, 0.42, matMetal, 0, 0.55, -1.48, Math.PI / 2); exhaustTips.push({ x: 0, y: 0.55, z: -1.74, r: 0.11 });
    rbox(1.30, 0.10, 0.10, matMetal, 0, 0.96, -1.32, null, 0.03);
  } else if (style === 'muscle') {
    rbox(0.36, 0.44, 1.02, matBody,  0.94, 0.60, -0.78, null, 0.10);
    rbox(0.36, 0.44, 1.02, matBody, -0.94, 0.60, -0.78, null, 0.10);
    const tail = rbox(1.30, 0.09, 0.38, matAccent, 0, 0.97, -1.30, null, 0.03); tail.rotation.x = -0.15;
    rbox(0.34, 0.02, 1.12, matAccent, 0, 0.625, 0.66, null, 0.01);
    rbox(1.52, 0.09, 0.30, matDark, 0, 0.30, 1.54, null, 0.03);
    for (const sx of [-0.42, 0.42]) rbox(0.18, 0.10, 0.06, matGlass, sx, 0.52, 1.48, null, 0.02);
    for (const sx of [-0.42, 0.42]) { cyl(0.10, 0.10, 0.36, matMetal, sx, 0.48, -1.50, Math.PI / 2); exhaustTips.push({ x: sx, y: 0.48, z: -1.70, r: 0.10 }); }
  } else {
    rbox(0.07, 0.55, 0.07, matMetal,  0.30, 0.88, -0.45, null, 0.02);
    rbox(0.07, 0.55, 0.07, matMetal, -0.30, 0.88, -0.45, null, 0.02);
    rbox(0.67, 0.07, 0.07, matMetal,  0, 1.14, -0.45, null, 0.02);
    rbox(0.34, 0.14, 0.50, matAccent, 0, 1.00, -1.00, null, 0.04);
    rbox(0.26, 0.05, 0.10, matDark,   0, 1.03, -0.78, null, 0.02);
    rbox(0.06, 0.18, 0.06, matDark,   0.35, 1.02, -1.42, null, 0.02);
    rbox(0.06, 0.18, 0.06, matDark,  -0.35, 1.02, -1.42, null, 0.02);
    rbox(1.05, 0.06, 0.30, matAccent, 0, 1.12, -1.44, null, 0.02);
    for (const sx of [-0.42, 0.42]) sphere(0.14, matGlass, sx, 0.52, 1.44);
    rbox(1.20, 0.12, 0.10, matAccent, 0, 0.34, 1.56, null, 0.03);
    for (const sx of [-0.20, 0.20]) { cyl(0.06, 0.06, 0.30, matMetal, sx, 0.72, -1.42, Math.PI / 2); exhaustTips.push({ x: sx, y: 0.72, z: -1.59, r: 0.06 }); }
  }

  }
  /* ---------------- 车轮 ---------------- */
  function makeWheel() {
    const wg = new THREE.Group();
    const spinner = new THREE.Group();
    wg.add(spinner);
    const tg = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 28); tg.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tg, matTire); tire.castShadow = true; spinner.add(tire);
    for (const xx of [0.17, -0.17]) {
      const sw = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 6, 24), matTire);
      sw.rotation.y = Math.PI / 2; sw.position.x = xx; spinner.add(sw);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.30,.018,4,24),matAccent);
      rim.rotation.y=Math.PI/2; rim.position.x=xx*1.025; spinner.add(rim);
    }
    const hg = new THREE.CylinderGeometry(0.23, 0.23, 0.36, 20); hg.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(hg, matMetal));
    for (let i = 0; i < 5; i++) {
      const angle = i * (Math.PI * 2 / 5);
      for (const side of [-1,1]) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(.025,.25,.055),matDark);
        sp.position.set(side*.19,Math.cos(angle)*.13,Math.sin(angle)*.13);
        sp.rotation.x=angle; spinner.add(sp);
      }
    }
    const cg = new THREE.CylinderGeometry(0.09, 0.09, 0.38, 12); cg.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(cg, matAccent));
    if (orange) {
      for(const s of [-1,1]) {
        const disc=cyl(.255,.255,.025,matAccent,s*.201,0,0,0,spinner);
        disc.rotation.z=Math.PI/2;
        const cap=cyl(.105,.105,.032,matAccent,s*.222,0,0,0,spinner);cap.rotation.z=Math.PI/2;
      }
    }
    return { wg, spinner };
  }
  const wheels = {};
  const WP = {
    fl: [ aero ? 0.94 : 0.82, 0.42,  aero ? 1.0 : 0.96], fr: [aero ? -0.94 : -0.82, 0.42, aero ? 1.0 : 0.96],
    rl: [ aero ? 0.96 : 0.86, 0.42, aero ? -1.0 : -0.96], rr: [aero ? -0.96 : -0.86, 0.42, aero ? -1.0 : -0.96],
  };
  for (const k in WP) {
    const [x, y, z] = WP[k];
    const { wg, spinner } = makeWheel();
    const steer = (k === 'fl' || k === 'fr');
    if (steer) {
      const sg = new THREE.Group();
      sg.position.set(x, y, z);
      wg.position.set(0, 0, 0);
      sg.add(wg); group.add(sg);
      wheels[k] = { wg, spinner, steer, pivot: sg };
    } else {
      wg.position.set(x, y, z);
      group.add(wg);
      wheels[k] = { wg, spinner, steer, pivot: wg };
    }
  }

  /* ---------------- 方向盘（常驻车内，降至胸前，不遮脸） ---------------- */
  const WHEEL_Y = 0.97;
  const wheelPos = new THREE.Vector3(0, WHEEL_Y, 0.37);
  const steering = new THREE.Group(); steering.position.copy(wheelPos); group.add(steering);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 12, 28), matDark);
  sw.rotation.x = 0.50;
  sw.castShadow = true; steering.add(sw);
  const hub = box(.24,.035,.04,matMetal,0,0,0,steering); hub.rotation.x=.50;
  limb(group, new THREE.Vector3(0, 0.62, 0.10), wheelPos, 0.025, matMetal);

  /* ---------------- 驾驶员（多视角精灵：正/侧/背） ---------------- */
  const driver = new THREE.Group();
  driver.position.set(0,.62,-.10); // Lean around the seated hips, not the road.
  group.add(driver);

  const PLANE_W = 0.90, PLANE_H = PLANE_W * 320 / 240;
  const CENTER_Y = .74, CENTER_Z = -.04;
  const appearance = driverAppearance(opts.charKey);
  const Material = appearance.flat ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
  const suit = new Material({color:appearance.body,...(appearance.flat?{}:{roughness:.90})});
  const armMat = new Material({color:appearance.arm,...(appearance.flat?{}:{roughness:.90})});
  let furTexture = null;
  if (appearance.fur && IMG['ch_' + opts.charKey + '_p']) {
    furTexture=characterFurTexture(THREE,IMG['ch_' + opts.charKey + '_p']);
    suit.map=armMat.map=furTexture;suit.color.set(0xffffff);armMat.color.set(0xffffff);
  }
  const torso = sphere(.235,suit,0,.20,-.025,driver); torso.scale.set(appearance.width/.235,1.0,.68);
  // Forearms keep wrists at the wheel; only shoulders/head lean in turns.
  const arms = new THREE.Group(); group.add(arms);
  const hands=[];
  const ownHand=characterHandTexture(THREE,opts.charKey,IMG['ch_' + opts.charKey + '_p']);
  for (const s of [-1,1]) {
    const shoulder=new THREE.Vector3(s*appearance.width,.93,-.10);
    const elbow=new THREE.Vector3(s*(appearance.width+.018),.84,.12);
    const wrist=new THREE.Vector3(s*.157,.967,.358);
    limb(arms,shoulder,elbow,.047,appearance.sleeves?suit:armMat);
    limb(arms,elbow,wrist,.039,armMat);
    if (ownHand) {
      const hand = new THREE.Mesh(new THREE.PlaneGeometry(appearance.handSize*ownHand.aspect,appearance.handSize),
        new THREE.MeshBasicMaterial({map:ownHand.texture,transparent:true,alphaTest:.12,side:THREE.DoubleSide,toneMapped:false}));
      hand.position.set(s*.157,-.004,.005);hand.renderOrder=2;hand.userData.side=s;
      steering.add(hand);hands.push(hand);
    }
  }

  let charPlane = null, charMat = null;
  const charTex = { front: null, side: null, back: null };
  const _v = new THREE.Vector3();

  function buildBillboardByKey(key) {
    if (!driverTextures.has(key)) {
      const front = texFromImg(IMG['ch_' + key + '_drive_front']);
      const back = texFromImg(IMG['ch_' + key + '_drive']);
      const side = texFromImg(sidePortrait(IMG['ch_' + key + '_2'])) || front;
      driverTextures.set(key,{ texFront:front, texSide:side, texBack:back });
    }
    buildBillboard(driverTextures.get(key));
  }
  function buildBillboard(cfg) {
    if (charPlane) { driver.remove(charPlane); charPlane.geometry.dispose(); charMat.dispose(); charPlane=null; }
    if (!cfg || !cfg.texFront) return;
    charTex.front = cfg.texFront;
    charTex.side  = cfg.texSide  || cfg.texFront;
    charTex.back  = cfg.texBack  || cfg.texFront;
    charMat = new THREE.MeshBasicMaterial({
      map: charTex.front, transparent: true, alphaTest: 0.5,
      side: THREE.DoubleSide, depthWrite: true, toneMapped: false,
    });
    charPlane = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), charMat);
    charPlane.position.set(0, CENTER_Y, CENTER_Z);
    charPlane.renderOrder = 2;
    driver.add(charPlane);
  }
  if (opts.charKey) buildBillboardByKey(opts.charKey);

  /* ---------------- 氮气尾焰（对齐排气管口，默认隐藏） ---------------- */
  const flames = [];
  function flameCone(r, h, color) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;   // 锥尖朝 -Z（车尾方向），喷气向后
    return m;
  }
  for (const t of exhaustTips) {
    const outer = flameCone(t.r * 1.7, t.r * 8.5, 0xff7a1f);
    const inner = flameCone(t.r * 0.9, t.r * 5.0, 0xffd23d);
    outer.position.set(t.x, t.y, t.z - 0.04);
    inner.position.set(t.x, t.y, t.z - t.r * 1.6);
    group.add(outer, inner);
    flames.push(outer, inner);
    // 加法混合精灵焰：始终面向相机，跟车视角也能看到明显喷气
    if (TEX.flame) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.flame, blending: THREE.AdditiveBlending, transparent: true,
        depthWrite: false, opacity: 0,
      }));
      sp.position.set(t.x, t.y, t.z - t.r * 3.0);
      sp.renderOrder = 4;
      group.add(sp);
      flames.push(sp);
    }
  }

  /* ---------------- 动画 / 朝向接口 ---------------- */
  let steerAngle = 0, rollV = 0, boost = false, lean = 0, t = 0;
  function setSteer(a) { steerAngle = a; }
  function setBoost(b) { boost = b; }
  function setRoll(v) { rollV = v; }
  function setLean(v) { lean = v; }
  function orientToCamera(cam) {
    if (!charPlane) return;
    group.updateMatrixWorld(true);
    const lp = group.worldToLocal(cam.getWorldPosition(_v));
    const az = Math.atan2(lp.x, lp.z);          // 摄像机在车本地坐标的方位角
    charPlane.rotation.y = az;                  // 面片转向摄像机；内容按驾驶方向取正/侧/背
    const a = Math.abs(az);
    const side = a >= Math.PI / 3 && a <= 2 * Math.PI / 3;
    const tex = side ? charTex.side : (a < Math.PI / 2 ? charTex.front : charTex.back);
    charPlane.scale.x = side && az < 0 ? -1 : 1;
    for (const hand of hands) {
      hand.rotation.y=az;hand.rotation.z=hand.userData.side*.24;
      hand.scale.x=hand.userData.side*(a>Math.PI/2?-1:1);
    }
    if (charPlane.material.map !== tex) { charPlane.material.map = tex; charPlane.material.needsUpdate = true; }
  }
  function update(dt) {
    t += dt;
    wheels.fl.pivot.rotation.y = steerAngle;
    wheels.fr.pivot.rotation.y = steerAngle;
    steering.rotation.z = -steerAngle * .65;
    const spin = rollV * 14 * dt;
    for (const k in wheels) wheels[k].spinner.rotation.x -= spin;
    driver.rotation.z += (clamp(-lean * 0.09, -0.10, 0.10) - driver.rotation.z) * Math.min(1, dt * 8);
    const target = boost ? 0.92 : 0.0;
    for (const fl of flames) {
      fl.material.opacity += (target - fl.material.opacity) * Math.min(1, dt * 10);
      if (!boost) continue;
      const s = 0.8 + 0.35 * Math.sin(t * 40 + fl.position.x);
      if (fl.isSprite) { const b = 0.85 + 0.25 * Math.sin(t * 34 + fl.position.x); fl.scale.set(b * 1.15, b * 1.35, 1); }
      else fl.scale.set(1, s, 1);
    }
  }

  function dispose() {
    const geometries = new Set(), materials = new Set();
    group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    if(furTexture) furTexture.dispose();
  }
  return { group, wheels, driver, setSteer, setBoost, setRoll, setLean,
           setDriver: buildBillboard, orientToCamera, update, dispose };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
