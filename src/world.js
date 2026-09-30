/* ============================================================
   3D 世界构建：地面 / 赛道带 / 路肩 / 护栏 / 轮胎墙 / 路灯 /
   树木 / 水面 / 观众席 / 起终点门架 / 蓝色 ? 道具箱
   ============================================================ */
import { TRACK } from './config.js';
import { TEX } from './assets.js';
import { buildPolyline, scatterOutside, buildItemBoxes, toWorld, samplePath, TRACK_LEN } from './track.js';

const HW = TRACK.halfWidth;
const YAXIS = new THREE.Vector3(0, 1, 0);

/* 用基向量搭一个"沿赛道朝向"的旋转矩阵：X=横向(u)，Y=垂直，Z=纵向 */
function basisAt(p, mode) {
  const u3 = new THREE.Vector3(p.ux, 0, p.uz);
  const t3 = new THREE.Vector3(p.tx, 0, p.tz);
  const m = new THREE.Matrix4();
  if (mode === 'flat') {
    // 平铺在地面：局部 X 对应 u，局部 Y 对应 t，法线 +Y
    m.makeBasis(u3, t3, YAXIS);
  } else if (mode === 'sign') {
    // 立牌：局部 X 对应 u，局部 Y 向上，法线 -t（面向来车）
    const n = new THREE.Vector3().crossVectors(u3, YAXIS).normalize();
    m.makeBasis(u3, YAXIS, n);
  } else {
    // 面朝赛道：局部 Z 指向赛道内侧
    const z = u3.clone().multiplyScalar(-1);
    const x = new THREE.Vector3().crossVectors(YAXIS, z).normalize();
    m.makeBasis(x, YAXIS, z);
  }
  return m;
}

/* 沿路径的四边形条带；latA/latB 横向偏移，yA/yB 各自高度 */
function buildRibbon(pts, opt) {
  const { latA, latB, yA = 0, yB = 0, vA = 0, vB = 1, repeatAlong = 14 } = opt;
  const n = pts.length;
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    pos[i * 6 + 0] = p.x + p.ux * latA;
    pos[i * 6 + 1] = yA;
    pos[i * 6 + 2] = p.z + p.uz * latA;
    pos[i * 6 + 3] = p.x + p.ux * latB;
    pos[i * 6 + 4] = yB;
    pos[i * 6 + 5] = p.z + p.uz * latB;
    uv[i * 4 + 0] = vA; uv[i * 4 + 1] = p.s / repeatAlong;
    uv[i * 4 + 2] = vB; uv[i * 4 + 3] = p.s / repeatAlong;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function inst(geo, mat, list, place) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const tmp = new THREE.Matrix4();
  list.forEach((it, i) => { place(it, i, tmp); m.setMatrixAt(i, tmp); });
  m.instanceMatrix.needsUpdate = true;
  return m;
}

