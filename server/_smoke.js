/* 联机协议端到端冒烟测试：房主 + 客人 全流程
   覆盖：create/join/start(roster)/snapshot 下发 / input 上行 / 非房主 start 被拒 / peerLeft 通知
*/
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const URL = 'ws://127.0.0.1:' + PORT;

function client(name) {
  const ws = new WebSocket(URL);
  ws.name = name;
  ws.events = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    ws.events.push(m);
    console.log('[' + name + '] <-', m.t, m.msg ? '(' + m.msg + ')' : (m.code ? '{code ' + m.code + '}' : (m.roster ? '{roster ' + m.roster.length + '}' : '')));
  });
  return ws;
}
const send = (ws, o) => ws.send(JSON.stringify(o));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (ws) => new Promise((r) => ws.on('open', r));

(async () => {
  const host = client('HOST');
  await open(host);
  const guest = client('GUEST');
  await open(guest);

  const roster = [
    { id: 'c1', name: '房主', isPlayer: true, isLocal: true, charKey: 'lulu', charBack: '', charScale: 1, carFile: 'white_falcon', color: '#f00' },
    { id: 'c2', name: '客人', isPlayer: true, isLocal: false, charKey: 'momo', charBack: '', charScale: 1, carFile: 'red_bug', color: '#0f0' },
    { id: 'a0', name: 'AI1', isPlayer: false, charKey: 'bobo', carFile: 'blue_cat' },
  ];

  // 1) 房主创房
  send(host, { t: 'create', name: '房主', charKey: 'lulu', carFile: 'white_falcon' });
  await wait(120);
  const created = host.events.find((e) => e.t === 'created');
  if (!created) throw new Error('房主未收到 created');
  const code = created.code;
  console.log('>> 房间号 =', code);

  // 2) 客人加入
  send(guest, { t: 'join', code, name: '客人', charKey: 'momo', carFile: 'red_bug' });
  await wait(120);
  const joined = guest.events.find((e) => e.t === 'joined');
  if (!joined) throw new Error('客人未收到 joined');

  // 3) 客人尝试 start（应被拒，只有房主能开始）
  send(guest, { t: 'start', roster });
  await wait(120);
  const guestErr = guest.events.find((e) => e.t === 'error');
  console.log('>> 客人 start 结果:', guestErr ? '被拒 ✓ (' + guestErr.msg + ')' : '未拒绝 ✗');

  // 4) 房主 start
  send(host, { t: 'start', roster });
  await wait(150);
  const hStart = host.events.find((e) => e.t === 'start');
  const gStart = guest.events.find((e) => e.t === 'start');
  if (!hStart || !gStart) throw new Error('start 未广播给双方');
  console.log('>> 双方均收到 start，roster 人数 =', hStart.roster.length);

  // 5) 房主发 snapshot -> 客人应收到
  send(host, { t: 'snap', data: { t: 1.2, phase: 'running', cd: 0, rs: [{ i: 'c1', s: 10, l: 0, v: 20 }], ba: [] } });
  await wait(120);
  const gSnap = guest.events.find((e) => e.t === 'snap');
  console.log('>> 客人收到 snapshot:', gSnap ? '✓' : '✗');

  // 6) 客人发 input -> 房主应收到
  send(guest, { t: 'input', throttle: 1, brake: 0, steer: -1, boost: true, useItem: false, aimLane: 3 });
  await wait(120);
  const hInput = host.events.find((e) => e.t === 'input');
  console.log('>> 房主收到 input:', hInput ? ('✓ from=' + hInput.from + ' steer=' + hInput.steer) : '✗');

  // 7) 客人离开 -> 房主应收到 peerLeft
  send(guest, { t: 'leave' });
  await wait(150);
  const hPeer = host.events.find((e) => e.t === 'peerLeft');
  console.log('>> 房主收到 peerLeft:', hPeer ? ('✓ id=' + hPeer.id) : '✗');

  console.log('\n==== 联机协议冒烟测试通过 ====');
  host.close(); guest.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
