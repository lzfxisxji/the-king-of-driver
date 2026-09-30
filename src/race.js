/* ============================================================
   比赛模拟层：车辆物理（弧长 s + 横向偏移 lat 参数化）、AI 车手、
   道具系统、碰撞、排名与完赛判定
   ============================================================ */
import { PHYS, RULES, TRACK, DRIVER_SEAT, driverMetrics, laneLat, rollItem } from './config.js';
import { samplePath, curvatureAhead, TRACK_LEN } from './track.js';
import { TEX, IMG } from './assets.js';

export const TWO_PI = Math.PI * 2;
const HW = TRACK.halfWidth;
const WALL = HW - PHYS.bodyHalfW;

export function angNorm(a) {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}
function wrapDiff(s, b) {
  const ms = ((s % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  let d = ms - b;
  if (d > TRACK_LEN / 2) d -= TRACK_LEN;
  if (d < -TRACK_LEN / 2) d += TRACK_LEN;
  return d;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/* 发车格：5 个错位车位 */
const GRID = [
  { s: -4.0, lane: 3 },
  { s: -4.0, lane: 1 },
  { s: -4.0, lane: 5 },
  { s: -9.6, lane: 2 },
  { s: -9.6, lane: 4 },
];

const carRatio = {};   // 车辆立绘宽高比缓存
function ratioOf(file) {
  if (carRatio[file] === undefined) {
    const im = IMG['car_' + file];
    carRatio[file] = im ? im.height / im.width : 0.85;
  }
  return carRatio[file];
}
const charRatio = {};
function charRatioOf(key, which) {
  const k = key + which;
  if (charRatio[k] === undefined) {
    const im = IMG['ch_' + key + '_' + which];
    charRatio[k] = im ? im.height / im.width : 1.4;
  }
  return charRatio[k];
}
/* 驾驶位贴图（只有「头 + 肩 + 一点胸」的上半身，无方向盘 / 无双手）的高宽比 */
function driveRatioOf(key) {
  const k = key + '$drive';
  if (charRatio[k] === undefined) {
    const im = IMG['ch_' + key + '_drive'];
    charRatio[k] = im ? im.height / im.width : 1.30;
  }
  return charRatio[k];
}

/* ============================================================
   车辆视图
   ============================================================ */
function makeView(r, scene) {
  const grp = new THREE.Group();
  scene.add(grp);

  // 地面软阴影
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 3.4),
    new THREE.MeshBasicMaterial({ map: TEX.blob, transparent: true, depthWrite: false, opacity: 0.75 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.035;
  shadow.renderOrder = 0;
  grp.add(shadow);

  // 车尾立绘：宽度统一，高度被夹在 Q 版比例区间（视觉上「车身低、驾驶舱开放」）
  const chKey = r.charKey, chScale = r.charScale;
  const box = driverMetrics(ratioOf(r.carFile), driveRatioOf(chKey), chScale);
  const carW = box.carW, carH = box.carH;
  const carTex = new THREE.Texture(IMG['car_' + r.carFile]);
  carTex.needsUpdate = true;
  if (THREE.SRGBColorSpace) carTex.colorSpace = THREE.SRGBColorSpace;
  const car = new THREE.Mesh(
    new THREE.PlaneGeometry(carW, carH),
    new THREE.MeshBasicMaterial({ map: carTex, transparent: true, depthWrite: false })
  );
  car.position.y = carH / 2;
  car.renderOrder = 7;   // 必须 > 驾驶员(1)：车身后画才能遮住角色下半身
  grp.add(car);

  // 驾驶员：只有「头 + 肩 + 一点胸」的上半身立绘（用背面贴图，
  // 第三人称跟车视角看到的是背影），底边落在驾驶座上并压进车身轮廓，
  // 车身后绘制覆盖角色下摆 → 看上去是「坐进驾驶舱」而不是两张图叠加
  const chH = box.chH, chW = box.chW;
  const chTex = new THREE.Texture(IMG['ch_' + chKey + '_drive']);
  chTex.needsUpdate = true;
  if (THREE.SRGBColorSpace) chTex.colorSpace = THREE.SRGBColorSpace;
  const ch = new THREE.Mesh(
    new THREE.PlaneGeometry(chW, chH),
    new THREE.MeshBasicMaterial({ map: chTex, transparent: true, depthWrite: false })
  );
  ch.renderOrder = 1;
  ch.position.y = box.seatY + chH / 2;
  grp.add(ch);
  // 车身必须排在驾驶员之后绘制，才能把角色下半身盖住（见下方 car.renderOrder）

  // 氮气焰（两处排气）
  const flames = [];
  for (let i = 0; i < 2; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.flame, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, opacity: 0,
    }));
    sp.scale.set(1.5, 1.5, 1);
    sp.renderOrder = 4;
    grp.add(sp);
    flames.push(sp);
  }

  r.view = { grp, car, ch, chW, chH, carH, shadow, flames };
}

/* ============================================================
   创建一名车手
   ============================================================ */
export function makeRacer(o) {
  const r = {
    id: o.id,
    name: o.name,
    isPlayer: !!o.isPlayer,
    charKey: o.charKey,
    charBack: o.charBack,
    charScale: o.charScale,
    carFile: o.carFile,
    color: o.color,
    lane: 3,
    s: 0, lat: 0,
    v: 0, latV: 0, slideV: 0,
    yaw: 0, x: 0, z: 0,
    stamina: PHYS.staminaMax,
    item: null,
    boosting: false,
    spin: 0, ink: 0, bolt: 0,
    lap: 1, rank: 1,
    finished: false, finishTime: 0,
    input: { throttle: 0, brake: 0, steer: 0, boost: false, useItem: false },
    ai: null,
  };
  if (!r.isPlayer) {
    const iv = 2.0 + Math.random() * 6.0;
    r.ai = {
      target: laneLat(3),
      lane: 3,
      rethink: Math.random() * 1.5,
      skill: 0.955 + Math.random() * 0.062,
      aggr: Math.random(),
      itemDelay: 1.2 + Math.random() * 3,
      wave: Math.random() * TWO_PI,
    };
  }
  return r;
}

/* ============================================================
   AI 决策
   ============================================================ */
function aiThink(race, r, dt) {
  const a = r.ai;
  a.rethink -= dt;
  if (a.rethink <= 0) {
    a.rethink = 1.0 + Math.random() * 2.2;

    // 1) 前方本车道有车 -> 变道超车
    let blocker = null, bestDs = 1e9;
    for (const o of race.racers) {
      if (o === r) continue;
      const ds = o.s - r.s;
      if (ds > 0.4 && ds < 12 && Math.abs(o.lat - r.lat) < 1.05) {
        if (ds < bestDs) { bestDs = ds; blocker = o; }
      }
    }
    let wantLane = a.lane;
    if (blocker) {
      const cand = [];
      for (const d of [-1, 1, -2, 2]) {
        const L = clamp(a.lane + d, 1, 5);
        if (L === a.lane) continue;
        const lat = laneLat(L);
        if (Math.abs(lat) > WALL - 0.2) continue;
        let free = true;
        for (const o of race.racers) {
          if (o === r) continue;
          const ds = o.s - r.s;
          if (ds > -3 && ds < 14 && Math.abs(o.lat - lat) < 1.2) { free = false; break; }
        }
        if (free) cand.push({ L, lat, d });
      }
      if (cand.length) {
        cand.sort((p, q) => Math.abs(p.lat - r.lat) - Math.abs(q.lat - r.lat));
        a.lane = cand[0].L;
        a.target = cand[0].lat;
      } else {
        a.target = clamp(blocker.lat + (Math.random() < 0.5 ? -1 : 1) * 1.6, -WALL + 0.2, WALL - 0.2);
      }
      wantLane = a.lane;
    } else {
      // 2) 无阻挡 -> 弯道贴内线（车道号 4/5 在内侧），直线按性格游走
      const cur = curvatureAhead(r.s, 28) > 0.02;
      const bias = cur ? (0.8 + a.aggr * 0.6) : ((a.aggr - 0.5) * 1.5);
      a.lane = clamp(Math.round(3 + bias), 1, 5);
      a.target = laneLat(a.lane) + (Math.random() - 0.5) * 0.5;
      wantLane = a.lane;
    }
    r.lane = wantLane;
  }

  const steer = clamp((a.target - r.lat) * 3.4, -1, 1);
  const lookDist = clamp(r.v * 1.05, 10, 34);
  const kap = curvatureAhead(r.s + 1.5, lookDist);
  const corner = 1 - clamp(kap * 7.5, 0, 0.30);

  // 橡皮筋：落后略微提速，领先略微收力
  const leadGap = race.player ? (race.player.s - r.s) : 0;
  const rubber = clamp(1 + leadGap * 0.0022, 0.945, 1.055);

  const skillSpeed = PHYS.maxSpeed * a.skill * corner * rubber;
  const boostOK = r.stamina > 16 && kap < 0.012 && r.spin <= 0 && r.bolt <= 0 && r.ink <= 0;
  const wantBoost = boostOK && r.v > skillSpeed * 0.80;

  const inp = r.input;
  inp.throttle = 1;
  inp.brake = (corner < 0.92 && r.v > skillSpeed * 1.03) ? 1 : 0;
  inp.steer = steer;
  inp.boost = wantBoost;
  inp.useItem = false;

  // 3) 道具决策
  if (r.item) {
    a.itemDelay -= dt;
    if (a.itemDelay <= 0) {
      inp.useItem = true;
      a.itemDelay = 1.6 + Math.random() * 3.4;
    }
  } else {
    a.itemDelay = 0.4 + Math.random() * 1.2;
  }
}

/* ============================================================
   单个车手的物理步进
   ============================================================ */
function stepRacer(race, r, dt, active) {
  const inp = r.input;

  // ---- 体力 / 氮气 ----
  const candBoost = !!inp.boost && r.stamina > 0.5 && active && r.spin <= 0;
  if (candBoost) {
    r.stamina -= PHYS.boostDrain * dt;
    if (r.stamina < 0) r.stamina = 0;
  } else {
    r.stamina = Math.min(PHYS.staminaMax, r.stamina + PHYS.staminaRegen * dt);
  }
  r.boosting = candBoost;
  if (r.boosting) r.boostTime = (r.boostTime || 0) + dt;

  // ---- 目标极速 ----
  let maxV = candBoost ? PHYS.boostSpeed : PHYS.maxSpeed;
  if (r.bolt > 0) maxV *= PHYS.boltSlow;
  if (r.ink > 0) maxV *= PHYS.inkSlow;

  // ---- 纵向 ----
  let acc;
  if (r.spin > 0) {
    acc = -PHYS.brake * 0.5;
  } else if (!active) {
    acc = -PHYS.brake;
  } else if (inp.brake > 0) {
    acc = -PHYS.brake;
  } else if (inp.throttle > 0) {
    acc = candBoost ? PHYS.boostAccel : PHYS.accel;
  } else {
    acc = -PHYS.coastDrag;
  }
  r.v += acc * dt;
  if (r.v > maxV) r.v = Math.max(maxV, r.v - 26 * dt);
  if (r.v < PHYS.reverseSpeed) r.v = PHYS.reverseSpeed;
  if (!active && r.v < 0) r.v = 0;

  // ---- 曲率采样 ----
  const tmp = samplePath(r.s, {});
  const kappa = tmp.kappa;

  // ---- 横向 ----
  let latTarget = 0;
  if (r.spin > 0) {
    latTarget = Math.sin(r.spin * 13.5) * 1.0;
  } else if (active) {
    const spd = clamp(Math.abs(r.v) / 11, 0, 1);
    latTarget = inp.steer * (1 - Math.exp(-PHYS.steerLerp * dt)) * 1.0;
    r.latV = lerp(r.latV, inp.steer * PHYS.steerLat * spd, 1 - Math.exp(-PHYS.steerLerp * dt));
  } else {
    r.latV = lerp(r.latV, 0, 1 - Math.exp(-4 * dt));
  }
  // 弯道离心外滑
  const over = r.v * r.v * kappa - PHYS.gripLimit;
  if (over > 0) r.slideV += over * PHYS.slideK * dt * 5.0;
  r.slideV *= Math.exp(-dt * 2.3);
  r.slideV = clamp(r.slideV, -3.5, 6.0);

  let totalLatV = r.latV + r.slideV;
  if (r.spin > 0) totalLatV += latTarget * 4.2;

  r.lat += totalLatV * dt;

  // ---- 撞墙 ----
  if (r.lat > WALL) {
    r.lat = WALL;
    if (totalLatV > 0) { r.slideV = 0; r.latV *= -0.25; }
    r.v *= (1 - 1.4 * dt);
    r.wallHits = (r.wallHits || 0) + 1;
    if (race.onEvent) race.onEvent('wall', r);
  } else if (r.lat < -WALL) {
    r.lat = -WALL;
    if (totalLatV < 0) { r.slideV = 0; r.latV *= -0.25; }
    r.v *= (1 - 1.4 * dt);
    r.wallHits = (r.wallHits || 0) + 1;
    if (race.onEvent) race.onEvent('wall', r);
  }

  // ---- 前进 ----
  r.s += r.v * dt;

  // ---- 计时衰减 ----
  if (r.spin > 0) r.spin = Math.max(0, r.spin - dt);
  if (r.ink > 0) r.ink = Math.max(0, r.ink - dt);
  if (r.bolt > 0) r.bolt = Math.max(0, r.bolt - dt);

  // ---- 圈数 / 完赛 ----
  const lapNow = Math.min(RULES.laps, Math.max(1, Math.floor(r.s / TRACK_LEN) + 1));
  if (lapNow !== r.lap && race.onEvent && !r.finished) { r.lap = lapNow; race.onEvent('lap', r); }
  r.lap = lapNow;
  if (!r.finished && r.s >= RULES.laps * TRACK_LEN) {
    r.finished = true;
    r.finishTime = race.time;
    race.finishOrder.push(r);
    if (race.onEvent) race.onEvent('finish', r);
  }

  // ---- 世界位姿 ----
  const p = samplePath(r.s, {});
  r.x = p.x + p.ux * r.lat;
  r.z = p.z + p.uz * r.lat;
  const vx = p.tx * r.v + p.ux * totalLatV;
  const vz = p.tz * r.v + p.uz * totalLatV;
  if (Math.abs(vx) + Math.abs(vz) > 0.01) r.yaw = Math.atan2(vz, vx);
  r.pathT = p;
}

/* ============================================================
   车与车碰撞
   ============================================================ */
function resolveCarCollisions(race, dt) {
  const rs = race.racers;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const A = rs[i], B = rs[j];
      const ds = A.s - B.s;
      const dlat = A.lat - B.lat;
      if (Math.abs(ds) > PHYS.bodyHalfL * 1.85 || Math.abs(dlat) > PHYS.bodyHalfW * 1.9) continue;

      const dir = ds >= 0 ? 1 : -1;      // A 在 B 前方
      const behind = dir > 0 ? B : A;
      const front = dir > 0 ? A : B;

      // 侧向互推
      const push = (PHYS.bodyHalfW * 1.9 - Math.abs(dlat)) * 0.5;
      const sgn = dlat >= 0 ? 1 : -1;
      A.lat += sgn * push * 0.5;
      B.lat -= sgn * push * 0.5;

      // 追尾：后车减速，前车被轻推
      const relV = behind.v - front.v;
      if (relV > 0) {
        behind.v -= relV * 0.55;
        front.v += relV * 0.16;
        if (Math.abs(ds) < 1.5 && race.onEvent && relV > 4.5) race.onEvent('bump', behind);
      }
      A.lat = clamp(A.lat, -WALL, WALL);
      B.lat = clamp(B.lat, -WALL, WALL);
    }
  }
}

