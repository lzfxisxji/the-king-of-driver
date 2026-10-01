/* ============================================================
   萌兽卡丁 · Moe Kart  —— 全局配置与调参
   ============================================================ */

/* ---------- 赛道几何（世界单位，1 单位 ≈ 地图 10px） ---------- */
export const TRACK = {
  a: 72.25,          // 中心线圆角矩形 X 半长
  b: 22.15,          // 中心线圆角矩形 Z 半宽
  R: 12,             // 圆角半径
  halfWidth: 6.95,   // 赛道半宽（总宽 13.9）
  lanes: 5,
  startX: 45,        // 起终点线在顶直道上的 x（行驶方向 -X）
  gridStep: 4.6,     // 发车格纵向间距
};
TRACK.laneW = (TRACK.halfWidth * 2) / TRACK.lanes;   // 2.78

/* 车道号(1..5) -> 相对中心线的横向偏移，正=外侧 */
export function laneLat(lane) {
  return (3 - lane) * TRACK.laneW;
}

/* ---------- 车辆物理 ---------- */
export const PHYS = {
  maxSpeed: 25.5,          // 常态极速 u/s
  boostSpeed: 38.5,        // 氮气极速
  accel: 15.0,
  boostAccel: 30.0,
  brake: 32.0,
  coastDrag: 5.2,          // 松油门自然减速
  reverseSpeed: -7.0,
  steerLat: 7.6,           // 横向变道速度 u/s
  steerLerp: 7.0,
  gripLimit: 32.0,         // 弯道抓地阈值 (v^2*kappa)：超过就向外滑
  slideK: 0.070,           // 超限后向外滑的系数
  bodyHalfW: 0.60,         // 车身半宽（仅用于碰撞）
  bodyHalfL: 1.05,         // 车身半长
  collGap: 1.06,           // 车车分离目标：车身尺寸 × 该系数（>1 留视觉余量）
  collMaxPush: 0.40,       // 单帧单车的最大位置修正（防瞬移）
  collRestitution: 0.55,   // 追尾相对速度的回弹系数
  collBumpMinV: 4.5,       // 触发撞击音效的最小相对速度
  staminaMax: 100,
  boostDrain: 27,          // 每秒消耗
  staminaRegen: 13.5,      // 每秒恢复
  inkSlow: 0.72,           // 中墨水后的速度系数
  boltSlow: 0.58,          // 中闪电后的速度系数
  spinTime: 1.25,          // 打滑时长
};

/* ---------- 相机 ---------- */
export const CAM = {
  dist: 5.9,
  height: 2.72,
  lookAhead: 6.4,
  lookUp: 1.30,
  fov: 55,
  fovBoost: 9,
  posDamp: 7.5,
  aimDamp: 9.0,
};

/* ---------- 比赛规则 ---------- */
export const RULES = {
  laps: 5,
  racers: 5,
  matchSeconds: 5,      // 练习赛准备倒计时（5 秒后自动发车）
  countdown: 3.999,     // 3-2-1-GO
  itemRespawn: 4.0,
  inkDuration: 4.0,
  boltDuration: 3.0,
  potionHeal: 42,
  shieldDuration: 6.0,     // 护盾持续时间
  missileSpeed: 62,        // 导弹飞行速度（沿赛道弧长）
  missileLife: 4.0,        // 导弹最长存在时间
  missileRange: 70,        // 导弹可锁定前方对手的最大距离
  boostKey: 'Space',
  useKey: 'KeyE',
};

/* ---------- 比赛用色（按名次/玩家） ---------- */
export const RACER_COLORS = [
  '#ff4d6d', '#3fa9ff', '#ffc23d', '#33d69f', '#b46bff',
];

