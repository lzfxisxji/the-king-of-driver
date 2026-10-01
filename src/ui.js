/* ============================================================
   UI 层：选择页 / 匹配页 / HUD / 小地图 / 结算
   ============================================================ */
import { CHARACTERS, CARS, ITEMS, RULES, carSize, driverMetrics } from './config.js';
import { IMG, makeInkSplat } from './assets.js';

export const $ = (id) => document.getElementById(id);

/* ---------------- 道具图标（内联 SVG） ---------------- */
const ICONS = {
  banana: `<svg viewBox="0 0 64 64"><path d="M10 16c6 26 24 36 42 30-6 12-22 16-34 8C6 46 4 28 10 16z" fill="#ffd63d" stroke="#b98a00" stroke-width="3" stroke-linejoin="round"/><path d="M12 15l-4-7 8 2z" fill="#7a5a00"/><circle cx="47" cy="14" r="4" fill="#f5c400" opacity=".6"/></svg>`,
  ink: `<svg viewBox="0 0 64 64"><path d="M32 6c10 14 20 22 20 32a20 20 0 11-40 0C12 28 22 20 32 6z" fill="#8b5cf6" stroke="#4c1d95" stroke-width="3"/><ellipse cx="25" cy="36" rx="6" ry="8" fill="#fff" opacity=".35"/></svg>`,
  potion: `<svg viewBox="0 0 64 64"><rect x="26" y="6" width="12" height="10" rx="3" fill="#c9a227" stroke="#7a5a00" stroke-width="2.5"/><path d="M24 16h16v8l8 14a14 14 0 01-12 22H28a14 14 0 01-12-22l8-14z" fill="#7ee787" stroke="#1f7a3a" stroke-width="3" stroke-linejoin="round"/><ellipse cx="26" cy="44" rx="5" ry="7" fill="#fff" opacity=".4"/></svg>`,
  bolt: `<svg viewBox="0 0 64 64"><path d="M36 4L14 36h14l-4 24 22-32H32z" fill="#5cd2ff" stroke="#0d5f8a" stroke-width="3" stroke-linejoin="round"/></svg>`,
};

function racerIcon(kind) { return ICONS[kind] || ''; }

/* ---------------- 选择页 ---------------- */
export const selection = { charKey: CHARACTERS[0].key, carFile: CARS[0].file, nick: 'winner' };

export function buildSelectors() {
  const cg = $('charGrid');
  cg.innerHTML = '';
  CHARACTERS.forEach((ch) => {
    const el = document.createElement('div');
    el.className = 'card' + (ch.key === selection.charKey ? ' sel' : '');
    el.dataset.key = ch.key;
    el.innerHTML = `<span class="tag">${ch.tag}</span><span class="check">✓</span>
      <img src="./assets/chars/${ch.portrait}.png" alt="${ch.name}">
      <span class="nm">${ch.name}</span>`;
    el.onclick = () => {
      selection.charKey = ch.key;
      [...cg.children].forEach((c) => c.classList.toggle('sel', c.dataset.key === ch.key));
      refreshPreview();
    };
    cg.appendChild(el);
  });

  const kg = $('carGrid');
  kg.innerHTML = '';
  CARS.forEach((car) => {
    const el = document.createElement('div');
    el.className = 'card' + (car.file === selection.carFile ? ' sel' : '');
    el.dataset.key = car.file;
    el.innerHTML = `<span class="tag">${car.group}</span><span class="check">✓</span>
      <img src="./assets/cars/${car.file}.png" alt="${car.name}">
      <span class="nm">${car.name}</span>`;
    el.onclick = () => {
      selection.carFile = car.file;
      [...kg.children].forEach((c) => c.classList.toggle('sel', c.dataset.key === car.file));
      refreshPreview();
    };
    kg.appendChild(el);
  });
  refreshPreview();
}

