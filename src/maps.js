/** Three circuits with distinct geometry, scenery and driving rules. */
export const MAPS = [
  { id:'city', name:'城市工地', subtitle:'双层立交', tag:'立交 / 高架', difficulty:'★★☆', accent:'#ee883b', sky:['#1d63c4','#86c4f2','#eaf5ff'], ground:0xabb6c0, road:0xffffff, fog:0xd2e8ff, grip:1,
    description:'穿过桥底再攀上高架，跨越自己的来路，切进空中近道。', tips:'高架近道：左侧跳台 / E 越过闸门', branchName:'空中近道',
    heights:[2,2,2,3,4,2,2,2,4,7,9,13,18,20,20,15,9,5,3,7,12,14,8],
    nodes:[[62,-58],[20,-58],[-30,-58],[-72,-48],[-88,-18],[-68,12],[-28,20],[18,20],[55,43],[46,74],[10,88],[-25,79],[-46,54],[-24,27],[18,-7],[55,-26],[87,-8],[97,26],[85,63],[104,83],[128,53],[128,5],[107,-45]] },
  { id:'desert', name:'赤砂峡谷', subtitle:'断桥飞跃', tag:'跨谷 / 腾空', difficulty:'★★☆', accent:'#d46837', sky:['#8b4b53','#efb77f','#ffe5ae'], ground:0xd8a36c, road:0xd7b7a0, fog:0xf0c694, grip:1.08,
    description:'攀上跨谷大桥，提速飞越断口，再俯冲穿回桥下。', tips:'峡谷近路：跳台起飞 · 落地冲刺', branchName:'峡谷近路',
    heights:[2,2,4,10,17,24,26,24,20,16,12,9,8,5,3,3,7,13,20,24,22,14,6],
    nodes:[[68,-70],[20,-70],[-30,-65],[-82,-45],[-105,-8],[-76,25],[-33,24],[10,18],[54,27],[74,60],[42,91],[-6,96],[-45,68],[-41,32],[-6,2],[34,-20],[74,-27],[110,-1],[112,45],[140,63],[148,24],[128,-38],[101,-64]] },
  { id:'ice', name:'极光冰湾', subtitle:'盘旋冰桥', tag:'盘绕 / 升降', difficulty:'★★★', accent:'#319daf', sky:['#142c57','#487f9f','#d4f5fb'], ground:0xc9e6ec, road:0xb8e8ff, fog:0xb6dce9, grip:.78,
    description:'冰湾上空盘绕升降，连续高低交叉，飞跃空中冰桥。', tips:'冰湾近路：断口前保持车速 · 落地冲刺', branchName:'冰湾近路',
    heights:[2,2,4,10,16,22,25,25,23,20,17,13,8,4,4,7,13,28,39,42,37,26,17,13,8,4],
    nodes:[[58,-66],[15,-70],[-35,-66],[-79,-47],[-95,-12],[-71,18],[-28,23],[18,18],[55,32],[63,63],[25,87],[-17,77],[-35,48],[-11,18],[26,-7],[54,10],[47,38],[18,51],[-12,37],[-8,4],[31,-28],[77,-35],[95,-13],[111,12],[125,-22],[104,-57]] },
];
export function getMap(id) { return MAPS.find(map=>map.id===id)||MAPS[0]; }
export function rememberedMap() { try { return getMap(new URLSearchParams(location.search).get('map')||localStorage.getItem('kart-map')).id; } catch { return 'city'; } }