export function createWorld(scene) {
  const world = { itemMeshes: [], animated: [] };

  /* ---------------- 天空 & 雾 ---------------- */
  const skyCv = document.createElement('canvas');
  skyCv.width = 4; skyCv.height = 256;
  {
    const g = skyCv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.00, '#1d63c4');
    grd.addColorStop(0.34, '#4f9fe8');
    grd.addColorStop(0.52, '#86c4f2');
    grd.addColorStop(0.70, '#c2e2fa');
    grd.addColorStop(1.00, '#eaf5ff');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  }
  const skyTex = new THREE.CanvasTexture(skyCv);
  if (THREE.SRGBColorSpace) skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(360, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false })
  );
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xd2e8ff, 140, 340);

  /* ---------------- 灯光 ---------------- */
  scene.add(new THREE.HemisphereLight(0xd4eaff, 0x4e7a3e, 1.05));
  const sun = new THREE.DirectionalLight(0xfff3dc, 1.45);
  sun.position.set(70, 120, -55);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc2daff, 0.40);
  fill.position.set(-70, 70, 65);
  scene.add(fill);

  /* ---------------- 草地 ---------------- */
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 380),
    new THREE.MeshLambertMaterial({ map: TEX.grass })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  scene.add(grass);

  /* ---------------- 赛道 & 路肩 ---------------- */
  const { pts } = buildPolyline(0.85);
  scene.add(new THREE.Mesh(
    buildRibbon(pts, { latA: -HW, latB: HW, yA: 0.02, yB: 0.02, vA: 0, vB: 1, repeatAlong: 13.9 }),
    new THREE.MeshLambertMaterial({ map: TEX.road })
  ));
  const kerbMat = new THREE.MeshLambertMaterial({ map: TEX.kerb });
  scene.add(new THREE.Mesh(buildRibbon(pts, { latA: HW, latB: HW + 1.0, yA: 0.05, yB: 0.03, vA: 0, vB: 1, repeatAlong: 3.2 }), kerbMat));
  scene.add(new THREE.Mesh(buildRibbon(pts, { latA: -HW - 1.0, latB: -HW, yA: 0.03, yB: 0.05, vA: 0, vB: 1, repeatAlong: 3.2 }), kerbMat.clone()));

  /* 起终点格纹 */
  {
    const map = TEX.checker.clone();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(HW * 2 / 1.0, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 2.2), new THREE.MeshLambertMaterial({ map }));
    const p = samplePath(0, {});
    m.quaternion.setFromRotationMatrix(basisAt(p, 'flat'));
    m.position.set(p.x, 0.058, p.z);
    scene.add(m);
  }

  /* ---------------- 外侧护栏 ---------------- */
  const railLat = HW + 2.6;
  scene.add(new THREE.Mesh(
    buildRibbon(pts, { latA: railLat, latB: railLat, yA: 0.15, yB: 1.02, vA: 0, vB: 1, repeatAlong: 8 }),
    new THREE.MeshLambertMaterial({ color: 0xe4eaf3, side: THREE.DoubleSide })
  ));
  scene.add(new THREE.Mesh(
    buildRibbon(pts, { latA: railLat, latB: railLat, yA: 1.20, yB: 1.42, vA: 0, vB: 1, repeatAlong: 8 }),
    new THREE.MeshLambertMaterial({ color: 0xff5f72, side: THREE.DoubleSide })
  ));
  {
    const list = [];
    for (let i = 0; i < pts.length; i += 3) list.push(pts[i]);
    scene.add(inst(new THREE.BoxGeometry(0.16, 1.1, 0.16),
      new THREE.MeshLambertMaterial({ color: 0xbcc6d6 }), list,
      (p, i, m) => m.makeTranslation(p.x + p.ux * railLat, 0.55, p.z + p.uz * railLat)));
  }

  /* ---------------- 弯道轮胎墙 ---------------- */
  {
    const tireGeo = new THREE.TorusGeometry(0.42, 0.19, 6, 10);
    tireGeo.rotateX(Math.PI / 2);
    const palette = [0x2b2f36, 0xe2483f, 0x2b2f36, 0xf2f4f8];
    const list = [];
    [114.7, 153.8, 293.2, 332.3].forEach((sv, ci) => {
      for (let k = -6; k <= 6; k++) {
        const p = samplePath(sv + k * 1.15, {});
        for (let stack = 0; stack < 3; stack++) {
          list.push({
            x: p.x + p.ux * (HW + 1.35), z: p.z + p.uz * (HW + 1.35),
            y: 0.2 + stack * 0.38, c: palette[(ci + stack) % palette.length],
          });
        }
      }
    });
    const tires = inst(tireGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), list,
      (it, i, m) => m.makeTranslation(it.x, it.y, it.z));
    list.forEach((it, i) => tires.setColorAt(i, new THREE.Color(it.c)));
    if (tires.instanceColor) tires.instanceColor.needsUpdate = true;
    scene.add(tires);
  }

  /* ---------------- 路灯 ---------------- */
  {
    const poles = [], glows = [];
    for (let s = 0; s < TRACK_LEN; s += 17) {
      for (const side of [1, -1]) {
        const lat = side > 0 ? HW + 3.7 : -(HW + 2.3);
        const p = samplePath(s + (side > 0 ? 0 : 8.5), {});
        const x = p.x + p.ux * lat, z = p.z + p.uz * lat;
        poles.push({ x, z });
        glows.push(x, 4.05, z);
      }
    }
    scene.add(inst(new THREE.CylinderGeometry(0.09, 0.13, 3.8, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a414d }), poles,
      (p, i, m) => m.makeTranslation(p.x, 1.9, p.z)));
    scene.add(inst(new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xfff0c0, emissive: 0xffd98a, emissiveIntensity: 0.9 }), poles,
      (p, i, m) => m.makeTranslation(p.x, 4.05, p.z)));
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glows, 3));
    scene.add(new THREE.Points(gg, new THREE.PointsMaterial({
      map: TEX.glowWarm, size: 5.4, sizeAttenuation: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
    })));
  }

  /* ---------------- 树木 ---------------- */
  {
    const trees = scatterOutside(240, 20260930);
    const greens = [0x2f7d3a, 0x3f9b46, 0x57b055, 0x256b33, 0x6cc06a];
    const trunk = inst(new THREE.CylinderGeometry(0.17, 0.26, 1.5, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trees,
      (t, i, m) => m.compose(new THREE.Vector3(t.x, 0.75 * t.scale, t.z),
        new THREE.Quaternion().setFromAxisAngle(YAXIS, t.rot),
        new THREE.Vector3(t.scale, t.scale, t.scale)));
    const la = inst(new THREE.ConeGeometry(1.4, 2.2, 7),
      new THREE.MeshLambertMaterial({ flatShading: true, color: 0xffffff }), trees,
      (t, i, m) => m.compose(new THREE.Vector3(t.x, 2.55 * t.scale, t.z),
        new THREE.Quaternion().setFromAxisAngle(YAXIS, t.rot),
        new THREE.Vector3(t.scale, t.scale, t.scale)));
    const lb = inst(new THREE.ConeGeometry(0.98, 1.6, 7),
      new THREE.MeshLambertMaterial({ flatShading: true, color: 0xffffff }), trees,
      (t, i, m) => m.compose(new THREE.Vector3(t.x, 3.6 * t.scale, t.z),
        new THREE.Quaternion().setFromAxisAngle(YAXIS, t.rot + 0.4),
        new THREE.Vector3(t.scale * 0.86, t.scale * 0.86, t.scale * 0.86)));
    trees.forEach((t, i) => {
      const c = new THREE.Color(greens[i % greens.length]).offsetHSL(0, 0, (t.rnd - 0.5) * 0.13);
      la.setColorAt(i, c);
      lb.setColorAt(i, c.clone().offsetHSL(0, 0, 0.06));
    });
    [la, lb].forEach((o) => { if (o.instanceColor) o.instanceColor.needsUpdate = true; });
    scene.add(trunk); scene.add(la); scene.add(lb);
  }

  /* ---------------- 中央水池 ---------------- */
  {
    const ponds = [
      { s: TRACK_LEN * 0.395, lat: -12.0, rx: 17, rz: 7.5 },
      { s: TRACK_LEN * 0.635, lat: -13.5, rx: 14, rz: 6.5 },
      { s: TRACK_LEN * 0.865, lat: -11.0, rx: 9, rz: 5.0 },
    ];
    const water = new THREE.MeshLambertMaterial({ color: 0x2aa8e0, emissive: 0x1a6f9e, emissiveIntensity: 0.35 });
    const rimMat = new THREE.MeshLambertMaterial({ color: 0xd8c9a6 });
    ponds.forEach((pd) => {
      const p = samplePath(pd.s, {});
      const x = p.x + p.ux * pd.lat, z = p.z + p.uz * pd.lat;
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 30), water);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(pd.rx, pd.rz, 1);
      m.position.set(x, 0.036, z);
      scene.add(m);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.07, 30), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.scale.set(pd.rx, pd.rz, 1);
      rim.position.set(x, 0.03, z);
      scene.add(rim);
    });
  }

  /* ---------------- 观众席 ---------------- */
  {
    [0.11, 0.20, 0.55, 0.78].forEach((f, i) => {
      const p = samplePath(TRACK_LEN * f, {});
      const lat = HW + 7.8;
      const grp = new THREE.Group();
      grp.position.set(p.x + p.ux * lat, 0, p.z + p.uz * lat);
      grp.quaternion.setFromRotationMatrix(basisAt(p, 'face'));

      // 阶梯主体（局部 +Z 朝向赛道）
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 5.6, 6.2),
        new THREE.MeshLambertMaterial({ color: 0xb6c1d4 }));
      body.position.set(0, 2.8, -1.2);
      grp.add(body);

      // 前挡墙
      const lip = new THREE.Mesh(new THREE.BoxGeometry(20.4, 1.05, 0.5),
        new THREE.MeshLambertMaterial({ color: 0xeef3fa }));
      lip.position.set(0, 0.52, 2.15);
      grp.add(lip);

      // 人群（贴在正面，朝赛道）
      const cmap = TEX.crowd.clone();
      cmap.wrapS = cmap.wrapT = THREE.RepeatWrapping;
      cmap.repeat.set(3, 1);
      const crowd = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 3.0),
        new THREE.MeshLambertMaterial({ map: cmap }));
      crowd.position.set(0, 4.05, 1.95);
      grp.add(crowd);

      // 顶棚 + 立柱
      const roof = new THREE.Mesh(new THREE.BoxGeometry(21, 0.34, 7.4),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0x2f6fd0 : 0xd8443c }));
      roof.position.set(0, 6.35, -0.9);
      grp.add(roof);
      for (const sx of [-9.6, 9.6]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.4, 0.3),
          new THREE.MeshLambertMaterial({ color: 0x9aa4b2 }));
        col.position.set(sx, 3.7, 2.3);
        grp.add(col);
      }
      scene.add(grp);
    });
  }

  /* ---------------- 起终点门架 ---------------- */
  {
    const p = samplePath(0, {});
    const grp = new THREE.Group();
    grp.position.set(p.x, 0, p.z);
    // 用 'sign' 基：局部 X = 横向(沿赛道外法线)，局部 Z = 沿赛道方向
    // 这样 ±span/2 才是把立柱摆在赛道两侧，而不是杵在赛道中线上
    grp.quaternion.setFromRotationMatrix(basisAt(p, 'sign'));
    const span = HW * 2 + 6.4;
    for (const sx of [-span / 2, span / 2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.44, 7.2, 0.44),
        new THREE.MeshLambertMaterial({ color: 0xc7d2e0 }));
      leg.position.set(sx, 3.6, 0); grp.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.4, 1.9, 1.0),
      new THREE.MeshLambertMaterial({ color: 0x2b3446 }));
    beam.position.set(0, 7.25, 0); grp.add(beam);
    const bmat = new THREE.MeshLambertMaterial({ color: 0x2f6fd0 });
    const b1 = new THREE.Mesh(new THREE.PlaneGeometry(span, 1.5), bmat);
    b1.position.set(0, 7.25, 0.53); grp.add(b1);
    const b2 = new THREE.Mesh(new THREE.PlaneGeometry(span, 1.5), bmat);
    b2.position.set(0, 7.25, -0.53); b2.rotation.y = Math.PI; grp.add(b2);
    const fmap = TEX.checker.clone();
    fmap.wrapS = fmap.wrapT = THREE.RepeatWrapping;
    fmap.repeat.set(18, 1);
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(span + 1.4, 0.36), new THREE.MeshLambertMaterial({ map: fmap }));
    fr.position.set(0, 8.38, 0.53); grp.add(fr);
    scene.add(grp);
  }

  /* ---------------- 弯道指示牌 ---------------- */
  {
    const mat = new THREE.MeshLambertMaterial({ map: TEX.chevron, side: THREE.DoubleSide });
    [85, 134, 264, 312].forEach((sv) => {
      const p = samplePath(sv, {});
      const lat = HW + 4.1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), mat);
      m.position.set(p.x + p.ux * lat, 2.05, p.z + p.uz * lat);
      m.quaternion.setFromRotationMatrix(basisAt(p, 'sign'));
      scene.add(m);
    });
  }

  /* ---------------- 蓝色 ? 道具箱 ---------------- */
  const boxes = buildItemBoxes();
  const boxGeo = new THREE.BoxGeometry(1.05, 1.05, 1.05);
  const boxMat = new THREE.MeshLambertMaterial({ map: TEX.itembox, emissive: 0x3aa2ff, emissiveIntensity: 0.5 });
  const glowPts = [];
  boxes.forEach((b, i) => {
    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(b.x, b.baseY, b.z);
    mesh.userData.phase = i * 0.7;
    b.mesh = mesh;
    world.itemMeshes.push(mesh);
    glowPts.push(b.x, b.baseY, b.z);
    scene.add(mesh);
  });
  {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
    world.itemGlow = new THREE.Points(gg, new THREE.PointsMaterial({
      map: TEX.glowCyan, size: 3.3, sizeAttenuation: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75,
    }));
    scene.add(world.itemGlow);
  }
  world.itemBoxes = boxes;

  world.update = (dt, t) => {
    for (const m of world.itemMeshes) {
      if (!m.visible) continue;
      m.rotation.y += dt * 1.5;
      m.rotation.x = Math.sin(t * 1.4 + m.userData.phase) * 0.2;
      m.position.y = 0.95 + Math.sin(t * 2.1 + m.userData.phase) * 0.12;
    }
  };

  return world;
}

export { toWorld };