function currentChar() { return CHARACTERS.find((c) => c.key === selection.charKey) || CHARACTERS[0]; }
function currentCar() { return CARS.find((c) => c.file === selection.carFile) || CARS[0]; }

/* 预览舞台：每「世界单位」对应的像素数。
   这里刻意用和 src/race.js 完全相同的度量（carSize / driverMetrics），
   所以预览里「人坐进车」的组合比例与实际比赛画面必然一致，
   换车 / 换角色只换图片，尺寸与位置自动推导。

   选人界面固定用 **正面** 贴图（{key}_drive_front.png）：角色正对着玩家。
   比赛里用背面贴图（{key}_drive.png）：第三人称跟车视角看背影。
   两套贴图共用同一张 240x320 画布与同一套骨架，所以尺寸完全一致。 */
const PV_SCALE = 90;    // px / 世界单位（车身宽 1.95 → 约 176px）
const PV_GROUND = 24;   // 车轮着地线距舞台底部的像素

export function layoutPreview() {
  const ch = currentChar(), car = currentCar();
  const pc = $('pvChar'), pr = $('pvCar');
  if (!pc || !pr || !pc.naturalWidth || !pr.naturalWidth) return;   // 图还没解码完

  const carAR = pr.naturalHeight / pr.naturalWidth;     // 高 / 宽
  const box = carSize(carAR);
  const m = driverMetrics(carAR, pc.naturalHeight / pc.naturalWidth, ch.scale);

  pr.style.objectFit = 'fill';                          // 与 race.js 一样按世界尺寸拉伸
  pr.style.width = (box.w * PV_SCALE).toFixed(1) + 'px';
  pr.style.height = (box.h * PV_SCALE).toFixed(1) + 'px';
  pr.style.bottom = PV_GROUND + 'px';

  pc.style.width = (m.chW * PV_SCALE).toFixed(1) + 'px';
  pc.style.height = 'auto';
  pc.style.bottom = (PV_GROUND + m.seatY * PV_SCALE).toFixed(1) + 'px';

  if (typeof location !== 'undefined' && location.search.indexOf('pvdbg') >= 0) {
    console.log('[pvdbg] carNat=' + pr.naturalWidth + 'x' + pr.naturalHeight
      + ' chNat=' + pc.naturalWidth + 'x' + pc.naturalHeight
      + ' box=' + box.w.toFixed(3) + 'x' + box.h.toFixed(3)
      + ' ch=' + m.chW.toFixed(3) + 'x' + m.chH.toFixed(3)
      + ' carPx=' + pr.style.width + '/' + pr.style.height
      + ' chPx=' + pc.style.width + '/auto/' + pc.style.bottom
      + ' chBox=' + pc.clientWidth + 'x' + pc.clientHeight
      + ' carBox=' + pr.clientWidth + 'x' + pr.clientHeight);
  }
}

export function refreshPreview() {
  const ch = currentChar(), car = currentCar();
  // 中央预览直接展示「驾驶员坐进这辆车」的组合，而不是角色/车辆两张图并排；
  // 选人阶段用正面贴图 —— 角色正对着玩家
  const pc = $('pvChar'), pr = $('pvCar');
  pc.onload = layoutPreview;
  pr.onload = layoutPreview;
  pc.src = `./assets/chars/${ch.key}_drive_front.png`;
  pr.src = `./assets/cars/${car.file}.png`;
  layoutPreview();                       // 图已缓存时立刻排版
  $('pvName').textContent = `${ch.name} · ${car.name}`;
  $('pvTitle').textContent = `${ch.title} / ${ch.tag}`;
}

/* ---------------- 匹配页 ---------------- */
export function initMatchScreen() {
  const wrap = $('matchSlots');
  wrap.innerHTML = '';
  for (let i = 0; i < RULES.racers; i++) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.id = 'slot' + i;
    wrap.innerHTML += '';
    wrap.appendChild(el);
  }
}

