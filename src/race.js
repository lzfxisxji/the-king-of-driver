import { FEATURES, featureState, createCourseMesh, positionCourseMesh, setGateVisual } from './course.js';
/* ============================================================
   比赛模拟层：车辆物理（弧长 s + 横向偏移 lat 参数化）、AI 车手、
   道具系统、碰撞、排名与完赛判定
   ============================================================ */
import { PHYS, RULES, TRACK, DRIVER_SEAT, driverMetrics, laneLat, rollItem, AI, CARS, PONDS } from './config.js';
import { samplePath, sampleRoute, SHORTCUT, curvatureAhead, TRACK_LEN, GAPS, gapAt, roadHeight } from './track.js';
import { TEX, IMG } from './assets.js';
import { createKart } from './kart3d.js';

export const TWO_PI = Math.PI * 2;
const HW = TRACK.halfWidth;
const WALL = HW - PHYS.bodyHalfW;

/* 水池在世界坐标里的位置（与 world.js 画出的水面完全同一份几何）：
   轴对齐椭圆，半轴 rx / rz。用于「涉水减速」判定。 */
const POND_WORLD = PONDS.map((pd) => {
  const p = samplePath(pd.sf * TRACK_LEN, {});
  return { x: p.x + p.ux * pd.lat, z: p.z + p.uz * pd.lat, rx: pd.rx, rz: pd.rz };
});

/** 世界坐标 (x, z) 是否落在某个水池范围内 */
export function inWater(x, z) {
  for (const q of POND_WORLD) {
    const dx = (x - q.x) / q.rx, dz = (z - q.z) / q.rz;
    if (dx * dx + dz * dz <= 1) return true;
  }
  return false;
}

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

  // 3D 卡丁车 + 多视角精灵角色（车头 +Z；整体缩放 1.0 时轮胎恰好着地 y=0）
  const car = CARS.find((c) => c.file === r.carFile) || CARS[0];
  const kart = createKart({
    style: car.style, model: car.model, bodyColor: car.bodyColor, accent: car.accent,
    charKey: r.charKey,
  });
  grp.add(kart.group);

  const sparks=[-1,1].map(side=>{const m=new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.glowWarm,color:0x55e9ff,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));m.position.set(side*.85,.25,-1.1);m.scale.set(1,1,1);m.visible=false;grp.add(m);return m;});
  r.view = { grp, kart, shadow, sparks };

  // 护盾气泡（默认隐藏，持有护盾时显示）
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0x66e0ff, transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.DoubleSide,
    })
  );
  shield.position.y = 1.05;
  shield.renderOrder = 9;
  shield.visible = false;
  grp.add(shield);
  r.view.shield = shield;
}

/* ============================================================
   创建一名车手
   ============================================================ */