/* ============================================================
   Race
   ============================================================ */
export class Race {
  constructor(roster, scene, hooks = {}) {
    this.racers = roster.map((o, i) => makeRacer({ ...o, color: o.color }));
    this.player = this.racers.find((r) => r.isPlayer) || null;
    this.byId = {};
    this.racers.forEach((r) => { this.byId[r.id] = r; this.shuffleGrid(r); });
    this.scene = scene;
    this.onEvent = hooks.onEvent || null;
    this.itemBoxes = (hooks.world && hooks.world.itemBoxes) || [];
    this.time = 0;
    this.phase = 'countdown';
    this.countdown = RULES.countdown;
    this.finishOrder = [];
    this.bananas = [];
    this.pendingUse = null;      // 玩家正在瞄准的香蕉
    this.aimLane = 3;
    this.inkTimer = 0;           // 玩家屏幕墨水
    this.flashTimer = 0;
    this.itemSpawn = 0;
    this.racers.forEach((r) => makeView(r, scene));
    this.computeRanks();
  }

  shuffleGrid(r) {
    if (!this._gridPool) {
      this._gridPool = GRID.map((g, i) => i);
      for (let i = this._gridPool.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [this._gridPool[i], this._gridPool[j]] = [this._gridPool[j], this._gridPool[i]];
      }
    }
    const gi = this._gridPool.pop() || 0;
    const g = GRID[gi];
    r.s = g.s;
    r.lat = laneLat(g.lane);
    r.lane = g.lane;
    if (r.ai) { r.ai.lane = g.lane; r.ai.target = r.lat; }
  }