export function renderSlots(entries) {
  for (let i = 0; i < RULES.racers; i++) {
    const el = $('slot' + i);
    const e = entries[i];
    if (!e) {
      el.className = 'slot';
      el.innerHTML = `<div style="font-size:22px;opacity:.5">＋</div><div class="who">等待中</div>`;
      continue;
    }
    el.className = 'slot filled' + (e.isPlayer ? ' me' : '');
    const ch = CHARACTERS.find((c) => c.key === e.charKey) || CHARACTERS[0];
    el.innerHTML = `<img src="./assets/chars/${ch.portrait}.png" alt="">
      <div class="who">${e.name}</div>
      <div class="kind">${e.isPlayer ? '真人玩家' : 'AI 电脑'}</div>`;
  }
}

export function setMatchTimer(sec) {
  $('matchNum').textContent = Math.max(0, Math.ceil(sec));
  const p = (1 - sec / RULES.matchSeconds) * 100;
  $('matchRing').style.setProperty('--p', p.toFixed(1) + '%');
}

/* ---------------- HUD ---------------- */
let inkUrl = null;

export function initHUD() {
  inkUrl = makeInkSplat(7);
  $('ink').style.backgroundImage = `url(${inkUrl})`;
  const aim = $('aimLanes');
  aim.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const d = document.createElement('div');
    d.className = 'ln';
    d.id = 'aim' + i;
    d.textContent = i;
    aim.appendChild(d);
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function setCountdown(txt) {
  const el = $('countdown');
  if (!txt) { el.classList.remove('on'); el.textContent = ''; return; }
  if (el.textContent !== txt) {
    el.textContent = txt;
    el.classList.toggle('go', txt === 'GO!');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }
}

export function updateHUD(race, opts = {}) {
  const p = race.player;
  if (!p) return;
  $('rankNum').textContent = p.rank;
  $('hudLap').textContent = `圈数 ${p.lap}/${RULES.laps}`;
  $('timeVal').textContent = fmtTime(race.time);
  $('stamNum').textContent = `${Math.round(p.stamina)} / 100`;
  const fill = $('stamFill');
  fill.style.width = (p.stamina / 100 * 100) + '%';
  $('hudStam').classList.toggle('boosting', p.boosting);
  $('spdVal').textContent = Math.round(Math.max(0, p.v) * 3.9);

  // 发车倒计时
  if (race.phase === 'countdown') {
    const n = Math.ceil(race.countdown);
    setCountdown(n > 1 ? String(n - 1) : 'GO!');
  } else if (race.time < 0.85) {
    setCountdown('GO!');
  } else {
    setCountdown(null);
  }

  const slot = $('hudItem');
  if (p.item) {
    slot.classList.add('has');
    $('itemPh').innerHTML = `${racerIcon(p.item)}`;
    $('itemKey').textContent = `${ITEMS[p.item].name} · E 使用`;
  } else {
    slot.classList.remove('has');
    $('itemPh').innerHTML = '暂无道具<br>撞蓝色 ? 获取';
    $('itemKey').textContent = '';
  }

  // 瞄准提示
  const aiming = !!race.pendingUse;
  $('aim').classList.toggle('on', aiming);
  if (aiming) {
    for (let i = 1; i <= 5; i++) $('aim' + i).classList.toggle('sel', i === race.aimLane);
  }

  // 墨水 / 闪电闪白
  $('ink').classList.toggle('on', race.inkTimer > 0);
  $('flash').style.opacity = race.flashTimer > 0 ? Math.min(1, race.flashTimer * 2.4) : 0;
}

/* ---------------- 小地图 ---------------- */
const MM = { cx: 230, cy: 126, k: 2.751 };
export function drawMinimap(race) {
  const c = $('mini');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (IMG.minimapCanvas) g.drawImage(IMG.minimapCanvas, 0, 0, c.width, c.height);
  for (const r of race.racers) {
    const x = MM.cx + r.x * MM.k, y = MM.cy + r.z * MM.k;
    g.beginPath();
    g.arc(x, y, r.isPlayer ? 8.5 : 6.5, 0, 7);
    g.fillStyle = r.color;
    g.fill();
    g.lineWidth = r.isPlayer ? 3.5 : 2.4;
    g.strokeStyle = r.isPlayer ? '#ffffff' : 'rgba(255,255,255,.9)';
    g.stroke();
  }
}

/* ---------------- 结算 ---------------- */
export function showResult(race) {
  const list = $('resList');
  const me = race.player;
  list.innerHTML = '';
  const st = race.standings;
  st.forEach((r, i) => {
    const ch = CHARACTERS.find((c) => c.key === r.charKey) || CHARACTERS[0];
    const car = CARS.find((c) => c.file === r.carFile) || CARS[0];
    const row = document.createElement('div');
    row.className = 'res-row' + (r.isPlayer ? ' me' : '');
    const cls = i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : '';
    const tm = r.finished ? fmtTime(r.finishTime) : '<span class="live">比赛中…</span>';
    row.innerHTML = `<div class="p ${cls}">${i + 1}</div>
      <img class="car" src="./assets/cars/${car.file}.png" alt="">
      <div class="info">
        <img class="face" src="./assets/chars/${ch.portrait}.png" alt="">
        <span class="who">${r.name}<span class="k">${r.isPlayer ? '你' : 'AI'}</span></span>
      </div>
      <div class="tm${r.finished ? '' : ' live'}">${tm}</div>`;
    list.appendChild(row);
  });
  const myRank = me ? me.rank : 0;
  $('resTitle').textContent = myRank === 1 ? '🏆 冠军！' : `第 ${myRank} 名`;
  $('resSub').textContent = me && me.finished
    ? `完赛用时 ${fmtTime(me.finishTime)} · 共 ${RULES.laps} 圈`
    : (race.allFinished ? '全部车手完赛' : '其他车手仍在比赛中…');
}

/* ---------------- 杂项 ---------------- */
let toastTimer = 0;
export function toast(text, ms = 1100) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

export function showScreen(id) {
  ['scr-select', 'scr-match', 'scr-result', 'scr-online', 'scr-lobby'].forEach((s) => $(s).classList.toggle('on', s === id));
  $('hud').classList.toggle('on', id === 'hud');
}

export function setHUDVisible(on) { $('hud').classList.toggle('on', on); }

/* ---------------- 联机大厅 ---------------- */
export function renderLobby(m, isHost) {
  $('lobbyCode').textContent = m.code || '----';
  const wrap = $('lobbySlots');
  wrap.innerHTML = '';
  const players = m.players || [];
  const MAX = 6;
  for (let i = 0; i < MAX; i++) {
    const el = document.createElement('div');
    const p = players[i];
    if (!p) {
      el.className = 'slot';
      el.innerHTML = `<div style="font-size:22px;opacity:.5">＋</div><div class="who">等待中</div>`;
      wrap.appendChild(el);
      continue;
    }
    const ch = CHARACTERS.find((c) => c.key === p.charKey) || CHARACTERS[0];
    el.className = 'slot filled' + (p.isHost ? ' me' : '');
    el.innerHTML = `<img src="./assets/chars/${ch.portrait}.png" alt="">
      <div class="who">${p.name}${p.isHost ? ' 👑' : ''}</div>
      <div class="kind">${p.isHost ? '房主' : '玩家'}</div>`;
    wrap.appendChild(el);
  }
  const startBtn = $('btnStartOnline');
  if (startBtn) startBtn.style.display = isHost ? '' : 'none';
  const hint = $('lobbyHint');
  if (hint) hint.textContent = isHost
    ? '你是房主，人齐后点「开始游戏」'
    : '等待房主开始游戏…（把房间号发给好友一起玩）';
}
