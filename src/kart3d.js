/* ============================================================
   路人之王 · 游戏内程序化 3D 卡丁车（与 tools/kart_model.js 同造型）
   ------------------------------------------------------------
   用途：比赛视图（Race.makeView）与选角页 3D 预览（ui.js）共用。
   设计要点：
   - 直接用全局 window.THREE，不依赖 importmap / addons（网络稳健，
     不会因 unpkg 抖动而整页崩）。圆角几何用核心 THREE 自实现。
   - 角色贴图来自已载入的 IMG：正 _drive_front / 侧 _2（无则正） / 背 _drive
   - 车头朝 +Z，上 +Y，右 +X；整体缩放 1.0 时轮胎恰好着地（y=0）。
   createKart(opts) -> { group, wheels, driver, setSteer, setBoost,
     setRoll, setLean, setDriver, orientToCamera, update }
   ============================================================ */
import { IMG, TEX } from './assets.js';

const THREE = window.THREE;   // 入口 main.js 已先把 three 挂在 window 上，再动态 import 本模块

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

  /* ---------------- 底盘（低矮宽体开放座舱，圆角化降积木感） ---------------- */
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
  const exhaustTips = [];
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

  /* ---------------- 车轮 ---------------- */
  function makeWheel() {
    const wg = new THREE.Group();
    const spinner = new THREE.Group();
    wg.add(spinner);
    const tg = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 28); tg.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tg, matTire); tire.castShadow = true; spinner.add(tire);
    for (const zz of [0.17, -0.17]) {
      const sw = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 24), matTire);
      sw.rotation.y = Math.PI / 2; sw.position.z = zz; spinner.add(sw);
    }
    const hg = new THREE.CylinderGeometry(0.23, 0.23, 0.36, 20); hg.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(hg, matMetal));
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.05), matAccent);
      sp.rotation.x = i * (Math.PI * 2 / 5);
      spinner.add(sp);
    }
    const cg = new THREE.CylinderGeometry(0.09, 0.09, 0.38, 12); cg.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(cg, matAccent));
    return { wg, spinner };
  }
  const wheels = {};
  const WP = {
    fl: [ 0.82, 0.42,  0.96], fr: [-0.82, 0.42,  0.96],
    rl: [ 0.86, 0.42, -0.96], rr: [-0.86, 0.42, -0.96],
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
  const WHEEL_Y = 0.70;
  const wheelPos = new THREE.Vector3(0, WHEEL_Y, 0.56);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 12, 28), matDark);
  sw.position.copy(wheelPos); sw.rotation.x = Math.PI / 2 - 0.30;
  sw.castShadow = true; group.add(sw);
  limb(group, new THREE.Vector3(0, 0.62, 0.08), wheelPos, 0.03, matMetal);

  /* ---------------- 驾驶员（多视角精灵：正/侧/背） ---------------- */
  const driver = new THREE.Group();
  group.add(driver);

  const PLANE_W = 0.94, PLANE_H = PLANE_W * 320 / 240;
  const CENTER_Y = 1.02, CENTER_Z = 0.10;

  let charPlane = null, charMat = null;
  const charTex = { front: null, side: null, back: null };
  const _v = new THREE.Vector3();

  function buildBillboardByKey(key) {
    const front = texFromImg(IMG['ch_' + key + '_drive_front']);
    const back  = texFromImg(IMG['ch_' + key + '_drive']);
    const side  = texFromImg(IMG['ch_' + key + '_2']) || front;   // 无 _2（老司机）→ 侧回退正面
    buildBillboard({ texFront: front, texSide: side, texBack: back });
  }
  function buildBillboard(cfg) {
    for (const c of [...driver.children]) {
      driver.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
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
    const tex = a < Math.PI / 4 ? charTex.front : (a > 3 * Math.PI / 4 ? charTex.back : charTex.side);
    if (charPlane.material.map !== tex) { charPlane.material.map = tex; charPlane.material.needsUpdate = true; }
  }
  function update(dt) {
    t += dt;
    wheels.fl.pivot.rotation.y = steerAngle;
    wheels.fr.pivot.rotation.y = steerAngle;
    const spin = rollV * 14 * dt;
    for (const k in wheels) wheels[k].spinner.rotation.x -= spin;
    driver.rotation.z += (clamp(-lean * 0.16, -0.20, 0.20) - driver.rotation.z) * Math.min(1, dt * 8);
    const target = boost ? 0.92 : 0.0;
    for (const fl of flames) {
      fl.material.opacity += (target - fl.material.opacity) * Math.min(1, dt * 10);
      if (!boost) continue;
      const s = 0.8 + 0.35 * Math.sin(t * 40 + fl.position.x);
      if (fl.isSprite) { const b = 0.85 + 0.25 * Math.sin(t * 34 + fl.position.x); fl.scale.set(b * 1.15, b * 1.35, 1); }
      else fl.scale.set(1, s, 1);
    }
  }

  return { group, wheels, driver, setSteer, setBoost, setRoll, setLean,
           setDriver: buildBillboard, orientToCamera, update };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