  /* ---------------- 主步进 ---------------- */
  step(dt, playerInput) {
    const active = this.phase === 'running';
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'running';
        this.countdown = 0;
        if (this.onEvent) this.onEvent('go');
      }
    } else if (this.phase === 'running') {
      this.time += dt;
    }

    for (const r of this.racers) {
      if (r.isPlayer) {
        const i = r.input;
        if (active && !r.finished) {
          i.throttle = playerInput.throttle;
          i.brake = playerInput.brake;
          i.steer = playerInput.steer;
          i.boost = playerInput.boost;
        } else {
          i.throttle = 0; i.brake = r.finished ? 1 : 0; i.steer = 0; i.boost = false;
        }
        i.useItem = playerInput.useItem;
      } else {
        if (active) aiThink(this, r, dt);
        else { r.input.throttle = 0; r.input.brake = 0; r.input.steer = 0; r.input.boost = false; r.input.useItem = false; }
        if (r.finished) { r.input.throttle = 0; r.input.brake = 1; r.input.steer = 0; r.input.boost = false; }
      }
    }

    for (const r of this.racers) stepRacer(this, r, dt, active);
    resolveCarCollisions(this, dt);

    if (active) {
      this.handleItems(dt);
      this.handleItemBoxes(dt);
      this.handleBananas(dt);
    }
    this.computeRanks();

    if (this.inkTimer > 0) this.inkTimer = Math.max(0, this.inkTimer - dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
  }

  /* ---------------- 排名 ---------------- */
  computeRanks() {
    const arr = this.racers.slice();
    arr.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.s - a.s;
    });
    arr.forEach((r, i) => { r.rank = i + 1; });
    this.standings = arr;
  }

  /* ---------------- 道具箱 ---------------- */
  handleItemBoxes(dt) {
    for (const b of this.itemBoxes) {
      if (!b.active) {
        b.timer -= dt;
        if (b.timer <= 0) { b.active = true; if (b.mesh) b.mesh.visible = true; }
        continue;
      }
      for (const r of this.racers) {
        if (r.finished || r.item) continue;
        if (Math.abs(wrapDiff(r.s, b.s)) > 1.7) continue;
        if (Math.abs(r.lat - b.lat) > 1.15) continue;
        b.active = false;
        b.timer = RULES.itemRespawn;
        if (b.mesh) b.mesh.visible = false;
        r.item = rollItem(r.rank, this.racers.length);
        if (this.onEvent) this.onEvent('pickup', r);
        break;
      }
    }
  }

  /* ---------------- 道具使用 ---------------- */
  handleItems(dt) {
    // 玩家瞄准中
    if (this.pendingUse) {
      this.pendingUse.t -= dt;
      if (this.pendingUse.t <= 0) this.confirmAim();
    }
    for (const r of this.racers) {
      if (!r.item) continue;
      if (!r.input.useItem) continue;
      r.input.useItem = false;
      if (r.isPlayer) {
        if (r.item === 'banana') {
          if (!this.pendingUse) {
            this.pendingUse = { r, t: 2.6 };
            this.aimLane = clamp(Math.round(3 - r.lat / TRACK.laneW), 1, 5);
          }
        } else {
          this.fireItem(r, null);
        }
      } else {
        this.fireItem(r, this.aiPickLane(r));
      }
    }
  }

  aiPickLane(r) {
    if (r.item !== 'banana') return null;
    let best = null, bd = 1e9;
    for (const o of this.racers) {
      if (o === r) continue;
      const ds = r.s - o.s;
      if (ds > 0 && ds < 26 && ds < bd) { bd = ds; best = o; }
    }
    const lat = best ? best.lat : 0;
    return clamp(Math.round(3 - lat / TRACK.laneW), 1, 5);
  }

  confirmAim() {
    if (!this.pendingUse) return;
    const { r } = this.pendingUse;
    this.pendingUse = null;
    if (r.item === 'banana') this.fireItem(r, this.aimLane);
  }

  cancelAim() { this.pendingUse = null; }

  fireItem(r, lane) {
    const item = r.item;
    r.item = null;
    if (item === 'banana') {
      const L = lane || 3;
      const s = r.s - 3.2;
      const p = samplePath(s, {});
      const lat = laneLat(L);
      this.bananas.push({
        s, lat,
        x: p.x + p.ux * lat, z: p.z + p.uz * lat,
        owner: r.id, life: 24,
        mesh: this.makeBananaMesh(p.x + p.ux * lat, p.z + p.uz * lat, s),
      });
      if (this.onEvent) this.onEvent('use', r, 'banana', L);
    } else if (item === 'potion') {
      r.stamina = Math.min(PHYS.staminaMax, r.stamina + RULES.potionHeal);
      if (this.onEvent) this.onEvent('use', r, 'potion');
    } else if (item === 'ink') {
      // 命中前方最近对手
      let best = null, bd = 1e9;
      for (const o of this.racers) {
        if (o === r) continue;
        const ds = o.s - r.s;
        if (ds > 0 && ds < 55 && ds < bd) { bd = ds; best = o; }
      }
      if (!best) {
        for (const o of this.racers) {
          if (o === r) continue;
          const ds = Math.abs(o.s - r.s);
          if (ds < bd) { bd = ds; best = o; }
        }
      }
      if (best) {
        best.ink = RULES.inkDuration;
        if (best.isPlayer) this.inkTimer = RULES.inkDuration;
        if (this.onEvent) this.onEvent('hit', r, best, 'ink');
      }
      if (this.onEvent) this.onEvent('use', r, 'ink');
    } else if (item === 'bolt') {
      let hit = 0;
      for (const o of this.racers) {
        if (o === r) continue;
        o.bolt = RULES.boltDuration;
        hit++;
      }
      if (this.player && this.player !== r && this.player.bolt > 0) this.flashTimer = 0.5;
      if (this.onEvent) this.onEvent('use', r, 'bolt', hit);
    }
  }

  makeBananaMesh(x, z, s) {
    const p = samplePath(s, {});
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.13, 6, 12, Math.PI * 1.1),
      new THREE.MeshLambertMaterial({ color: 0xffd63d, emissive: 0xa07a00, emissiveIntensity: 0.35 })
    );
    body.rotation.x = -Math.PI / 2;
    body.position.y = 0.14;
    g.add(body);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55,
    }));
    glow.scale.set(1.8, 1.8, 1);
    glow.position.y = 0.3;
    g.add(glow);
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * TWO_PI;
    this.scene.add(g);
    return g;
  }

  handleBananas(dt) {
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bananas.splice(i, 1);
        continue;
      }
      for (const r of this.racers) {
        if (r.id === b.owner || r.spin > 0) continue;
        if (Math.abs(wrapDiff(r.s, b.s)) > 1.5) continue;
        if (Math.abs(r.lat - b.lat) > 1.0) continue;
        r.spin = PHYS.spinTime;
        r.v *= 0.55;
        if (this.onEvent) this.onEvent('spin', r);
        this.scene.remove(b.mesh);
        this.bananas.splice(i, 1);
        break;
      }
    }
  }

  /* ---------------- 视图同步 ---------------- */
  syncViews(dt, t, camera) {
    const camPos = camera.position;
    for (const r of this.racers) {
      const v = r.view;
      if (!v) continue;
      v.grp.position.set(r.x, 0, r.z);
      v.grp.visible = true;

      const yaw = r.yaw;
      // 车尾朝向 + 向相机方向混一点，避免侧视时立绘消失
      const tCar = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
      const ex = camPos.x - r.x, ez = camPos.z - r.z;
      const tCam = Math.atan2(ex, ez);
      let d = angNorm(tCam - tCar);
      const blend = r.isPlayer ? 0.42 : 0.30;
      const th = tCar + d * blend;

      v.car.rotation.y = th;
      v.car.rotation.z = clamp(-r.latV * 0.028, -0.16, 0.16) + (r.spin > 0 ? Math.sin(r.spin * 22) * 0.2 : 0);

      // 角色：与车同向，略微靠"车头方向"，让车身自然遮住下半身
      v.ch.rotation.y = th;
      const fx = Math.cos(yaw) * DRIVER_SEAT.charZ, fz = Math.sin(yaw) * DRIVER_SEAT.charZ;
      v.ch.position.set(fx, v.ch.position.y, fz);

      // 冲刺焰（高度跟随车身，换低矮敞篷车后排气口也跟着下移）
      const on = r.boosting;
      const perpX = -Math.sin(yaw), perpZ = Math.cos(yaw);
      const bX = -Math.cos(yaw) * 1.02, bZ = -Math.sin(yaw) * 1.02;
      const flameY = v.carH * 0.46;
      v.flames.forEach((sp, i) => {
        const sgn = i === 0 ? -1 : 1;
        sp.position.set(bX + perpX * 0.44 * sgn, flameY, bZ + perpZ * 0.44 * sgn);
        const sc = on ? 1.15 + Math.random() * 0.55 : 0;
        sp.scale.set(sc * 1.5, sc * 1.3, 1);
        sp.material.opacity = on ? 0.85 : 0;
      });

      // 中闪电闪烁
      const vis = r.bolt > 0 ? (Math.floor(t * 14) % 2 === 0) : true;
      v.car.material.opacity = vis ? 1 : 0.45;
      v.car.material.transparent = true;
    }
  }

  get allFinished() {
    return this.racers.every((r) => r.finished);
  }
}
