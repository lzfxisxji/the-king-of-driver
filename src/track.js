/* ============================================================
   赛道几何：中心线采样 / 法线 / 曲率 / 圆角矩形 SDF
   路径按"行驶方向"参数化，s = 0 即起终点线。
   世界坐标：X 向右，Z 向下（与俯视地图一致）
   顶直道沿 -X 行驶 -> 顶左弯 -> 左直道 +Z -> 底直道 +X -> 右直道 -Z
   ============================================================ */
import { TRACK } from './config.js';

const DEG = Math.PI / 180;
const A = TRACK.a, B = TRACK.b, R = TRACK.R;

function lineSeg(p0, p1) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  return { kind: 'line', p0, p1, tx: dx / len, tz: dz / len, len };
}
function arcSeg(c, a0, a1) {
  const len = Math.abs(a1 - a0) * R;
  return { kind: 'arc', c, a0, a1, len };
}

/* 从起终点线开始、按行驶顺序排列的段 */
const SEGS = [
  lineSeg([TRACK.startX, -B], [-(A - R), -B]),
  arcSeg([-(A - R), -(B - R)], -90 * DEG, -180 * DEG),
  lineSeg([-A, -(B - R)], [-A, B - R]),
  arcSeg([-(A - R), B - R], 180 * DEG, 90 * DEG),
  lineSeg([-(A - R), B], [A - R, B]),
  arcSeg([A - R, B - R], 90 * DEG, 0),
  lineSeg([A, B - R], [A, -(B - R)]),
  arcSeg([A - R, -(B - R)], 0, -90 * DEG),
  lineSeg([A - R, -B], [TRACK.startX, -B]),
];

const CUM = [];
let acc = 0;
for (const s of SEGS) { CUM.push(acc); acc += s.len; }
export const TRACK_LEN = acc;          // ≈ 357

/* 起终点线在空间中的位置（用于放门架 / 格纹） */
export const START_POINT = { x: TRACK.startX, z: -B };

/**
 * 采样路径：返回 { x, z, tx, tz, ux, uz, kappa }
 * u = 外侧单位法线（远离环心），kappa = |曲率|
 */
export function samplePath(s, out) {
  out = out || {};
  let d = s % TRACK_LEN;
  if (d < 0) d += TRACK_LEN;
  let i = 0;
  while (i < SEGS.length - 1 && d >= CUM[i] + SEGS[i].len) i++;
  const seg = SEGS[i];
  const local = d - CUM[i];
  if (seg.kind === 'line') {
    out.x = seg.p0[0] + seg.tx * local;
    out.z = seg.p0[1] + seg.tz * local;
    out.tx = seg.tx; out.tz = seg.tz;
    out.kappa = 0;
  } else {
    const a = seg.a0 + (seg.a1 - seg.a0) * (local / seg.len);
    out.x = seg.c[0] + R * Math.cos(a);
    out.z = seg.c[1] + R * Math.sin(a);
    out.tx = Math.sin(a); out.tz = -Math.cos(a);
    out.kappa = 1 / R;
  }
  out.ux = -out.tz;
  out.uz = out.tx;
  return out;
}

/** (s, lat) -> 世界坐标 */
export function toWorld(s, lat, out) {
  const p = samplePath(s, out || {});
  p.x += p.ux * lat;
  p.z += p.uz * lat;
  return p;
}

/** 世界坐标 -> 圆角矩形有符号距离（0=中心线，正=外侧） */
export function sdf(x, z) {
  const qx = Math.abs(x) - (A - R);
  const qz = Math.abs(z) - (B - R);
  const mx = Math.max(qx, 0), mz = Math.max(qz, 0);
  return Math.hypot(mx, mz) + Math.min(Math.max(qx, qz), 0) - R;
}

/** 世界坐标处的朝外法线（SDF 梯度，差分数值稳定） */
export function sdfNormal(x, z, out) {
  out = out || {};
  const e = 0.35;
  let nx = sdf(x + e, z) - sdf(x - e, z);
  let nz = sdf(x, z + e) - sdf(x, z - e);
  const l = Math.hypot(nx, nz) || 1;
  out.x = nx / l; out.z = nz / l;
  return out;
}

/**
 * 预计算一条稠密折线，供：赛道带网格 / 环境道具落点 / 重生点使用
 * 返回 { pts:[{x,z,tx,tz,ux,uz,s,kappa}], step }
 */
export function buildPolyline(step = 0.7) {
  const n = Math.max(64, Math.round(TRACK_LEN / step));
  const realStep = TRACK_LEN / n;
  const pts = [];
  const tmp = {};
  for (let i = 0; i <= n; i++) {
    const s = i * realStep;
    samplePath(s, tmp);
    pts.push({ x: tmp.x, z: tmp.z, tx: tmp.tx, tz: tmp.tz, ux: tmp.ux, uz: tmp.uz, s, kappa: tmp.kappa });
  }
  return { pts, step: realStep, n };
}

/** 前方 look 距离内的最大曲率（给 AI 预判减速用） */
export function curvatureAhead(s, look) {
  let worst = 0;
  const tmp = {};
  for (let d = 0; d <= look; d += 2.5) {
    samplePath(s + d, tmp);
    if (tmp.kappa > worst) worst = tmp.kappa;
  }
  return worst;
}

/* ---------- 道具箱布点：每组横跨 5 条车道 ---------- */
export const ITEM_GROUPS = [
  { s: TRACK_LEN * 0.075 }, { s: TRACK_LEN * 0.205 },
  { s: TRACK_LEN * 0.335 }, { s: TRACK_LEN * 0.455 },
  { s: TRACK_LEN * 0.585 }, { s: TRACK_LEN * 0.715 },
  { s: TRACK_LEN * 0.845 }, { s: TRACK_LEN * 0.935 },
];

export function buildItemBoxes() {
  const out = [];
  const p = {};
  ITEM_GROUPS.forEach((g, gi) => {
    for (let lane = 1; lane <= TRACK.lanes; lane++) {
      const s = g.s + (lane % 2 ? 0 : 1.6);
      samplePath(s, p);
      const lat = (3 - lane) * TRACK.laneW;
      out.push({
        id: `ib_${gi}_${lane}`,
        s, lat,
        x: p.x + p.ux * lat, z: p.z + p.uz * lat,
        baseY: 0.95,
        active: true, timer: 0,
      });
    }
  });
  return out;
}

/* ---------- 环境道具落点 ---------- */
export function scatterOutside(count, seed) {
  const { pts, n } = buildPolyline(1.2);
  const res = [];
  let st = seed >>> 0;
  const rnd = () => {
    st = (st * 1664525 + 1013904223) >>> 0;
    return st / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const p = pts[Math.floor(rnd() * n)];
    const side = rnd() < 0.62 ? 1 : -1;          // 1=赛道外侧
    const dist = side > 0
      ? TRACK.halfWidth + 4 + rnd() * 16
      : TRACK.halfWidth + 3 + rnd() * 11;
    res.push({
      x: p.x + p.ux * dist * side,
      z: p.z + p.uz * dist * side,
      scale: 0.7 + rnd() * 0.85,
      rot: rnd() * Math.PI * 2,
      rnd: rnd(),
    });
  }
  return res;
}
