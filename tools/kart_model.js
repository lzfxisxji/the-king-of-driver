/* ============================================================
   路人之王 · 程序化 3D 卡丁车模型（测试 / 日后集成共用）
   ------------------------------------------------------------
   纯 Three.js 几何建模 + 玩家角色精灵（assets/chars 多视角素材）。
   createKart(THREE, opts) -> {
     group,          // 整个卡丁车 + 驾驶员（可直接 add 到场景）
     wheels,         // { fl, fr, rl, rr } 每个含 { wg, spinner, steer, pivot }
     driver,         // 驾驶员根 Group（视图切换精灵面片）
     setSteer(a),    // 前轮转向角（弧度）
     setBoost(b),    // 是否喷氮（开尾焰）
     setRoll(v),     // 车轮滚动速度系数 0..1
     setDriver(cfg), // 换驾驶员：{ texFront, texSide, texBack }
     orientToCamera(cam), // 每帧：按摄像机-车相对方位切换正/侧/背贴图并朝向
     update(dt),     // 每帧调用：滚动 + 尾焰动画
   }
   坐标约定：车头朝 +Z，上 +Y，右 +X。
   styles: 'sport' | 'classic' | 'muscle' | 'mini'
   ============================================================ */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createKart(THREE, opts = {}) {
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
    const geo = new RoundedBoxGeometry(w, h, d, 4, RB(w, h, d, r));
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
  // 座舱前缘圆角唇（避免方块切口感）
  cyl(0.40, 0.40, 0.10, matBody, 0, 0.62, 0.62, Math.PI / 2, group);

  /* ---------------- 款式差异（前脸 / 尾翼 / 排气 / 挡泥板） ---------------- */
  const exhaustTips = [];        // { x, y, z, r } 尾焰对齐排气管口
  if (style === 'sport') {
    rbox(0.54, 0.16, 0.44, matAccent, 0, 0.40, 1.54, null, 0.06);    // 鼻尖饰条
    rbox(1.42, 0.10, 0.14, matAccent, 0, 0.40, 1.46, null, 0.04);    // 前保险杠饰条
    rbox(1.04, 0.16, 0.48, matAccent, 0, 0.96, -1.18, null, 0.06);   // 后饰条
    for (const sx of [-0.44, 0.44]) sphere(0.11, matGlass, sx, 0.50, 1.48);
    for (const sx of [-0.30, 0.30]) {                                // 双小排气
      const ex = cyl(0.07, 0.07, 0.32, matMetal, sx, 0.55, -1.44, Math.PI / 2);
      exhaustTips.push({ x: sx, y: 0.55, z: -1.62, r: 0.07 });
    }
    rbox(0.08, 0.34, 0.08, matDark,  0.52, 1.16, -1.42, null, 0.03); // 高位尾翼支柱
    rbox(0.08, 0.34, 0.08, matDark, -0.52, 1.16, -1.42, null, 0.03);
    rbox(1.30, 0.08, 0.46, matAccent, 0, 1.34, -1.44, null, 0.03);   // 尾翼
  } else if (style === 'classic') {
    const nose = sphere(0.50, matBody, 0, 0.44, 1.30); nose.scale.set(1.15, 0.55, 0.95);
    const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.46, 12), matMetal);
    bumper.rotation.z = Math.PI / 2; bumper.position.set(0, 0.32, 1.60); bumper.castShadow = true; group.add(bumper);
    for (const sx of [-0.40, 0.40]) sphere(0.13, matGlass, sx, 0.56, 1.42);
    for (const [wx, wz] of [[0.82, 0.96], [-0.82, 0.96], [0.86, -0.96], [-0.86, -0.96]]) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.50, 0.09, 10, 20, Math.PI), matBody);
      f.rotation.y = Math.PI / 2; f.position.set(wx, 0.42, wz); f.castShadow = true; group.add(f);
    }
    for (const sx of [-0.96, 0.96]) rbox(0.03, 0.10, 1.40, matAccent, sx, 0.60, 0, null, 0.02); // 侧腰线
    const ex = cyl(0.11, 0.11, 0.42, matMetal, 0, 0.55, -1.48, Math.PI / 2);
    exhaustTips.push({ x: 0, y: 0.55, z: -1.74, r: 0.11 });
    rbox(1.30, 0.10, 0.10, matMetal, 0, 0.96, -1.32, null, 0.03);
  } else if (style === 'muscle') {
    rbox(0.36, 0.44, 1.02, matBody,  0.94, 0.60, -0.78, null, 0.10); // 后宽臀 pod
    rbox(0.36, 0.44, 1.02, matBody, -0.94, 0.60, -0.78, null, 0.10);
    const tail = rbox(1.30, 0.09, 0.38, matAccent, 0, 0.97, -1.30, null, 0.03); tail.rotation.x = -0.15;
    rbox(0.34, 0.02, 1.12, matAccent, 0, 0.625, 0.66, null, 0.01);   // 机盖拉花
    rbox(1.52, 0.09, 0.30, matDark, 0, 0.30, 1.54, null, 0.03);      // 前唇
    for (const sx of [-0.42, 0.42]) rbox(0.18, 0.10, 0.06, matGlass, sx, 0.52, 1.48, null, 0.02); // 方大灯
    for (const sx of [-0.42, 0.42]) {                                // 双大排气
      cyl(0.10, 0.10, 0.36, matMetal, sx, 0.48, -1.50, Math.PI / 2);
      exhaustTips.push({ x: sx, y: 0.48, z: -1.70, r: 0.10 });
    }
  } else {                                                          // mini
    rbox(0.07, 0.55, 0.07, matMetal,  0.30, 0.88, -0.45, null, 0.02); // 防滚架
    rbox(0.07, 0.55, 0.07, matMetal, -0.30, 0.88, -0.45, null, 0.02);
    rbox(0.67, 0.07, 0.07, matMetal,  0, 1.14, -0.45, null, 0.02);
    rbox(0.34, 0.14, 0.50, matAccent, 0, 1.00, -1.00, null, 0.04);  // 顶置进气勺
    rbox(0.26, 0.05, 0.10, matDark,   0, 1.03, -0.78, null, 0.02);
    rbox(0.06, 0.18, 0.06, matDark,   0.35, 1.02, -1.42, null, 0.02); // 小尾翼
    rbox(0.06, 0.18, 0.06, matDark,  -0.35, 1.02, -1.42, null, 0.02);
    rbox(1.05, 0.06, 0.30, matAccent, 0, 1.12, -1.44, null, 0.02);
    for (const sx of [-0.42, 0.42]) sphere(0.14, matGlass, sx, 0.52, 1.44);
    rbox(1.20, 0.12, 0.10, matAccent, 0, 0.34, 1.56, null, 0.03);    // 前围嘴
    for (const sx of [-0.20, 0.20]) {                                // 双小排气（高置）
      cyl(0.06, 0.06, 0.30, matMetal, sx, 0.72, -1.42, Math.PI / 2);
      exhaustTips.push({ x: sx, y: 0.72, z: -1.59, r: 0.06 });
    }
  }

  /* ---------------- 车轮（四轮外露，圆角胎壁降方块感） ---------------- */
  function makeWheel() {
    const wg = new THREE.Group();
    const spinner = new THREE.Group();           // 滚动绕 X
    wg.add(spinner);
    const tg = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 28); tg.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tg, matTire); tire.castShadow = true; spinner.add(tire);
    // 胎壁（两侧圆环，给轮胎圆鼓感）
    for (const zz of [0.17, -0.17]) {
      const sw = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 24), matTire);
      sw.rotation.y = Math.PI / 2; sw.position.z = zz; spinner.add(sw);
    }
    const hg = new THREE.CylinderGeometry(0.23, 0.23, 0.36, 20); hg.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(hg, matMetal));
    for (let i = 0; i < 5; i++) {                 // 轮辐
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
  sw.position.copy(wheelPos); sw.rotation.x = Math.PI / 2 - 0.30;  // 立起并后倾
  sw.castShadow = true; group.add(sw);
  limb(group, new THREE.Vector3(0, 0.62, 0.08), wheelPos, 0.03, matMetal);  // 转向柱

  /* ---------------- 驾驶员（视图切换精灵，正/侧/背） ----------------
     始终与赛车驾驶方向一致：摄像机在前→正面贴图，后→背面，侧→侧面。
     用 assets/chars 真实素材，非 3D 重塑；贴图随方位切换，不始终面向摄像机。 */
  const driver = new THREE.Group();
  group.add(driver);

  const PLANE_W = 0.94, PLANE_H = PLANE_W * 320 / 240;   // 240x320 画布 → 世界
  const CENTER_Y = 1.02, CENTER_Z = 0.10;                // 抬高：完整头/肩/上身上露

  let charPlane = null, charMat = null;
  const charTex = { front: null, side: null, back: null };
  const _v = new THREE.Vector3();

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

  /* 几何 3D 噜噜（早期测试遗留，保留备用；默认走上面精灵方案） */
  function buildLulu() {
    const C = { head:'#fdee8b', ear:'#fde97e', body:'#fe9f30', carrot:'#fda631', leaf:'#4faf4a', dark:'#2a2f3a' };
    const m = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r });
    const mHead = m(C.head), mBody = m(C.body), mCarrot = m(C.carrot), mLeaf = m(C.leaf, 0.6), mDark = m(C.dark, 0.5);
    const body = sphere(0.36, mBody, 0, 0.75, 0.05); body.scale.set(1.0, 0.88, 0.92);
    const head = sphere(0.27, mHead, 0, 1.21, 0.02); head.scale.set(1.02, 0.92, 0.95);
    sphere(0.10, mHead,  0.22, 1.43, -0.03); sphere(0.10, mHead, -0.22, 1.43, -0.03);
    const carrot = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.32, 18), mCarrot); carrot.position.set(0, 1.65, 0.0); carrot.castShadow = true; driver.add(carrot);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.10, 10), mLeaf); leaf.position.set(0, 1.86, 0.0); driver.add(leaf);
    for (const s of [1, -1]) { const eye = sphere(0.055, mDark, s * 0.115, 1.23, 0.26); eye.scale.set(1, 1.25, 0.55); }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 14, Math.PI), mDark); mouth.position.set(0, 1.10, 0.265); mouth.rotation.z = Math.PI; driver.add(mouth);
    for (const s of [1, -1]) limb(driver, new THREE.Vector3(s * 0.12, 0.62, 0.10), new THREE.Vector3(s * 0.17, 0.50, 0.48), 0.095, mBody);
    for (const s of [1, -1]) {
      const shoulder = new THREE.Vector3(s * 0.24, 1.07, 0.10); const hand = new THREE.Vector3(s * 0.15, WHEEL_Y, 0.54);
      limb(driver, shoulder, hand, 0.068, mHead); sphere(0.078, mHead, hand.x, hand.y, hand.z, driver);
    }
  }

  function buildCharacter() {
    if (opts.driver && opts.driver.texFront) buildBillboard(opts.driver);
    else if (opts.character === 'lulu') buildLulu();
  }
  buildCharacter();

  /* ---------------- 氮气尾焰（对齐各款式排气管口，默认隐藏） ---------------- */
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
  }

  /* ---------------- 动画 / 朝向接口 ---------------- */
  let steerAngle = 0, rollV = 0, boost = false, t = 0;
  function setSteer(a) { steerAngle = a; }
  function setBoost(b) { boost = b; }
  function setRoll(v) { rollV = v; }
  function orientToCamera(cam) {
    if (!charPlane) return;
    group.updateMatrixWorld();
    const lp = group.worldToLocal(cam.getWorldPosition(_v));
    const az = Math.atan2(lp.x, lp.z);          // 摄像机在车本地坐标的方位角
    charPlane.rotation.y = az;                  // 面片转向摄像机（内容按驾驶方向取正/侧/背）
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
    const target = boost ? 0.92 : 0.0;
    for (const fl of flames) {
      fl.material.opacity += (target - fl.material.opacity) * Math.min(1, dt * 10);
      if (boost) { const s = 0.8 + 0.35 * Math.sin(t * 40 + fl.position.x); fl.scale.set(1, s, 1); }
    }
  }

  return { group, wheels, driver, setSteer, setBoost, setRoll,
           setDriver: buildBillboard, orientToCamera, update };
}