/* ---------- 角色 roster ---------- */
export const CHARACTERS = [
  { key: 'lulu',     name: '噜噜',     title: '胡萝卜小胖', tag: '均衡型', portrait: 'lulu_1',     back: 'lulu_3',     scale: 1.00 },
  { key: 'kangaroo', name: '肥嘟袋鼠', title: '拳击袋鼠',   tag: '力量型', portrait: 'kangaroo_1', back: 'kangaroo_3', scale: 1.02 },
  { key: 'nailong',  name: '奶龙',     title: '呆萌奶龙',   tag: '可爱型', portrait: 'nailong_1',  back: 'nailong_3',  scale: 1.00 },
  { key: 'niulai',   name: '牛来',     title: '壮实小牛',   tag: '稳重派', portrait: 'niulai_1',   back: 'niulai_3',   scale: 1.03 },
  { key: 'doubao',   name: '豆包',     title: '黑风少女',   tag: '灵巧型', portrait: 'doubao_1',   back: 'doubao_3',   scale: 0.97 },
  { key: 'driver',   name: '老司机',   title: '方向盘执念', tag: '隐藏角', portrait: 'driver_1',   back: 'driver_head', scale: 1.00 },
];

/* ---------- 车辆 roster（全部同性能，纯外观） ----------
   当前只启用前 9 辆（全部已转为「敞篷 / 开放驾驶舱」造型）：
   前 5 辆跑车 + 4 辆轿车。其余车辆素材保留在 assets/cars/ 中但先隐藏。 */
export const CARS = [
  { file: 'car_r2c0', name: '白色猎鹰', group: '跑车' },
  { file: 'car_r2c1', name: '赤红闪电', group: '跑车' },
  { file: 'car_r2c2', name: '湛蓝战神', group: '跑车' },
  { file: 'car_r2c3', name: '暗夜幽灵', group: '跑车' },
  { file: 'car_r2c4', name: '橘焰狂风', group: '跑车' },
  { file: 'car_r0c0', name: '沙漠SUV',  group: '轿车' },
  { file: 'car_r0c1', name: '白银轿车', group: '轿车' },
  { file: 'car_r0c2', name: '蜜糖小跑', group: '轿车' },
  { file: 'car_r0c3', name: '烈焰红轿', group: '轿车' },
];

/* 已隐藏（改敞篷前的老素材，暂不参与选车 / AI 抽取）
  { file: 'car_r0c4', name: '暗夜SUV',  group: '轿车' },
  { file: 'car_r3c0', name: '青草小豆', group: '小车' },
  { file: 'car_r3c1', name: '晴空小蓝', group: '小车' },
  { file: 'car_r3c2', name: '巡逻警车', group: '小车' },
  { file: 'car_r3c3', name: '急救救护', group: '小车' },
  { file: 'car_r3c4', name: '墨黑漫步', group: '小车' },
  { file: 'car_r3c5', name: '丛林越野', group: '小车' },
  { file: 'car_r1c0', name: '云白厢车', group: '货车' },
  { file: 'car_r1c1', name: '原木货车', group: '货车' },
  { file: 'car_r1c2', name: '碧蓝自卸', group: '货车' },
  { file: 'car_r1c3', name: '银罐油车', group: '货车' },
  { file: 'car_r1c4', name: '素白货柜', group: '货车' },
*/

/* ---------- 驾驶位统一锚点（所有车辆/角色共用同一套骨架） ----------
   carW        车身显示宽度：所有车一致，并排时不会忽大忽小
   carHMin/Max 车高被夹在这个区间。敞篷化之后立绘高宽比只剩 0.40~0.54，
               所以下限调低 → 保留「跑车更扁、轿车略高」的自然差异，
               同时整体维持低矮的开放驾驶舱比例
   driverK     驾驶员贴图高度 = 车身高度 × driverK（所有角色同一条骨架）
   seatRatio   车身上缘吃掉驾驶员贴图的底部比例：
               0.26 → 遮挡线在 0.74H，只露出「头 + 肩 + 一点胸」，
               身体下摆藏进车身；贴图里上半身底边压在 0.86H
               （tools/make_drive.py 的 BODY_BOTTOM，必须 > 0.74H），
               所以车和角色之间不会露出缝
   charZ       角色沿车头方向前移量：再被车身多遮一点
   换车 / 换角色时只换图片，位置和尺寸全部自动推导，无需逐个手调。
   贴图两套（tools/make_drive.py 生成），骨架完全一致：
       {key}_drive.png        背面 → 比赛第三人称视角
       {key}_drive_front.png  正面 → 选人界面正对玩家 */
