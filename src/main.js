/* ============================================================
   入口：THREE 装载 -> 资源 -> 选择页 -> 匹配 -> 比赛 -> 结算
   ============================================================ */
const CDN_LIST = [
  'https://unpkg.com/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://esm.sh/three@0.160.0',
  'https://cdn.skypack.dev/three@0.160.0',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js',
];

import { Net } from './net.js';

const QS = new URLSearchParams(location.search);
const $id = (id) => document.getElementById(id);

async function boot() {
  const msg = $id('loadMsg');
  const err = $id('loadErr');

  let THREE = null;
  for (let i = 0; i < CDN_LIST.length; i++) {
    msg.textContent = `正在装载 3D 引擎… (${i + 1}/${CDN_LIST.length})`;
    try { THREE = await import(/* @vite-ignore */ CDN_LIST[i]); break; }
    catch (e) { console.warn('CDN 失败:', CDN_LIST[i], e && e.message); }
  }
  if (!THREE) {
    msg.textContent = '3D 引擎加载失败';
    err.innerHTML = '无法从 CDN 载入 three.js。请检查网络后刷新。<br>若在离线环境，请把 three.module.js 放到本地并修改 src/main.js 的 CDN_LIST。';
    return;
  }
  window.THREE = THREE;

  // THREE 就位后再动态引入依赖它的模块
  const [{ loadAssets, IMG }, { createWorld }, { Race }, TRK, CFG, UI] = await Promise.all([
    import('./assets.js'),
    import('./world.js'),
    import('./race.js'),
    import('./track.js'),
    import('./config.js'),
    import('./ui.js'),
  ]);
  const { CHARACTERS, CARS, RULES, PHYS, CAM, RACER_COLORS, AI_NAMES, ITEM_KEYS } = CFG;

  /* ---------------- 渲染器 ---------------- */
  msg.textContent = '正在生成赛道与场景…';
  const canvas = $id('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.8));
  renderer.setSize(innerWidth, innerHeight, false);
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth / innerHeight, 0.35, 900);

  msg.textContent = '正在装载美术素材…';
  await loadAssets('.');

  const world = createWorld(scene);

  /* ---------------- UI ---------------- */
  UI.buildSelectors();
  UI.initHUD();
  UI.initMatchScreen();

  const sel = UI.selection;
  const nickEl = $id('nick');
  if (QS.get('nick')) nickEl.value = QS.get('nick');

  /* ---------------- 输入 ---------------- */
  const keys = new Set();
  const pinput = { throttle: 0, brake: 0, steer: 0, boost: false, useItem: false };
  let race = null;

  /* ---------------- 联机 ---------------- */
  const net = new Net();
  let netMode = null;          // null（单机）| 'host'（房主，跑模拟）| 'client'（渲染客户端）
  let netPlayers = [];         // 最近一次 lobby 玩家列表
  let snapshotAccum = 0;       // 房主发快照的节流累加器
  let netResultShown = false;  // 联机结算只弹一次

  function onKey(e, down) {
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    if (down) keys.add(c); else keys.delete(c);

    if (!down) return;
    // 道具键
    if (c === 'KeyE') {
      if (race && race.pendingUse) race.confirmAim();
      else pinput.useItem = true;
    }
    // 瞄准车道
    if (race && race.pendingUse) {
      const m = c.match(/^Digit([1-5])$/);
      if (m) race.aimLane = parseInt(m[1], 10);
      if (c === 'KeyA' || c === 'ArrowLeft') race.aimLane = Math.max(1, race.aimLane - 1);
      if (c === 'KeyD' || c === 'ArrowRight') race.aimLane = Math.min(5, race.aimLane + 1);
    } else if (netMode === 'client' && race) {
      // 联机客户端：没有本地 pendingUse，但仍把想要投放的车道上报给房主
      const m = c.match(/^Digit([1-5])$/);
      if (m) race.aimLane = parseInt(m[1], 10);
      if (c === 'KeyA' || c === 'ArrowLeft') race.aimLane = Math.max(1, race.aimLane - 1);
      if (c === 'KeyD' || c === 'ArrowRight') race.aimLane = Math.min(5, race.aimLane + 1);
    }
    if (c === 'Escape') {
      if (race && race.pendingUse) race.cancelAim();
      else if (state.mode === 'race') exitToMenu();
    }
    if (c === 'KeyR' && state.mode === 'race') hardRestart();
  }
  addEventListener('keydown', (e) => onKey(e, true));
  addEventListener('keyup', (e) => onKey(e, false));
  addEventListener('blur', () => keys.clear());

  function readInput() {
    pinput.throttle = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
    pinput.brake = (keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0;
    pinput.steer = ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0)
      - ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0);
    pinput.boost = keys.has('Space');
  }

  /* ---------------- 比赛流程 ---------------- */
  const state = {
    mode: 'select',
    matchT: RULES.matchSeconds,
    fast: QS.has('fast') || QS.has('auto'),
    orbit: 0.6,
    resultTick: 0,
    endTimer: 0,
    settled: false,
  };

  function makeRoster() {
    const pc = CHARACTERS.find((c) => c.key === sel.charKey) || CHARACTERS[0];
    const pcar = CARS.find((c) => c.file === sel.carFile) || CARS[0];
    const roster = [{
      id: 'p0',
      name: (nickEl.value || 'winner').slice(0, 8),
      isPlayer: true,
      isLocal: true,                                // 单机玩家 = 本机键盘操控的车
      charKey: pc.key, charBack: pc.back, charScale: pc.scale,
      carFile: pcar.file,
      color: RACER_COLORS[0],
    }];
    const pool = CHARACTERS.filter((c) => c.key !== pc.key);
    const cars = CARS.filter((c) => c.file !== pcar.file);
    // 洗牌
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (let i = cars.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[cars[i], cars[j]] = [cars[j], cars[i]]; }
    const names = AI_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[names[i], names[j]] = [names[j], names[i]]; }
    for (let i = 0; i < RULES.racers - 1; i++) {
      const c = pool[i % pool.length];
      const car = cars[i % cars.length];
      roster.push({
        id: 'a' + i,
        name: names[i % names.length],
        isPlayer: false,
        charKey: c.key, charBack: c.back, charScale: c.scale,
        carFile: car.file,
        color: RACER_COLORS[(i + 1) % RACER_COLORS.length],
      });
    }
    return roster;
  }

  function startMatch() {
    state.mode = 'match';
    state.matchT = state.fast ? 2.0 : RULES.matchSeconds;
    UI.showScreen('scr-match');
    UI.renderSlots([makeRosterPreview()]);
    UI.setMatchTimer(RULES.matchSeconds);
  }

  function makeRosterPreview() {
    const pc = CHARACTERS.find((c) => c.key === sel.charKey) || CHARACTERS[0];
    return {
      id: 'p0',
      name: (nickEl.value || 'winner').slice(0, 8),
      isPlayer: true,
      charKey: pc.key,
    };
  }

  function startRace() {
    const roster = state._roster || makeRoster();
    state._roster = null;
    state._rosterAll = roster;
    UI.renderSlots(roster.map((r) => ({
      name: r.name, isPlayer: r.isPlayer, charKey: r.charKey,
    })));
    UI.toast('AI 补位完成 · 准备发车！');

    race = new Race(roster, scene, {
      world,
      onEvent: onRaceEvent,
    });
    state.mode = 'race';
    state.endTimer = 0;
    state.settled = false;
    UI.setHUDVisible(!QS.has('nohud'));
    UI.showScreen('hud');
    if (QS.has('nohud')) $id('hud').classList.remove('on');
    camSnap = true;
  }

  function hardRestart() {
    if (race) {
      race.racers.forEach((r) => { if (r.view) scene.remove(r.view.grp); });
      race.bananas.forEach((b) => scene.remove(b.mesh));
    }
    race = null;
    state.mode = 'select';
    UI.showScreen('scr-select');
  }

  function onRaceEvent(type, a, b, c) {
    if (type === 'pickup' && a.isPlayer) UI.toast('拿到道具：' + nameOf(a.item), 900);
    if (type === 'use') {
      if (a.isPlayer) UI.toast('使用 ' + nameOf(a.item) + (a.item === 'banana' ? ` → ${c} 道` : ''), 900);
    }
    if (type === 'hit' && b && b.isPlayer) UI.toast('被墨水糊了一脸！', 1100);
    if (type === 'spin' && a.isPlayer) UI.toast('打滑失控！', 1000);
    if (type === 'lap' && a.isPlayer) UI.toast(`第 ${a.lap} 圈`, 900);
    if (type === 'finish') {
      if (a.isPlayer && netMode === null) {
        state.mode = 'result';
        setTimeout(() => {
          UI.showResult(race);
          UI.showScreen('scr-result');
        }, 1400);
      }
    }
  }
  function nameOf(k) {
    return ({ banana: '香蕉皮', ink: '墨水', potion: '药水', bolt: '闪电' })[k] || k;
  }

  $id('btnStart').onclick = () => { state._roster = makeRoster(); startMatch(); };
  $id('btnSkip').onclick = () => { state.matchT = Math.min(state.matchT, 0.05); };
  $id('btnAgain').onclick = () => {
    if (netMode === 'host') doStartOnline();
    else if (netMode === 'client') UI.toast('等待房主再来一局', 1200);
    else { hardRestart(); state._roster = makeRoster(); startMatch(); }
  };
  $id('btnBack').onclick = () => {
    if (netMode) doLeaveRoom(); else hardRestart();
  };

  /* ---------------- 联机流程 ---------------- */
  function enterOnline() {
    UI.showScreen('scr-online');
    netMode = null; netPlayers = [];
    const pc = CHARACTERS.find((c) => c.key === sel.charKey) || CHARACTERS[0];
    const pcar = CARS.find((c) => c.file === sel.carFile) || CARS[0];
    const cn = $id('onlineCharName'); if (cn) cn.textContent = pc.name;
    const kn = $id('onlineCarName'); if (kn) kn.textContent = pcar.name;
    net.connect().then(() => {
      UI.toast('已连接联机服务器', 900);
    }).catch(() => {
      UI.toast('无法连接联机服务器，请先启动 server/server.js', 1800);
      UI.showScreen('scr-select');
    });
  }
  function doCreateRoom() {
    net.createRoom((nickEl.value || 'winner').slice(0, 8), sel.charKey, sel.carFile);
  }
  function doJoinRoom() {
    const code = ($id('roomCodeInput').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { UI.toast('请输入 4 位房间号', 1200); return; }
    net.joinRoom(code, (nickEl.value || 'winner').slice(0, 8), sel.charKey, sel.carFile);
  }
  function doLeaveRoom() {
    net.leave(); netMode = null; netPlayers = [];
    cleanupRace();
    UI.showScreen('scr-select'); state.mode = 'select';
  }
  function exitToMenu() {
    // 比赛中按 Esc 返回主菜单（选人页）
    if (netMode) { doLeaveRoom(); return; }
    cleanupRace();
    UI.setHUDVisible(false);
    UI.showScreen('scr-select');
    state.mode = 'select';
  }
  function cleanupRace() {
    if (race) {
      race.racers.forEach((r) => { if (r.view) scene.remove(r.view.grp); });
      race.bananas.forEach((b) => scene.remove(b.mesh));
    }
    race = null;
  }
  function doStartOnline() {
    if (!net.isHost || !netPlayers.length) return;
    const players = netPlayers.map((p) => ({ id: p.id, name: p.name, charKey: p.charKey, carFile: p.carFile, color: p.color }));
    const roster = buildNetRoster(players);
    net.startGame(roster);
  }
  function buildNetRoster(players) {
    const roster = players.map((p, idx) => {
      const c = CHARACTERS.find((x) => x.key === p.charKey) || CHARACTERS[0];
      return {
        id: p.id, name: p.name, isPlayer: true, isLocal: p.id === net.id,
        charKey: c.key, charBack: c.back, charScale: c.scale,
        carFile: p.carFile, color: RACER_COLORS[idx % RACER_COLORS.length],
      };
    });
    const target = Math.min(6, Math.max(5, players.length));
    const usedC = new Set(players.map((p) => p.charKey));
    const usedK = new Set(players.map((p) => p.carFile));
    const pool = CHARACTERS.filter((c) => !usedC.has(c.key));
    const carPool = CARS.filter((c) => !usedK.has(c.file));
    let ai = 0;
    while (roster.length < target) {
      const c = pool[ai % pool.length];
      const car = carPool[ai % carPool.length];
      roster.push({
        id: 'a' + ai, name: AI_NAMES[ai % AI_NAMES.length], isPlayer: false,
        charKey: c.key, charBack: c.back, charScale: c.scale,
        carFile: car.file, color: RACER_COLORS[roster.length % RACER_COLORS.length],
      });
      ai++;
    }
    return roster;
  }
  function startRaceNet(mode, roster) {
    cleanupRace();
    netMode = mode;
    netResultShown = false;
    state._rosterAll = roster;
    race = new Race(roster, scene, {
      world, onEvent: onRaceEvent,
      netClient: mode === 'client', myId: mode === 'client' ? net.id : null,
    });
    state.mode = 'race'; state.endTimer = 0; state.settled = false;
    UI.setHUDVisible(true); UI.showScreen('hud'); camSnap = true;
    UI.toast(mode === 'host' ? '你是房主，方向盘交给你！' : '已进入房间，准备出发！', 1300);
  }
  function maybeShowNetResult() {
    if (!race || netResultShown) return;
    const p = race.player;
    if ((p && p.finished) || race.allFinished) {
      netResultShown = true;
      state.resultTick = 0;
      setTimeout(() => { UI.showResult(race); UI.showScreen('scr-result'); }, 1400);
    }
  }

  /* 联机事件 */
  net.on('created', () => UI.showScreen('scr-lobby'));
  net.on('joined', () => UI.showScreen('scr-lobby'));
  net.on('lobby', (m) => { netPlayers = m.players || []; UI.renderLobby(m, net.isHost); });
  net.on('start', (m) => { startRaceNet(m.host === net.id ? 'host' : 'client', m.roster); });
  net.on('input', (m) => {
    if (!race || netMode !== 'host') return;
    const r = race.byId[m.from];
    if (!r || !r.netInput) return;
    r.netInput.throttle = m.throttle; r.netInput.brake = m.brake; r.netInput.steer = m.steer;
    r.netInput.boost = m.boost;
    r.netInput.useItem = r.netInput.useItem || m.useItem;
    r.netInput.aimLane = m.aimLane;
  });
  net.on('snap', (data) => { if (race && netMode === 'client') race.applySnapshot(data); });
  net.on('peerLeft', (m) => { if (race && netMode === 'host') race.removeRacer(m.id); });
  net.on('roomEnded', (m) => { UI.toast(m.msg || '房间已关闭', 1600); doLeaveRoom(); });
  net.on('error', (msg) => UI.toast(msg || '联机错误', 1600));
  net.on('close', () => { if (netMode) UI.toast('与服务器断开', 1500); });

  // 联机界面按钮
  $id('btnOnline').onclick = enterOnline;
  $id('btnCreateRoom').onclick = doCreateRoom;
  $id('btnJoinRoom').onclick = doJoinRoom;
  $id('btnLeaveRoom').onclick = doLeaveRoom;
  $id('btnStartOnline').onclick = doStartOnline;
  $id('btnOnlineBack').onclick = () => UI.showScreen('scr-select');
  $id('btnCopyCode').onclick = () => {
    if (net.code && navigator.clipboard) navigator.clipboard.writeText(net.code).then(() => UI.toast('房间号已复制', 900));
  };

  /* ---------------- 相机 ---------------- */
  const camPos = new THREE.Vector3(0, 90, 170);
  const camAim = new THREE.Vector3(0, 0, 0);
  let camSnap = false;
  let fovNow = CAM.fov;

  function updateCamera(dt) {
    if (state.mode === 'race' && race && race.player) {
      const r = race.player;
      const fx = Math.cos(r.yaw), fz = Math.sin(r.yaw);
      const dist = CAM.dist + Math.max(0, (r.v - PHYS.maxSpeed) * 0.085);
      const wy = CAM.height + Math.sin(race.time * 2.4) * 0.035;
      const k = camSnap ? 1 : (1 - Math.exp(-CAM.posDamp * dt));
      const ka = camSnap ? 1 : (1 - Math.exp(-CAM.aimDamp * dt));
      camPos.x += (r.x - fx * dist - camPos.x) * k;
      camPos.z += (r.z - fz * dist - camPos.z) * k;
      camPos.y += (wy - camPos.y) * k;
      camAim.x += (r.x + fx * CAM.lookAhead - camAim.x) * ka;
      camAim.z += (r.z + fz * CAM.lookAhead - camAim.z) * ka;
      camAim.y += (CAM.lookUp - camAim.y) * ka;

      const shake = r.boosting ? 0.055 : 0;
      const fovT = CAM.fov + (r.boosting ? CAM.fovBoost : 0);
      fovNow += (fovT - fovNow) * (1 - Math.exp(-5 * dt));

      camera.position.set(
        camPos.x + (Math.random() - 0.5) * shake,
        camPos.y + (Math.random() - 0.5) * shake,
        camPos.z + (Math.random() - 0.5) * shake
      );
      camera.lookAt(camAim);
      camera.fov = fovNow;
      camera.updateProjectionMatrix();
      camSnap = false;
    } else {
      state.orbit += dt * (QS.get('orbit') ? 0 : 0.055);
      const R = 132, H = 104;
      camPos.set(Math.cos(state.orbit) * R, H, Math.sin(state.orbit) * R * 0.55);
      camera.position.copy(camPos);
      camera.lookAt(0, 0, 0);
      if (camera.fov !== CAM.fov) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); }
    }
  }

  /* ---------------- 主循环 ---------------- */
  let last = performance.now();
  let hudTick = 0;
  let autoStarted = false;

  function frame(now) {
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, rawDt);

    const t = now / 1000;

    if (state.mode === 'match') {
      state.matchT -= dt;
      UI.setMatchTimer(state.matchT);
      if (state.matchT <= 0) startRace();
      if (!state._roster) state._roster = makeRoster();
    }

    if (state.mode === 'race' && race) {
      if (netMode === 'client') {
        // 渲染客户端：只发送输入、按快照插值渲染，物理全部在房主端
        readInput();
        net.sendInput({
          throttle: pinput.throttle, brake: pinput.brake, steer: pinput.steer,
          boost: pinput.boost, useItem: pinput.useItem, aimLane: race.aimLane,
        });
        pinput.useItem = false;
        race.netTick(dt);
        race.syncViews(dt, t, camera);
        world.update(dt, t);
        UI.updateHUD(race);
        UI.drawMinimap(race);
        maybeShowNetResult();
      } else {
        // 单机 或 房主（房主在本地跑完整模拟）
        readInput();
        race.step(dt, pinput);
        pinput.useItem = false;
        race.syncViews(dt, t, camera);
        world.update(dt, t);
        UI.updateHUD(race);
        UI.drawMinimap(race);

        if (netMode === 'host') {
          snapshotAccum += dt;
          if (snapshotAccum >= 0.05) { snapshotAccum = 0; net.sendSnapshot(race.serialize()); }
          if (race.allFinished) maybeShowNetResult();
        }

        // 玩家已完赛 -> 等其他人跑完（最多再等 28 秒），实时刷新名次
        if (race.player && race.player.finished) {
          state.endTimer += dt;
          state.resultTick += dt;
          if (state.resultTick > 0.45) {
            state.resultTick = 0;
            UI.showResult(race);
          }
          if (!race.allFinished && state.endTimer > 28) finalizeRemaining();
        }
      }
    } else if (state.mode === 'result' && race) {
      race.step(dt, { throttle: 0, brake: 1, steer: 0, boost: false, useItem: false });
      race.syncViews(dt, t, camera);
      world.update(dt, t);
      UI.drawMinimap(race);
      state.endTimer += dt;
      state.resultTick += dt;
      if (race.allFinished && !state.settled) { state.settled = true; UI.showResult(race); }
      if (state.resultTick > 0.5) { state.resultTick = 0; UI.showResult(race); }
      if (!race.allFinished && state.endTimer > 28) finalizeRemaining();
    } else {
      world.update(dt, t);
    }

    updateCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function finalizeRemaining() {
    if (!race) return;
    const L = TRK.TRACK_LEN;
    for (const r of race.racers) {
      if (r.finished) continue;
      const remain = Math.max(0, RULES.laps * L - r.s);
      r.finished = true;
      r.finishTime = race.time + remain / Math.max(9, r.v || 12);
      race.finishOrder.push(r);
    }
    race.computeRanks();
    state.settled = true;
    UI.showResult(race);
  }

  /* ---------------- 调试参数 ---------------- */
  const wantDiag = QS.has('diag') || QS.has('selftest');
  if (wantDiag) {
    setTimeout(() => {
      let meshes = 0, tris = 0;
      scene.traverse((o) => {
        if (o.isMesh && o.geometry) {
          meshes++;
          const g = o.geometry;
          tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        }
      });
      console.log('[diag] meshes=' + meshes + ' baseTris=' + Math.round(tris));
      console.log('[diag] tracklen=' + TRK.TRACK_LEN.toFixed(1) + ' boxes=' + world.itemBoxes.length);
      console.log('[diag] chars=' + CHARACTERS.length + ' cars=' + CARS.length + ' imgs=' + Object.keys(IMG).length);
      if (race) {
        const p = race.player;
        console.log('[diag] playerCar=' + p.carFile + ' char=' + p.charKey);
        console.log('[diag] pS=' + p.s.toFixed(1) + ' pLat=' + p.lat.toFixed(2) + ' pV=' + p.v.toFixed(1));
        console.log('[diag] camDist=' + camera.position.distanceTo(new THREE.Vector3(p.x, 0, p.z)).toFixed(2));
        console.log('[diag] groups=' + race.racers.filter((r) => r.view && r.view.grp.visible).length);
      }
    }, 900);
  }

  /* ---------------- 无头自检：跑完整场比赛，输出名次与完赛时间 ---------------- */
  if (QS.has('selftest')) setTimeout(() => {
    if (!race) return;
    // 重建一场干净比赛再跑
    race.racers.forEach((r) => { if (r.view) scene.remove(r.view.grp); });
    race.bananas.forEach((b) => scene.remove(b.mesh));
    race = new Race(state._rosterAll || makeRoster(), scene, { world, onEvent: onRaceEvent });
    const secs = Math.max(20, parseFloat(QS.get('selftest')) || 220);
    race.phase = 'running';
    race.countdown = 0;
    const dtF = 1 / 60;
    const steps = Math.round(secs / dtF);
    let bad = 0;
    const marks = [];
    for (let i = 0; i < steps; i++) {
      const p = race.player;
      const steer = Math.max(-1, Math.min(1, (0 - p.lat) * 0.45));
      race.step(dtF, {
        throttle: 1, brake: 0, steer,
        boost: p.stamina > 55 && i % 260 < 130,
        useItem: false,
      });
      if (QS.has('autouse') && p.item && i % 150 === 0) p.input.useItem = true;
      if (i % 600 === 0) {
        marks.push('[simT] ' + (i / 60).toFixed(0) + 's fin=' + race.racers.filter((r) => r.finished).length + ' banana=' + race.bananas.length);
        for (const r of race.standings) {
          marks.push('[sim] ' + r.name + ' s=' + r.s.toFixed(0) + ' lap=' + r.lap
            + ' v=' + r.v.toFixed(1) + ' st=' + r.stamina.toFixed(0)
            + ' item=' + (r.item || '-') + ' rk=' + r.rank);
        }
        marks.push('[simDbg] ' + race.standings.map((r) => r.name.slice(0, 4)
          + ':b' + (r.boostTime || 0).toFixed(0) + 'w' + (r.wallHits || 0)).join(' '));
      }
      for (const r of race.racers) {
        if (!isFinite(r.s) || !isFinite(r.lat) || !isFinite(r.v) || !isFinite(r.stamina)) bad++;
      }
      if (race.racers.every((r) => r.finished)) { marks.push('[simT] ALL FINISHED at ' + race.time.toFixed(1) + 's'); break; }
    }
    marks.push('[simEnd] time=' + race.time.toFixed(1) + ' nan=' + bad + ' banana=' + race.bananas.length);
    race.standings.forEach((r, i) => {
      marks.push('[simOrd] ' + (i + 1) + ' ' + r.name + ' ' + (r.finished ? r.finishTime.toFixed(2) : 'DNF'));
    });
    marks.forEach((m) => console.log(m));
  }, 1300);

  // 预选角色 / 车辆（截图核对用，也方便分享带配置的直达链接）
  if (QS.get('char') || QS.get('car')) {
    if (QS.get('char')) sel.charKey = QS.get('char');
    if (QS.get('car')) sel.carFile = QS.get('car');
    UI.buildSelectors();                 // 重建卡片高亮 + 预览
  }

  // 自动化/截图模式：跳过选择页
  if (QS.has('auto')) {
    if (QS.get('laps')) RULES.laps = parseInt(QS.get('laps'), 10) || RULES.laps;
    if (QS.get('nick')) nickEl.value = QS.get('nick');
    state._roster = makeRoster();
    if (QS.has('race')) {
      // 直接开赛（截图 / 回归用）
      startRace();
      if (QS.has('nocount')) race.countdown = 0.02;
      if (QS.has('esc')) {
        // 调试：开赛 N 秒后自动按 Esc 返回主菜单（回归用）
        const ms = (parseFloat(QS.get('esc')) || 3) * 1000;
        setTimeout(() => exitToMenu(), ms);
      }
    } else {
      $id('btnStart').click();
    }
  }

  // 先空跑一段模拟，便于截图时直接落在"比赛中"的状态
  if (QS.has('warm') && race) {
    const warmSec = Math.max(0, parseFloat(QS.get('warm')) || 0);
    race.phase = 'running';
    race.countdown = 0;
    const dtF = 1 / 60;
    const steps = Math.round(warmSec / dtF);
    const b = QS.has('boost');
    for (let i = 0; i < steps; i++) {
      const p = race.player;
      const steer = Math.max(-1, Math.min(1, (0 - p.lat) * 0.45));
      race.step(dtF, {
        throttle: 1, brake: 0, steer,
        boost: b || (p.stamina > 55 && i % 260 < 120),
        useItem: false,
      });
      // 让玩家自动捡道具，便于观察道具 HUD
      if (QS.has('autouse') && p.item && i % 150 === 0) p.input.useItem = true;
    }
    race.syncViews(dtF, 0, camera);
    camSnap = true;
    updateCamera(dtF);
  }

  // 截图用的道具状态（放在热身之后，避免被模拟消耗）
  if (race) {
    if (QS.has('ink')) race.inkTimer = 6;
    if (QS.has('aim')) {
      race.player.item = 'banana';
      race.pendingUse = { r: race.player, t: 30 };
      race.aimLane = parseInt(QS.get('aimlane'), 10) || 2;
    }
    if (QS.has('item')) race.player.item = QS.get('item');
  }

  // 联机自动化/截图入口：?net=create 自动建房并进入大厅；?net=start 自动建房+开始
  if (QS.get('net') === 'create' || QS.get('net') === 'start') {
    net.connect().then(() => {
      net.createRoom((nickEl.value || 'winner').slice(0, 8), sel.charKey, sel.carFile);
    }).catch(() => { UI.toast('联机服务器连接失败', 1500); });
    if (QS.get('net') === 'start') {
      const iv = setInterval(() => {
        if (net.isHost && netPlayers.length) { clearInterval(iv); doStartOnline(); }
      }, 200);
      setTimeout(() => clearInterval(iv), 12000);
    }
  }

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  $id('loading').classList.add('hide');
  requestAnimationFrame(frame);
  window.__game = { scene, camera, renderer, get race() { return race; }, state, world };
}

boot().catch((e) => {
  console.error(e);
  const msg = document.getElementById('loadMsg');
  const err = document.getElementById('loadErr');
  if (msg) msg.textContent = '启动失败';
  if (err) err.textContent = String(e && e.stack || e);
});