export function makeRacer(o) {
  const r = {
    id: o.id,
    name: o.name,
    isPlayer: !!o.isPlayer,
    isLocal: !!o.isLocal,        // 本客户端用键盘直接操控（仅房主侧自己的车）
    charKey: o.charKey,
    charBack: o.charBack,
    charScale: o.charScale,
    carFile: o.carFile,
    color: o.color,
    netInput: {                   // 联机时，远程玩家由房主网络输入驱动
      throttle: 0, brake: 0, steer: 0, boost: false, drift:false, useItem: false, aimLane: 3,
    },
    lane: 3,
    s: 0, lat: 0, route: 'main', driftCharge:0, drifting:false, miniBoost:0, jumpTime:0, jumpY:0, hazardCooldown:0,
    v: 0, latV: 0, slideV: 0,
    yaw: 0, x: 0, z: 0, y:0, groundY:0, pitch:0, bank:0, fallTime:0, fallY:0, recoveries:0,
    stamina: PHYS.staminaMax,
    item: null,
    boosting: false,
    spin: 0, ink: 0, bolt: 0, shield: 0,
    inWater: false,               // 是否正在涉水（每帧由 stepRacer 更新）
    lap: 1, rank: 1,
    finished: false, finishTime: 0,
    input: { throttle: 0, brake: 0, steer: 0, boost: false, drift:false, useItem: false },
    ai: null,
  };
  if (!r.isPlayer) {
    const iv = 2.0 + Math.random() * 6.0;
    r.ai = {
      target: laneLat(3),
      lane: 3,
      rethink: Math.random() * 1.5,
      skill: AI.skillMin + Math.random() * (AI.skillMax - AI.skillMin),
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

  /* ---- 速度决策（赛道速度剖面） ----
     物理依据：抓地极限是 v^2 * kappa <= gripLimit，
     所以某段路的安全速度 vSafe = sqrt(gripLimit / kappa)。
     再按制动能力反推"离这段路还有 d 时最多能开多快"：
       vAllow = sqrt(vSafe^2 + 2 * brakeAcc * d)
     取整条视距内的最小值 —— 该刹的地方刹、该全油门的地方全油门。
     （旧实现直接拿"视距内最大曲率"当减速依据，会提前 30+ 个车身位就收油，
       电脑玩家因此明显比玩家慢。） */
  const kappaNear = curvatureAhead(r.s + 1.0, AI.boostLook);
  const tmpP = {};
  let wantV = PHYS.maxSpeed;
  const brakeAcc = PHYS.brake * AI.brakeGrip;
  for (let d = 0; d <= AI.horizon; d += AI.horizonStep) {
    samplePath(r.s + d, tmpP);
    const vSafe = Math.sqrt((PHYS.gripLimit*(TRACK.grip||1)) / Math.max(tmpP.kappa, 1e-4)) * AI.lineMargin;
    const vAllow = Math.sqrt(vSafe * vSafe + 2 * brakeAcc * d);
    if (vAllow < wantV) wantV = vAllow;
  }

  // 橡皮筋：落后略微提速、领先略微收力（幅度很小，不改变"同速"这个基准）
  const leadGap = race.player ? (race.player.s - r.s) : 0;
  const rubber = clamp(1 + leadGap * AI.rubberK, AI.rubberMin, AI.rubberMax);

  wantV = clamp(wantV * a.skill * rubber, 6, PHYS.maxSpeed);

  // 氮气：只在直道且体力充足时使用（体力收支决定约 1/3 的时间可以开）
  const canBoost = r.stamina > AI.boostStamina && kappaNear < AI.boostKappa
    && r.spin <= 0 && r.bolt <= 0 && r.ink <= 0 && !r.finished;

  const inp = r.input;
  inp.boost = canBoost;
  inp.steer=steer;inp.useItem=false;
  const progress=((r.s%TRACK_LEN)+TRACK_LEN)%TRACK_LEN;
  if(r.route==='shortcut'){a.target=0;inp.steer=clamp(-r.lat*2.8,-1,1);}
  else if(progress>SHORTCUT.s0-27&&progress<SHORTCUT.s0&&a.aggr>.45){a.target=-4;inp.steer=clamp((-4-r.lat)*2.8,-1,1);}
  const upcoming=FEATURES.map(f=>featureState(f,race.time+.4)).concat((race.barriers||[]).map(f=>race.barrierState(f)));
  for(const f of upcoming){const gap=wrapDiff(f.s,r.s)*sampleRoute(r.s,r.route).factor;
    if(f.kind==='gate'&&f.route===r.route&&gap>2&&gap<18&&Math.abs(r.lat-f.lat)<f.width/2+1){
      if(r.item==='jump')inp.useItem=true;
      else {const target=f.lat>0?-3.7:3.7;inp.steer=clamp(((r.route==='shortcut'?clamp(target,-1.65,1.65):target)-r.lat)*3,-1,1);}
    }
  }
  for(const gap of GAPS){const factor=sampleRoute(r.s,r.route).factor,d=wrapDiff(gap.start,r.s)*factor;
    if(gap.route===r.route&&d>0&&d<18){inp.steer=clamp(-r.lat*3,-1,1);inp.brake=0;inp.throttle=1;if(r.v<22&&r.stamina>3)inp.boost=true;}
  }
  inp.drift=sampleRoute(r.s,r.route).kappa>.018&&Math.abs(inp.steer)>.2&&(r.driftCharge<.9);
  inp.brake = (canBoost || r.v <= wantV * 1.03) ? 0 : 1;
  inp.throttle = inp.brake ? 0 : 1;


  // 3) 道具决策
  if (r.item) {
    a.itemDelay -= dt;
    if (a.itemDelay <= 0 && r.item!=='jump') {
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
  const path=sampleRoute(r.s,r.route);
  r.miniBoost=Math.max(0,r.miniBoost-dt);r.hazardCooldown=Math.max(0,r.hazardCooldown-dt);
  const drifting=active&&!!inp.drift&&Math.abs(inp.steer)>.1&&r.v>12&&path.kappa>.012&&r.spin<=0&&r.jumpTime<=0&&r.fallTime<=0;
  if(drifting)r.driftCharge=Math.min(1.6,r.driftCharge+dt);
  if(r.drifting&&!inp.drift&&r.driftCharge>=.4&&r.spin<=0){r.miniBoost=.55+r.driftCharge*.5;if(race.onEvent)race.onEvent('drift',r);}
  if(!drifting)r.driftCharge=0;
  r.drifting=drifting;
  if(r.jumpTime>0){r.jumpTime=Math.max(0,r.jumpTime-dt);r.jumpY=2.6*Math.sin(Math.PI*(1-r.jumpTime/1.15));if(!r.jumpTime)r.miniBoost=Math.max(r.miniBoost,.45);}else r.jumpY=0;
  const manualBoost=!!inp.boost&&r.stamina>.5;
  const candBoost = (manualBoost||r.miniBoost>0) && active && r.spin <= 0;
  if (manualBoost && candBoost) {
    r.stamina -= PHYS.boostDrain * dt;
    if (r.stamina < 0) r.stamina = 0;
  } else {
    r.stamina = Math.min(PHYS.staminaMax, r.stamina + PHYS.staminaRegen * dt);
  }
  r.boosting = candBoost;
  if (r.boosting) r.boostTime = (r.boostTime || 0) + dt;

  // ---- 当前位姿采样（涉水判定 + 曲率共用，避免重复采样）----
  const tmp = sampleRoute(r.s, r.route, {});
  r.inWater = inWater(tmp.x + tmp.ux * r.lat, tmp.z + tmp.uz * r.lat);

  // ---- 目标极速 ----
  let maxV = (candBoost ? PHYS.boostSpeed : PHYS.maxSpeed)*clamp(1-tmp.grade*.22,.87,1.12);
  if (r.bolt > 0) maxV *= PHYS.boltSlow;
  if (r.ink > 0) maxV *= PHYS.inkSlow;
  if (r.inWater) maxV = Math.min(maxV, PHYS.maxSpeed * PHYS.waterSlow);   // 水域：速度降为常态的 70%（氮气也压不过这个上限）

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
  if(active&&r.spin<=0&&r.jumpY<.2)acc-=7.5*tmp.grade;
  r.v += acc * dt;
  // 超速回落：先按固定速率平滑退回极速，再兜一个硬上限。
  // （只写 Math.max(maxV, v - drop*dt) 的话，加速比回落快时 v 会一路往上漂，
  //   实测开氮气能把 38.5 的极速漂到 47，所以必须夹硬上限。）
  if (r.v > maxV) {
    r.v = Math.max(maxV, r.v - PHYS.overSpeedDrop * dt);
    const cap = maxV + PHYS.overSpeedMax;
    if (r.v > cap) r.v = cap;
  }
  // 入水即减速：不做平滑回落，直接压到 70% 极速，手感明确
  if (r.inWater && r.v > maxV) r.v = maxV;
  if (r.v < PHYS.reverseSpeed) r.v = PHYS.reverseSpeed;
  if ((!active || r.finished) && r.v < 0) r.v = 0;

  // ---- 曲率采样 ----
  const kappa = tmp.kappa;

  // ---- 横向 ----
  let latTarget = 0;
  if (r.spin > 0) {
    latTarget = Math.sin(r.spin * 13.5) * 1.0;
  } else if (active) {
    const spd = clamp(Math.abs(r.v) / 11, 0, 1);
    latTarget = inp.steer * (1 - Math.exp(-PHYS.steerLerp * dt)) * 1.0;
    r.latV = lerp(r.latV, inp.steer * PHYS.steerLat * spd * (drifting?.7:1), 1 - Math.exp(-PHYS.steerLerp * dt));
  } else {
    r.latV = lerp(r.latV, 0, 1 - Math.exp(-4 * dt));
  }
  // 弯道离心外滑
  const over = r.v * r.v * kappa - PHYS.gripLimit*(TRACK.grip||1);
  if (over > 0) r.slideV += over * PHYS.slideK * dt * 5.0 * tmp.outward * (drifting?.3:1);
  r.slideV *= Math.exp(-dt * 2.3);
  r.slideV = clamp(r.slideV, -6, 6);

  let totalLatV = r.latV + r.slideV;
  if (r.spin > 0) totalLatV += latTarget * 4.2;

  r.lat += totalLatV * dt;

  // ---- 撞墙 ----
  const WALL=r.route==='shortcut'?SHORTCUT.halfWidth-PHYS.bodyHalfW:HW-PHYS.bodyHalfW;
  if (r.lat > WALL) {
    r.lat = WALL;
    if (totalLatV > 0) { r.slideV = 0; r.latV *= -0.25; }
    r.v *= (1 - 1.4 * dt);
    r.driftCharge=0; r.wallHits = (r.wallHits || 0) + 1;
    if (race.onEvent) race.onEvent('wall', r);
  } else if (r.lat < -WALL) {
    r.lat = -WALL;
    if (totalLatV < 0) { r.slideV = 0; r.latV *= -0.25; }
    r.v *= (1 - 1.4 * dt);
    r.driftCharge=0; r.wallHits = (r.wallHits || 0) + 1;
    if (race.onEvent) race.onEvent('wall', r);
  }

  // ---- 前进 ----
  const prev=((r.s%TRACK_LEN)+TRACK_LEN)%TRACK_LEN;
  r.s += r.v * dt / tmp.factor;
  const now=((r.s%TRACK_LEN)+TRACK_LEN)%TRACK_LEN;
  if(r.v>0&&r.route==='main'&&prev<SHORTCUT.s0&&now>=SHORTCUT.s0&&now<SHORTCUT.s1&&r.lat<-2.5){
    r.route='shortcut';r.lat=clamp(r.lat-SHORTCUT.offset,-1.7,1.7);r.latV=0;r.slideV=0;
  }else if(r.route==='shortcut'&&(now>=SHORTCUT.s1||now<SHORTCUT.s0)){
    r.route='main';r.lat=clamp(r.lat+SHORTCUT.offset,-HW+PHYS.bodyHalfW,HW-PHYS.bodyHalfW);r.latV=0;r.slideV=0;
  }

  // Visible bridge gaps require a real airborne pass. A miss restores the launch approach.
  const gap=gapAt(r.s,r.route);
  if(active&&(r.fallTime>0||(gap&&r.jumpY<.28&&r.jumpTime<.18))){
    if(!r.fallTime){r.fallGap=gap;r.fallLap=Math.floor(r.s/TRACK_LEN)*TRACK_LEN;r.fallRoute=r.route;r.jumpTime=0;r.driftCharge=0;}
    r.fallTime+=dt;r.fallY=Math.min(11,22*r.fallTime*r.fallTime);r.v=Math.max(4,r.v-dt*16);
    if(r.fallTime>=.75){const f=r.fallGap,factor=f.route==='shortcut'?SHORTCUT.factor:1;
      r.s=r.fallLap+f.start-10/factor;r.route=r.fallRoute;r.lat=0;r.latV=0;r.slideV=0;r.v=9;r.spin=0;r.jumpTime=0;r.jumpY=0;r.miniBoost=0;r.hazardCooldown=0;r.fallTime=0;r.fallY=0;r.recoveries++;
      if(race.onEvent)race.onEvent('recover',r);
    }
  }

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
  const p = sampleRoute(r.s, r.route, {});
  r.x = p.x + p.ux * r.lat;
  r.z = p.z + p.uz * r.lat;
  r.groundY=p.y+r.lat*Math.tan(p.bank);r.y=r.groundY+r.jumpY-r.fallY;r.pitch=-Math.atan(p.grade);r.bank=p.bank;
  const vx = p.tx * r.v + p.ux * totalLatV;
  const vz = p.tz * r.v + p.uz * totalLatV;
  if (Math.abs(vx) + Math.abs(vz) > 0.01) r.yaw = Math.atan2(vz, vx);
  r.pathT = p;
}

/* ============================================================
   车与车碰撞
   目标：车与车不能重叠，且碰撞有物理反馈。
   做法：
     1) 在 (s, lat) 平面上按车身盒判定重叠，用 SAT 取「最小穿透轴」优先分离；
     2) 横向分离为主（推不动的那一份转嫁给对方），横向被墙卡死时才沿 s 让位，
        且 s 的位移被限制在当前圈内 —— 不会改圈数、不会提前完赛；
     3) 分离量按帧率归一并有上限，避免瞬移；
     4) 给一个横向速度冲量，使分离"粘住"，不被 AI 转向立刻顶回来；
     5) 按法向相对速度做追尾回弹（后车减速、前车被轻推），够猛时派发 bump 事件。
   ============================================================ */
function shiftSInLap(r, d, T) {
  if (r.finished || !d) return 0;
  const lap = Math.max(1, r.lap || 1);
  const lo = (lap - 1) * T;
  const hi = lap * T - 1e-3;
  const before = r.s;
  r.s = clamp(r.s + d, lo, hi);
  return r.s - before;
}

function resolveCarCollisions(race, dt) {
  const rs = race.racers;
  const T = TRACK_LEN;
  const minDS = PHYS.bodyHalfL * 2 * PHYS.collGap;   // 需要达到的最小纵向间距
  const minDL = PHYS.bodyHalfW * 2 * PHYS.collGap;   // 需要达到的最小横向间距
  const cap = PHYS.collMaxPush * Math.min(2, dt * 60); // 单帧可推开的距离上限

  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const A = rs[i], B = rs[j];
      if(A.route!==B.route||A.fallTime>0||B.fallTime>0||Math.abs(A.y-B.y)>1.3)continue;
      // 弧长差取最短环向（处理跨起终点的情况）
      let ds = A.s - B.s;
      ds -= Math.round(ds / T) * T;
      const dlat = A.lat - B.lat;
      const penS = minDS - Math.abs(ds);
      const penL = minDL - Math.abs(dlat);
      if (penS <= 0 || penL <= 0) continue;       // 车身盒未重叠

      const sL = dlat >= 0 ? 1 : -1;              // A 在 B 的哪一侧
      const want = Math.min(penL, cap);           // 本帧想推开的横向距离

      // ---- 1) 横向分离：各让一半，A 被墙挡住的份额转嫁给 B ----
      const aNew = clamp(A.lat + sL * want * 0.5, -WALL, WALL);
      const aMoved = Math.abs(aNew - A.lat);
      A.lat = aNew;
      const bNew = clamp(B.lat - sL * (want - aMoved), -WALL, WALL);
      const bMoved = Math.abs(bNew - B.lat);
      B.lat = bNew;
      const movedL = aMoved + bMoved;

      // ---- 2) 横向被墙卡死（两车都贴着墙）时才前后让位 ----
      if (movedL < want * 0.5) {
        const sS = ds >= 0 ? 1 : -1;              // A 在前
        const need = Math.min(penS, cap);
        shiftSInLap(A, sS * need * 0.5, T);
        shiftSInLap(B, -sS * need * 0.5, T);
      }

      // ---- 3) 横向速度冲量：让分离粘住，不被转向拉回 ----
      const imp = sL * Math.min(penL, 0.7) * 3.0;
      A.latV += imp;
      B.latV -= imp;

      // ---- 4) 追尾回弹：后车减速、前车被轻推 ----
      const ahead = ds >= 0 ? A : B;
      const back = ds >= 0 ? B : A;
      const relV = back.v - ahead.v;
      if (relV > 0) {
        back.v -= relV * PHYS.collRestitution;
        ahead.v += relV * 0.16;
        if (Math.abs(ds) < 1.6 && race.onEvent && relV > PHYS.collBumpMinV) {
          race.onEvent('bump', back, ahead);
        }
      }
    }
  }
}

/* ============================================================
   Race
   ============================================================ */
export class Race {
  constructor(roster, scene, hooks = {}) {
    this.racers = roster.map((o, i) => makeRacer({ ...o, color: o.color }));
    this.netClient = !!hooks.netClient;   // 渲染客户端（只收快照、不发物理）
    this.myId = hooks.myId || null;       // 本客户端对应的车手 id（用于镜头/HUD/发输入）
    this.byId = {};
    this.racers.forEach((r) => { this.byId[r.id] = r; this.shuffleGrid(r); });
    this.player = this.racers.find((r) => r.isLocal)
      || (this.myId ? this.byId[this.myId] : null)
      || this.racers.find((r) => r.isPlayer) || null;
    this.scene = scene;
    this.onEvent = hooks.onEvent || null;
    this.itemBoxes = (hooks.world && hooks.world.itemBoxes) || [];
    for(const b of this.itemBoxes){b.active=true;b.timer=0;if(b.mesh)b.mesh.visible=true;}
    this.time = 0;
    this.phase = 'countdown';
    this.countdown = RULES.countdown;
    this.finishOrder = [];
    this.bananas = [];
    this.missiles = [];          // 飞行中的导弹
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

  /* ---------------- 主步进 ----------------
     playerInput：房主侧本地玩家的键盘输入（其余玩家的输入来自网络或 AI）。
     渲染客户端（netClient）不会调用本方法，改用 applySnapshot + netTick。 */
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
      if (r.isLocal) {
        const i = r.input;
        if (active && !r.finished) {
          i.throttle = playerInput.throttle;
          i.brake = playerInput.brake;
          i.steer = playerInput.steer;
          i.boost = playerInput.boost; i.drift=!!playerInput.drift;
        } else {
          i.throttle = 0; i.brake = r.finished ? 1 : 0; i.steer = 0; i.boost = false;
        }
        i.useItem = playerInput.useItem;
      } else if (r.isPlayer) {
        // 远程真人（房主侧）：用网络输入驱动
        const ni = r.netInput, i = r.input;
        if (active && !r.finished) {
          i.throttle = ni.throttle;
          i.brake = ni.brake;
          i.steer = ni.steer;
          i.boost = ni.boost; i.drift=!!ni.drift;
        } else {
          i.throttle = 0; i.brake = r.finished ? 1 : 0; i.steer = 0; i.boost = false;
        }
        i.useItem = ni.useItem;
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
      this.handleCourse(dt);
      this.handleItemBoxes(dt);
      this.handleBananas(dt);
      this.handleMissiles(dt);
    }
    this.computeRanks();

    // 远程玩家的道具使用是"边沿"事件：房主消费一次后清零，避免重复触发
    for (const r of this.racers) {
      if (r.isPlayer && !r.isLocal) r.netInput.useItem = false;
    }

    if (this.inkTimer > 0) this.inkTimer = Math.max(0, this.inkTimer - dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    for (const r of this.racers) if (r.shield > 0) r.shield = Math.max(0, r.shield - dt);
  }

  syncBarriersNet(list) {
    this.barriers ||= [];
    list.forEach((b,i)=>{if(!this.barriers[i]){const f={...b,kind:'gate',id:'placed'};f.mesh=createCourseMesh(f);this.scene.add(f.mesh);this.barriers[i]=f;}Object.assign(this.barriers[i],b);this.positionBarrier(this.barriers[i]);});
    while(this.barriers.length>list.length)this.scene.remove(this.barriers.pop().mesh);
  }
  positionBarrier(f){
    const st=this.barrierState(f),p=sampleRoute(f.s,f.route);
    f.mesh.position.set(p.x+p.ux*st.lat,roadHeight(f.s,st.lat,f.route),p.z+p.uz*st.lat);
    setGateVisual(f.mesh,st.armed,f.age);
  }
  barrierState(f){return {...f,lat:clamp(f.lat+Math.sin(f.age*1.5)*.9,-(f.route==='shortcut'?1.1:4.8),f.route==='shortcut'?1.1:4.8),armed:f.age>=1.25};}
  handleCourse(dt){
    this.barriers ||= [];
    for(let i=this.barriers.length-1;i>=0;i--){const b=this.barriers[i];b.age+=dt;b.life-=dt;if(b.life<=0){this.scene.remove(b.mesh);b.mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.barriers.splice(i,1);}else this.positionBarrier(b);}
    const features=[...FEATURES.map(f=>featureState(f,this.time)),...this.barriers.map(f=>this.barrierState(f))];
    for(const r of this.racers){
      if(r.finished||r.hazardCooldown>0||r.fallTime>0)continue;
      for(const f of features){
        if(r.route!==f.route||Math.abs(wrapDiff(r.s,f.s))*sampleRoute(r.s,r.route).factor>1.5||Math.abs(r.lat-f.lat)>f.width/2+.35)continue;
        if(f.kind==='ramp'&&r.jumpTime<=0&&(!f.gap||r.v>=16)){r.jumpTime=1.15;r.hazardCooldown=.45;}
        else if(f.kind==='pad'){r.miniBoost=.85;r.hazardCooldown=1;}
        else if(f.kind==='gate'&&f.armed&&r.jumpY<.8){if(r.shield>0){r.shield=0;}else{r.v*=.55;r.spin=.32;r.driftCharge=0;if(this.onEvent)this.onEvent('bump',r);}r.hazardCooldown=1.2;}
      }
    }
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
        if (r.finished || r.item || r.route==='shortcut'||r.jumpY>.8||r.fallTime>0) continue;
        if (Math.abs(wrapDiff(r.s, b.s)) > 1.7) continue;
        if (Math.abs(r.lat - b.lat) > 1.15) continue;
        b.active = false;
        b.timer = RULES.itemRespawn;
        if (b.mesh) b.mesh.visible = false;
        r.item = b.item || rollItem(r.rank, this.racers.length);
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
            // 本地玩家用当前瞄准车道；远程玩家用其上报的车道
            const aim = r.isLocal ? this.aimLane : (r.netInput ? r.netInput.aimLane : 3);
            this.pendingUse = { r, t: 2.6, aim: clamp(Math.round(aim), 1, 5) };
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
    const { r, aim } = this.pendingUse;
    this.pendingUse = null;
    if (r.item === 'banana') this.fireItem(r, aim);
  }

  cancelAim() { this.pendingUse = null; }

  fireItem(r, lane) {
    const item = r.item;
    r.item = null;
    if(item==='jump') {
      r.jumpTime=1.15;
      if(this.onEvent)this.onEvent('use',r,'jump');
    }else if(item==='barrier'){
      const f={id:'placed',kind:'gate',s:r.s+19,lat:r.lat,width:2.8,route:r.route,age:0,life:8};
      // Never leave a branch obstacle beyond its merge.
      if(f.route==='shortcut'&&f.s%TRACK_LEN>SHORTCUT.s1)f.route='main';
      const gap=gapAt(f.s,f.route);if(gap)f.s=Math.floor(f.s/TRACK_LEN)*TRACK_LEN+gap.end+3/(f.route==='shortcut'?SHORTCUT.factor:1);
      f.mesh=createCourseMesh(f);this.scene.add(f.mesh);(this.barriers ||= []).push(f);
      if(this.onEvent)this.onEvent('use',r,'barrier');
    }else if (item === 'banana') {
      const L = lane || 3;
      const s = r.s - 3.2;
      if(gapAt(s,r.route)){if(this.onEvent)this.onEvent('use',r,'banana',L);return;}
      const p = sampleRoute(s,r.route, {});
      const lat = r.route==='shortcut'?r.lat:laneLat(L);
      this.bananas.push({
        s, lat,
        x: p.x + p.ux * lat, z: p.z + p.uz * lat,
        owner: r.id, route:r.route, life: 24,
        mesh: this.makeBananaMesh(p.x + p.ux * lat, p.z + p.uz * lat, s, r.route, lat),
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
        if (best.shield > 0) {
          if (this.onEvent) this.onEvent('shieldblock', best, r);
        } else {
          best.ink = RULES.inkDuration;
          if (best.isPlayer) this.inkTimer = RULES.inkDuration;
          if (this.onEvent) this.onEvent('hit', r, best, 'ink');
        }
      }
      if (this.onEvent) this.onEvent('use', r, 'ink');
    } else if (item === 'bolt') {
      let hit = 0;
      for (const o of this.racers) {
        if (o === r) continue;
        if (o.shield > 0) continue;       // 护盾免疫闪电
        o.bolt = RULES.boltDuration;
        hit++;
      }
      if (this.player && this.player !== r && this.player.bolt > 0) this.flashTimer = 0.5;
      if (this.onEvent) this.onEvent('use', r, 'bolt', hit);
    } else if (item === 'shield') {
      r.shield = RULES.shieldDuration;
      if (this.onEvent) this.onEvent('use', r, 'shield');
    } else if (item === 'missile') {
      // 锁定前方最近对手，造一枚追踪导弹
      let target = null, bd = 1e9;
      for (const o of this.racers) {
        if (o === r) continue;
        const ds = o.s - r.s;
        if (ds > 0 && ds < RULES.missileRange && ds < bd) { bd = ds; target = o; }
      }
      const startS = r.s + 2.2;
      const p = sampleRoute(startS,r.route, {});
      const lat = r.lat;
      const x = p.x + p.ux * lat, z = p.z + p.uz * lat;
      this.missiles.push({
        owner: r.id,
        targetId: target ? target.id : null, route:r.route,
        s: startS, lat, x, z,
        life: RULES.missileLife,
        mesh: this.makeMissileMesh(x, z),
      });
      if (this.onEvent) this.onEvent('use', r, 'missile', target ? target.name : null);
    }
  }

  makeBananaMesh(x, z, s, route='main',lat=0) {
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
    g.position.set(x, roadHeight(s,lat,route), z);
    g.rotation.y = Math.random() * TWO_PI;
    this.scene.add(g);
    return g;
  }

  makeMissileMesh(x, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 1.05, 10),
      new THREE.MeshBasicMaterial({ color: 0xff7a3c })
    );
    body.rotation.x = Math.PI / 2;     // 锥尖朝前（沿 +Z 局部），后续按行驶方向旋转
    body.position.y = 1.15;
    g.add(body);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowWarm, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, opacity: 0.85,
    }));
    glow.scale.set(2.0, 2.0, 1);
    glow.position.y = 1.15;
    g.add(glow);
    g.position.set(x, 0, z);
    this.scene.add(g);
    return g;
  }

  /* 导弹：追踪前方目标，命中使其打滑；目标有护盾则被挡下 */
  handleMissiles(dt) {
    const tmp = {};
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      const target = m.targetId ? this.byId[m.targetId] : null;
      let reached = false;
      if (target && !target.finished) {
        const gap = target.s - m.s;
        if (gap <= 0.6) {
          reached = true;
        } else {
          m.s += RULES.missileSpeed * dt / sampleRoute(m.s,m.route).factor;
          if (m.s > target.s) m.s = target.s;
          m.lat = lerp(m.lat, target.lat, 1 - Math.exp(-6 * dt));
        }
      } else {
        // 无目标（或目标已完赛）：朝前平直飞，到寿命即销毁
        m.s += RULES.missileSpeed * dt / sampleRoute(m.s,m.route).factor;
      }
      m.route=target?.route||m.route;
      const p = sampleRoute(m.s,m.route, tmp);
      m.x = p.x + p.ux * m.lat; m.z = p.z + p.uz * m.lat;
      if (m.mesh) {
        m.mesh.position.set(m.x, roadHeight(m.s,m.lat,m.route), m.z);
        // 锥尖朝行驶方向（局部 +Z 对齐到路径切向 tx/tz）
        m.mesh.rotation.y = Math.atan2(p.tx, p.tz);
      }
      if (reached) {
        if (target.shield > 0) {
          if (this.onEvent) this.onEvent('shieldblock', target, m.owner);
        } else {
          target.spin = PHYS.spinTime;
          target.v *= 0.5;
          if (this.onEvent) this.onEvent('spin', target);
        }
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
        continue;
      }
      if (m.life <= 0) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
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
        // 香蕉皮是「一次性」道具：任意对手碰到即消失，只生效一次
        // （已打滑中的车也算碰到 —— 直接消耗掉，不会留着再坑下一个人）
        if (r.id === b.owner || r.route!==(b.route||'main')||r.jumpY>.7||r.fallTime>0) continue;
        if (Math.abs(wrapDiff(r.s, b.s)) > 1.5) continue;
        if (Math.abs(r.lat - b.lat) > 1.0) continue;
        if (r.shield > 0) {
          // 护盾挡下香蕉皮（直接消除，不触发打滑）
          if (this.onEvent) this.onEvent('shieldblock', r, b.owner);
          this.scene.remove(b.mesh);
          this.bananas.splice(i, 1);
          break;
        }
        r.spin = Math.max(r.spin, PHYS.spinTime);
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
      v.grp.position.set(r.x, r.y||0, r.z);
      v.grp.rotation.order='YXZ';v.grp.rotation.x=r.pitch||0;
      v.grp.visible = true;
      v.shadow.position.y=.035-(r.jumpY||0);v.shadow.material.opacity=.75-(r.jumpY||0)*.13;
      v.sparks.forEach((m,i)=>{m.visible=!!r.drifting&&r.driftCharge>.15;m.material.color.set(r.driftCharge>=.4?0xffb446:0x55e9ff);m.scale.setScalar(.65+.25*Math.sin(t*45+i));});

      // 车头(+Z)对齐行驶方向：group.rotation.y = π/2 - yaw
      v.grp.rotation.y = Math.PI / 2 - r.yaw + (r.drifting?Math.sign(r.input.steer)*.2:0);
      // 打滑时整车侧倾摇摆
      v.grp.rotation.z = -(r.bank||0)+(r.spin > 0 ? Math.sin(r.spin * 22) * 0.35 : 0);

      // 转向 / 车轮滚动 / 角色倾斜 / 喷氮
      const steer = (r.input && r.input.steer != null) ? r.input.steer
                  : (r.netInput && r.netInput.steer != null) ? r.netInput.steer : 0;
      v.kart.setSteer(steer * 0.5);
      v.kart.setRoll(clamp(r.v / PHYS.maxSpeed, 0, 1));
      v.kart.setLean(steer);
      v.kart.setBoost(r.boosting || !!window.__forceBoost);
      v.kart.orientToCamera(camera);
      v.kart.update(dt);

      // 护盾气泡
      const shOn = r.shield > 0;
      v.shield.visible = shOn;
      if (shOn) {
        v.shield.material.opacity = 0.16 + 0.12 * Math.abs(Math.sin(t * 6));
        const sc = 1 + 0.06 * Math.sin(t * 5);
        v.shield.scale.setScalar(sc);
      }
    }
  }

  get allFinished() {
    return this.racers.every((r) => r.finished);
  }

  /* ---------------- 联机：房主序列化快照 ---------------- */
  serialize() {
    return {
      t: this.time,
      phase: this.phase,
      cd: this.countdown,
      rs: this.racers.map((r) => ({
        i: r.id, s: r.s, l: r.lat, v: r.v, lv: r.latV,
        lap: r.lap, f: r.finished ? 1 : 0, ft: r.finishTime,
        it: r.item || '', st: r.stamina, sp: r.spin, ik: r.ink, bt: r.bolt, bo: r.boosting ? 1 : 0,
        si:r.input.steer, sh: r.shield || 0, rt:r.route, jy:r.jumpY, jt:r.jumpTime, dc:r.driftCharge, dr:r.drifting, mb:r.miniBoost, fy:r.fallY, fl:r.fallTime, rc:r.recoveries,
      })),
      br:(this.barriers||[]).map(({s,lat,width,route,age,life})=>({s,lat,width,route,age,life})),
      ba: this.bananas.map((b) => ({ s: b.s, l: b.lat, o: b.owner, rt:b.route })),
      ms: this.missiles.map((m) => ({ o: m.owner, s: m.s, l: m.lat, rt:m.route })),
    };
  }

  /* ---------------- 联机：渲染客户端应用快照 ---------------- */
  applySnapshot(snap) {
    this.time = snap.t;
    this.phase = snap.phase;
    this.countdown = snap.cd;
    const tmp = {};
    for (const e of snap.rs) {
      const r = this.byId[e.i];
      if (!r) continue;
      r.s = e.s; r.lat = e.l; r.v = e.v; r.latV = e.lv; r.lap = e.lap;
      r.finished = !!e.f; r.finishTime = e.ft; r.item = e.it || null;
      r.stamina = e.st; r.spin = e.sp; r.ink = e.ik; r.bolt = e.bt; r.boosting = !!e.bo;
      r.shield = e.sh || 0; r.input.steer=e.si||0;r.route=e.rt||'main';r.jumpY=e.jy||0;r.jumpTime=e.jt||0;r.driftCharge=e.dc||0;r.drifting=!!e.dr;r.miniBoost=e.mb||0;r.fallY=e.fy||0;r.fallTime=e.fl||0;r.recoveries=e.rc||0;
      const p = sampleRoute(r.s, r.route, tmp);
      const x = p.x + p.ux * r.lat, z = p.z + p.uz * r.lat;
      const vx = p.tx * r.v + p.ux * e.lv, vz = p.tz * r.v + p.uz * e.lv;
      const yaw = (Math.abs(vx) + Math.abs(vz) > 0.01) ? Math.atan2(vz, vx) : r.yaw;
      r.tgroundY=p.y+r.lat*Math.tan(p.bank);r.pitch=-Math.atan(p.grade);r.bank=p.bank;r.ty=r.tgroundY+r.jumpY-r.fallY;
      r.tx = x; r.tz = z; r.tyaw = yaw;
      if (r._snapInit !== true) { r.x = x; r.z = z; r.yaw = yaw; r.y=r.ty;r.groundY=r.tgroundY;r._snapInit = true; }
    }
    this.syncBarriersNet(snap.br||[]);
    this.syncBananasNet(snap.ba);
    this.syncMissilesNet(snap.ms);
    this.computeRanks();
  }

  /* 渲染客户端每帧把车手位置从快照目标插值过来，抵消 20Hz 快照的卡顿 */
  netTick(dt) {
    const k = 1 - Math.exp(-14 * dt);
    for (const r of this.racers) {
      if (r.tx === undefined) continue;
      r.x += (r.tx - r.x) * k;
      r.z += (r.tz - r.z) * k;
      r.y += (r.ty-r.y)*k;r.groundY+=(r.tgroundY-r.groundY)*k;
      let d = r.tyaw - r.yaw;
      while (d > Math.PI) d -= TWO_PI;
      while (d < -Math.PI) d += TWO_PI;
      r.yaw += d * k;
    }
  }

  /* 渲染客户端按快照重建香蕉皮网格（索引对齐） */
  syncBananasNet(ba) {
    if (!this._netBananas) this._netBananas = [];
    const nb = this._netBananas;
    for (let i = 0; i < ba.length; i++) {
      const b = ba[i];
      const p = sampleRoute(b.s,b.rt, {});
      const px = p.x + p.ux * b.l, pz = p.z + p.uz * b.l;
      if (nb[i]) {
        nb[i].position.set(px, roadHeight(b.s,b.l,b.rt), pz);
      } else {
        const mesh = this.makeBananaMesh(px, pz, b.s,b.rt,b.l);
        nb[i] = mesh;
      }
    }
    for (let i = ba.length; i < nb.length; i++) {
      if (nb[i]) { this.scene.remove(nb[i]); nb[i] = null; }
    }
    nb.length = ba.length;
  }

  /* 渲染客户端按快照重建导弹网格（索引对齐） */
  syncMissilesNet(ms) {
    if (!this._netMissiles) this._netMissiles = [];
    const nm = this._netMissiles;
    ms = ms || [];
    for (let i = 0; i < ms.length; i++) {
      const b = ms[i];
      const p = sampleRoute(b.s,b.rt, {});
      const px = p.x + p.ux * b.l, pz = p.z + p.uz * b.l;
      if (nm[i]) {
        nm[i].position.set(px, roadHeight(b.s,b.l,b.rt), pz);
        nm[i].rotation.y = Math.atan2(p.tx, p.tz);
      } else {
        const mesh = this.makeMissileMesh(px, pz);
        mesh.position.y=roadHeight(b.s,b.l,b.rt);nm[i] = mesh;
      }
    }
    for (let i = ms.length; i < nm.length; i++) {
      if (nm[i]) { this.scene.remove(nm[i]); nm[i] = null; }
    }
    nm.length = ms.length;
  }

  /* 房主侧：某玩家掉线，移除其车手 */
  removeRacer(id) {
    const r = this.byId[id];
    if (!r) return;
    if (r.view) this.scene.remove(r.view.grp);
    this.racers = this.racers.filter((x) => x !== r);
    delete this.byId[id];
    this.computeRanks();
  }
}
