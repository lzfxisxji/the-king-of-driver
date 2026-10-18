import { FEATURES, createCourseMesh, positionCourseMesh } from './course.js';
/* ============================================================
   3D 世界构建：地面 / 赛道带 / 路肩 / 护栏 / 轮胎墙 / 路灯 /
   树木 / 水面 / 观众席 / 起终点门架 / 蓝色 ? 道具箱
   ============================================================ */
import { TRACK, PONDS } from './config.js';
import { TEX } from './assets.js';
import { buildPolyline, scatterOutside, buildItemBoxes, toWorld, samplePath, sampleRoute, SHORTCUT, ACTIVE_MAP, TRACK_LEN, WAYPOINT_S, GAPS, gapAt, roadHeight } from './track.js';

const HW = TRACK.halfWidth;
const YAXIS = new THREE.Vector3(0, 1, 0);

/* 用基向量搭一个"沿赛道朝向"的旋转矩阵：X=横向(u)，Y=垂直，Z=纵向 */
function basisAt(p, mode) {
  const u3 = new THREE.Vector3(p.ux, 0, p.uz);
  const t3 = new THREE.Vector3(p.tx, p.grade||0, p.tz).normalize();
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
    pos[i * 6 + 1] = (p.y||0) + yA + latA*Math.tan(p.bank||0);
    pos[i * 6 + 2] = p.z + p.uz * latA;
    pos[i * 6 + 3] = p.x + p.ux * latB;
    pos[i * 6 + 4] = (p.y||0) + yB + latB*Math.tan(p.bank||0);
    pos[i * 6 + 5] = p.z + p.uz * latB;
    uv[i * 4 + 0] = vA; uv[i * 4 + 1] = p.s / repeatAlong;
    uv[i * 4 + 2] = vB; uv[i * 4 + 3] = p.s / repeatAlong;
  }
  for (let i = 0; i < n - 1; i++) {
    if(gapAt((pts[i].s+pts[i+1].s)/2,opt.route||'main'))continue;
    if(opt.innerRail&&(Math.abs(pts[i].s-SHORTCUT.s0)<10||Math.abs(pts[i].s-SHORTCUT.s1)<10))continue;
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
    grd.addColorStop(0, ACTIVE_MAP.sky[0]);grd.addColorStop(.55, ACTIVE_MAP.sky[1]);grd.addColorStop(1, ACTIVE_MAP.sky[2]);
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
  scene.fog = new THREE.Fog(ACTIVE_MAP.fog, 140, 340);

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
    new THREE.MeshLambertMaterial({ color: ACTIVE_MAP.ground })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  scene.add(grass);

  /* ---------------- 赛道 & 路肩 ---------------- */
  const { pts } = buildPolyline(0.85);
  scene.add(new THREE.Mesh(
    buildRibbon(pts, { latA: -HW, latB: HW, yA: 0.02, yB: 0.02, vA: 0, vB: 1, repeatAlong: 13.9 }),
    ACTIVE_MAP.id==='ice'?new THREE.MeshPhongMaterial({map:TEX.road,color:ACTIVE_MAP.road,specular:0xbdeeff,shininess:80}):new THREE.MeshLambertMaterial({ map: TEX.road, color:ACTIVE_MAP.road })
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
    m.position.set(p.x, p.y+0.058, p.z);
    scene.add(m);
  }

  /* ---------------- 外侧护栏 ---------------- */
  const railLat = HW + .75;
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
      (p, i, m) => m.makeTranslation(p.x + p.ux * railLat, roadHeight(p.s,railLat)+0.55, p.z + p.uz * railLat)));
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
            y: p.y + 0.2 + stack * 0.38, c: palette[(ci + stack) % palette.length],
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
        const lat = side * (HW + .55);
        const p = samplePath(s + (side > 0 ? 0 : 8.5), {});
        const x = p.x + p.ux * lat, z = p.z + p.uz * lat;
        poles.push({ x, z, y:roadHeight(s+(side>0?0:8.5),lat) });
        glows.push(x, p.y+4.05, z);
      }
    }
    scene.add(inst(new THREE.CylinderGeometry(0.09, 0.13, 3.8, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a414d }), poles,
      (p, i, m) => m.makeTranslation(p.x, p.y+1.9, p.z)));
    scene.add(inst(new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xfff0c0, emissive: 0xffd98a, emissiveIntensity: 0.9 }), poles,
      (p, i, m) => m.makeTranslation(p.x, p.y+4.05, p.z)));
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glows, 3));
    scene.add(new THREE.Points(gg, new THREE.PointsMaterial({
      map: TEX.glowWarm, size: 5.4, sizeAttenuation: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
    })));
  }

  /* ---------------- 树木 ---------------- */
  if (!TRACK.city) {
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

  /* ---------------- 中央水池（数据来自 config.PONDS，与涉水减速判定同源） ---------------- */
  {
    const water = new THREE.MeshLambertMaterial({ color: 0x2aa8e0, emissive: 0x1a6f9e, emissiveIntensity: 0.35 });
    const rimMat = new THREE.MeshLambertMaterial({ color: 0xd8c9a6 });
    PONDS.forEach((pd) => {
      const p = samplePath(pd.sf * TRACK_LEN, {});
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
    grp.position.set(p.x, p.y, p.z);
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
      m.position.set(p.x + p.ux * lat, roadHeight(sv,lat)+2.05, p.z + p.uz * lat);
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
    const mesh = new THREE.Mesh(boxGeo, b.item ? new THREE.MeshLambertMaterial({map:TEX.itembox,color:b.item==='jump'?0x5fffd0:0xffb750,emissive:0x287b63,emissiveIntensity:.45}) : boxMat);
    mesh.position.set(b.x, b.baseY, b.z);
    mesh.userData.phase = i * 0.7;mesh.userData.baseY=b.baseY;
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

  const courseMeshes=FEATURES.map(f=>{const m=createCourseMesh(f);scene.add(m);return m;});
  const branchPts=Array.from({length:101},(_,i)=>{const s=SHORTCUT.s0+(SHORTCUT.s1-SHORTCUT.s0)*i/100;return {...sampleRoute(s,'shortcut'),s};});
  const bridge=new THREE.Mesh(buildRibbon(branchPts,{latA:-SHORTCUT.halfWidth,latB:SHORTCUT.halfWidth,yA:.02,yB:.02,route:'shortcut'}),new THREE.MeshLambertMaterial({color:0x30495c,side:THREE.DoubleSide}));scene.add(bridge);
  for(const side of [-1,1]){
    const edge=new THREE.Mesh(buildRibbon(branchPts,{latA:side*SHORTCUT.halfWidth-.12,latB:side*SHORTCUT.halfWidth+.12,yA:.10,yB:.10,route:'shortcut'}),new THREE.MeshBasicMaterial({color:0xffb13e,side:THREE.DoubleSide}));scene.add(edge);
  }
  // Structural decks, columns and inner barriers follow the same 3D centreline.
  const structureMat=new THREE.MeshLambertMaterial({color:ACTIVE_MAP.id==='ice'?0x638fa5:0x63768a,side:THREE.DoubleSide});
  const pierMat=new THREE.MeshLambertMaterial({color:ACTIVE_MAP.id==='desert'?0xbda188:0x899ba7});
  const allPaths=[...pts,...branchPts];
  function roadStructure(path,halfWidth,route){
    scene.add(new THREE.Mesh(buildRibbon(path,{latA:-halfWidth-.9,latB:halfWidth+.9,yA:-.65,yB:-.65,route}),structureMat));
    for(const side of [-1,1]){
      scene.add(new THREE.Mesh(buildRibbon(path,{latA:side*(halfWidth+.9),latB:side*(halfWidth+.9),yA:-.65,yB:.02,route}),structureMat));
      if(side<0||route==='shortcut'){
        scene.add(new THREE.Mesh(buildRibbon(path,{latA:side*(halfWidth+.55),latB:side*(halfWidth+.55),yA:.2,yB:.9,route,innerRail:route==='main'}),new THREE.MeshLambertMaterial({color:ACTIVE_MAP.id==='ice'?0x8dd9ef:0xc3d3de,side:THREE.DoubleSide,transparent:true,opacity:.8})));
      }
    }
    const stride=route==='main'?18:9;
    for(let i=4;i<path.length-4;i+=stride){const p=path[i];if(p.y<4||gapAt(p.s,route))continue;
      for(const side of [-1,1]){const lat=side*(halfWidth-.65),x=p.x+p.ux*lat,z=p.z+p.uz*lat;
        if(allPaths.some(q=>q.y<p.y-4&&Math.hypot(q.x-x,q.z-z)<HW+1.6))continue;
        const h=p.y-.7,m=new THREE.Mesh(new THREE.CylinderGeometry(.55,.85,h,6),pierMat);m.position.set(x,h/2,z);scene.add(m);
      }
    }
  }
  roadStructure(pts,HW,'main');roadStructure(branchPts,SHORTCUT.halfWidth,'shortcut');
  // A short covered section frames the lower crossing before the climb.
  if(ACTIVE_MAP.id!=='ice'){
    const from=ACTIVE_MAP.id==='city'?6:13;
    for(let k=0;k<4;k++){const s=WAYPOINT_S[from]+(WAYPOINT_S[from+1]-WAYPOINT_S[from])*(.2+k*.2),p=samplePath(s),g=new THREE.Group();
      const concrete=new THREE.MeshLambertMaterial({color:ACTIVE_MAP.id==='city'?0x8399a8:0xb9a58a});
      for(const side of [-1,1]){const col=new THREE.Mesh(new THREE.BoxGeometry(.8,8,1.1),concrete);col.position.set(side*(HW+1.15),4,0);g.add(col);}
      const roof=new THREE.Mesh(new THREE.BoxGeometry((HW+1.5)*2,.6,2.8),concrete);roof.position.y=8;g.add(roof);
      g.position.set(p.x,p.y,p.z);g.rotation.y=Math.atan2(p.ux,p.uz)+Math.PI/2;scene.add(g);
    }
  }
  const sign=(s,lat,text,color)=>{
    const p=samplePath(s),cv=document.createElement('canvas');cv.width=768;cv.height=192;
    const c=cv.getContext('2d');c.fillStyle=color;c.fillRect(0,0,768,192);c.strokeStyle='#fff';c.lineWidth=8;c.strokeRect(8,8,752,176);c.fillStyle='#fff';c.font='bold 54px sans-serif';c.textAlign='center';c.fillText(text,384,118);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(10,2.5),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),side:THREE.DoubleSide}));m.position.set(p.x+p.ux*lat,roadHeight(s,lat)+4,p.z+p.uz*lat);m.quaternion.setFromRotationMatrix(basisAt(p,'sign'));scene.add(m);
  };
  sign(SHORTCUT.s0-18,0,'内侧 ← '+ACTIVE_MAP.branchName+' / 主路 →',ACTIVE_MAP.accent);
  sign(SHORTCUT.s0-5,-9,ACTIVE_MAP.id==='desert'?'跨谷高架 · 断桥飞跃':ACTIVE_MAP.id==='ice'?'盘旋冰桥 · 小心断口':'双层立交 · 空中近道',ACTIVE_MAP.accent);
  sign(TRACK_LEN*.025,-9,'SHIFT 漂移 · 高架立体竞速','#22639c');
  for(const gap of GAPS)if(gap.route==='main')sign(gap.start-22,0,'断桥在前 · 保持速度飞跃',ACTIVE_MAP.accent);
  // City blocks kept clear of both racing routes.
  const occupied=(x,z,r)=>{for(let i=0;i<pts.length;i+=8)if(Math.hypot(x-pts[i].x,z-pts[i].z)<r+12)return true;return branchPts.some(p=>Math.hypot(x-p.x,z-p.z)<r+7);};
  if(ACTIVE_MAP.id==='city'){
  const cityWindows=[];
  for(let x=-125;x<=125;x+=25)for(let z=-100;z<=125;z+=25){
    const h=8+((x*x+z*z)%31);if(occupied(x,z,9))continue;
    const material=new THREE.MeshLambertMaterial({color:((x+z)%3)?0x627f99:0x879cae});
    const block=new THREE.Mesh(new THREE.BoxGeometry(15,h,15),material);block.position.set(x,h/2,z);scene.add(block);
    for(let y=3;y<h-1;y+=4)for(let q=-5;q<=5;q+=5)for(const side of [-1,1]){
      cityWindows.push({x:x+q,y,z:z+side*7.55,rot:0});cityWindows.push({x:x+side*7.55,y,z:z+q,rot:Math.PI/2});
    }
    const roof=new THREE.Mesh(new THREE.BoxGeometry(15.5,.6,15.5),new THREE.MeshLambertMaterial({color:0xa9bbc9}));roof.position.set(x,h,z);scene.add(roof);
  }
  scene.add(inst(new THREE.BoxGeometry(2,1.4,.08),new THREE.MeshBasicMaterial({color:0xf6d9a0}),cityWindows,(it,i,m)=>{m.makeRotationY(it.rot);m.setPosition(it.x,it.y,it.z);}));
  // A recognizable construction crane beside the bridge.
  const steel=new THREE.MeshLambertMaterial({color:0xf3b93f});
  for(const [w,h,d,x,y,z] of [[1.2,23,1.2,-12,11.5,47],[31,1,1,-3,23,47],[.1,13,.1,11,16,47],[2,1,2,11,9,47]]){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),steel);m.position.set(x,y,z);scene.add(m);}
  } else {
    // Deterministic rocks / ice peaks with clearance from both playable routes.
    const ice=ACTIVE_MAP.id==='ice';
    const rockMat=new THREE.MeshLambertMaterial({color:ice?0x8cc9dc:0xb5714b,flatShading:true});
    const capMat=new THREE.MeshLambertMaterial({color:ice?0xf1fcff:0xe3ad77,flatShading:true});
    for(let x=-145;x<=145;x+=22)for(let z=-110;z<=132;z+=22){
      const h=9+Math.abs((x*13+z*7)%25);if(occupied(x,z,10)||(ice&&Math.hypot(x/44,z/27)<1))continue;
      const m=new THREE.Mesh(ice?new THREE.ConeGeometry(11,h,5):new THREE.CylinderGeometry(8,12,h,6),rockMat);
      m.position.set(x,h/2,z);m.rotation.y=(x+z)*.13;scene.add(m);
      const cap=new THREE.Mesh(ice?new THREE.ConeGeometry(6,h*.47,5):new THREE.CylinderGeometry(8.2,8.8,1.5,6),capMat);
      cap.position.set(x,ice?h*.8:h,z);cap.rotation.y=m.rotation.y;scene.add(cap);
      if(!ice){const cactus=new THREE.Mesh(new THREE.CylinderGeometry(.55,.7,4,6),new THREE.MeshLambertMaterial({color:0x547c57}));cactus.position.set(x+13,2,z+4);if(!occupied(x+13,z+4,1))scene.add(cactus);}
    }
    if(ice){
      const bay=new THREE.Mesh(new THREE.CircleGeometry(1,64),new THREE.MeshPhongMaterial({color:0x4ba6bb,specular:0xb9eeff,shininess:100}));bay.rotation.x=-Math.PI/2;bay.scale.set(40,24,1);bay.position.y=.015;scene.add(bay);
      for(const [x,z,scale] of [[-17,0,4],[11,9,6],[3,-10,5],[22,-3,3]]){const floe=new THREE.Mesh(new THREE.CircleGeometry(scale,6),new THREE.MeshLambertMaterial({color:0xe9fbff}));floe.rotation.x=-Math.PI/2;floe.position.set(x,.04,z);scene.add(floe);}
      const glowMat=new THREE.MeshBasicMaterial({color:0x67e5d0,side:THREE.DoubleSide,transparent:true,opacity:.25,depthWrite:false});
      for(let j=0;j<3;j++){const ribbon=[];for(let i=0;i<=48;i++){const x=-180+i*7.5,y=42+Math.sin(i*.18+j)*8,z=-135+j*11;ribbon.push(x,y,z,x,y+8,z);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(ribbon,3));const ids=[];for(let i=0;i<48;i++){const n=i*2;ids.push(n,n+1,n+3,n,n+3,n+2);}geo.setIndex(ids);const mesh=new THREE.Mesh(geo,glowMat);scene.add(mesh);}
    }else{
      const sunDisk=new THREE.Mesh(new THREE.SphereGeometry(13,20,12),new THREE.MeshBasicMaterial({color:0xffda85}));sunDisk.position.set(-120,52,-180);scene.add(sunDisk);
    }
  }
  world.roadPoints=pts;world.branchPoints=branchPts;
  world.courseMeshes=courseMeshes;
  world.update = (dt, t, gameTime=t) => {
    courseMeshes.forEach((m,i)=>positionCourseMesh(m,FEATURES[i],gameTime));
    for (const m of world.itemMeshes) {
      if (!m.visible) continue;
      m.rotation.y += dt * 1.5;
      m.rotation.x = Math.sin(t * 1.4 + m.userData.phase) * 0.2;
      m.position.y = m.userData.baseY + Math.sin(t * 2.1 + m.userData.phase) * 0.12;
    }
  };

  world.dispose=()=>{
    const geos=new Set(),mats=new Set(),textures=new Set(),shared=new Set(Object.values(TEX));
    scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m){mats.add(m);for(const v of Object.values(m))if(v?.isTexture&&!shared.has(v))textures.add(v);}});
    geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  };
  return world;
}

export { toWorld };