export const DRIVER_SEAT = {
  carW: 1.95,
  carHMin: 0.86,
  carHMax: 1.10,
  driverK: 1.42,
  seatRatio: 0.26,
  charZ: 0.20,
};

/* 由车辆立绘的高宽比推导显示尺寸 */
export function carSize(ratioHW) {
  const natH = DRIVER_SEAT.carW * ratioHW;
  const carH = Math.max(DRIVER_SEAT.carHMin, Math.min(DRIVER_SEAT.carHMax, natH));
  return { w: DRIVER_SEAT.carW, h: carH };
}

/* 由「车辆高宽比 + 角色贴图高宽比 + 角色缩放」推导一整套驾驶位度量。
   角色贴图统一为 240x320（AR 固定 1.3333），所以换角色只会等比缩放，骨架不变。 */
export function driverMetrics(carRatioHW, charAR, scale = 1) {
  const box = carSize(carRatioHW);
  const chH = box.h * DRIVER_SEAT.driverK * scale;
  const chW = chH / (charAR || 1.3333);
  return { carW: box.w, carH: box.h, chW, chH, seatY: box.h - chH * DRIVER_SEAT.seatRatio };
}

/* ---------- 道具 ---------- */
export const ITEMS = {
  banana:   { id: 'banana',   name: '香蕉皮', icon: 'banana',  color: '#ffd23d', desc: '选择车道后向后投放，踩到的车会打滑' },
  ink:      { id: 'ink',      name: '墨水',   icon: 'ink',     color: '#c084ff', desc: '遮挡前方对手的视野' },
  potion:   { id: 'potion',   name: '药水',   icon: 'potion',  color: '#3ee08a', desc: '立即恢复大量体力' },
  bolt:     { id: 'bolt',     name: '闪电',   icon: 'bolt',    color: '#5cd2ff', desc: '让其余所有对手短暂减速' },
  missile:  { id: 'missile',  name: '导弹',   icon: 'missile', color: '#ff5a3c', desc: '锁定前方最近对手自动追击，命中使其打滑' },
  shield:   { id: 'shield',   name: '护盾',   icon: 'shield',  color: '#66e0ff', desc: '短时间内免疫香蕉 / 导弹 / 墨水 / 闪电' },
};
export const ITEM_KEYS = ['banana', 'ink', 'potion', 'bolt', 'missile', 'shield'];

/* 名次靠后更容易拿到攻击性道具（轻量橡皮筋） */
export function rollItem(rank, total) {
  const last = (rank - 1) / Math.max(1, total - 1);   // 0 领跑 -> 1 垫底
  const w = {
    banana: 1.05,
    ink:    0.55 + last * 0.85,
    potion: 0.95 - last * 0.35,
    bolt:   0.30 + last * 1.15,
    missile: 0.20 + last * 1.25,     // 越靠后越易拿到导弹
    shield: 0.85 - last * 0.45,      // 越领先越易拿到护盾
  };
  let sum = 0;
  for (const k of ITEM_KEYS) sum += w[k];
  let r = Math.random() * sum;
  for (const k of ITEM_KEYS) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'banana';
}

/* ---------- 昵称池 ---------- */
export const AI_NAMES = [
  '闪电小北', '果冻骑士', '氮气小满', '橘子汽水', '夜行喵', '铁头娃',
  '风火轮阿May', '爆米花', '柠檬不酸', '卡丁小灰', '雾都车神', '麻辣兔头',
];

export function qs() {
  return new URLSearchParams(location.search);
}
