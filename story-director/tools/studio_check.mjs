
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const $ = (s) => document.querySelector(s);
const FPS = 30;
const PX = 36;   // 每秒像素

// ---------- 动作别名（中文 → 库动作） ----------
const ALIAS = {
  '挥手':'avatar_hello','打招呼':'avatar_hello','鞠躬':'avatar_bow','拍手':'avatar_clap','鼓掌':'avatar_clap',
  '跳':'avatar_jump','跳跃':'avatar_jump','后空翻':'avatar_backflip','走':'avatar_walk','走路':'avatar_walk',
  '跑步':'avatar_run','跑':'avatar_run','跳舞':'avatar_dance1','跳舞1':'avatar_dance1','跳舞2':'avatar_dance2',
  '跳舞3':'avatar_dance3','坐下':'avatar_sit_ground','坐':'avatar_sit_ground','睡觉':'avatar_sleep','睡':'avatar_sleep',
  '开心':'avatar_express_laugh','笑':'avatar_express_laugh','大笑':'avatar_express_laugh','难过':'avatar_express_sad',
  '生气':'avatar_express_anger','惊讶':'avatar_express_surprise','吃惊':'avatar_express_surprise',
  '害羞':'avatar_express_embarrased','担忧':'avatar_express_worry','眨眼':'avatar_express_wink',
  '耸肩':'avatar_express_shrug','敬礼':'avatar_salute','点头':'avatar_yes_head','摇头':'avatar_no_head',
  '指我':'avatar_point_me','指你':'avatar_point_you','伸懒腰':'avatar_stretch','加油':'avatar_fist_pump',
  '喝水':'avatar_drink','飞吻':'avatar_blowkiss','吹口哨':'avatar_whistle','告别':'avatar_away',
  '说话':'avatar_talk','打字':'avatar_type','思考':'avatar_type','站立':'avatar_stand',
  '踢腿':'avatar_kick_roundhouse_R','出拳':'avatar_punch_R','跪下':'avatar_kneel_left',
};
const resolveAnim = (n) => ALIAS[n] || (n.startsWith('avatar_') || n.startsWith('cmu_') || n === 'idle_loop' ? n : 'avatar_' + n);
const ANIM_LIST = ['挥手','鞠躬','拍手','跳','后空翻','走','跑步','跳舞','跳舞2','跳舞3','坐下','睡觉','开心','大笑','难过','生气','惊讶','害羞','担忧','眨眼','耸肩','敬礼','点头','摇头','指我','指你','伸懒腰','加油','喝水','飞吻','吹口哨','告别','说话','打字','站立','idle_loop'];

// ---------- 舞台 ----------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8d0);

const camera = new THREE.PerspectiveCamera(35, stage.clientWidth / stage.clientHeight, 0.1, 200);
camera.position.set(0, 1.5, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(new THREE.DirectionalLight(0x8899ff, 0.3));

const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 48),
  new THREE.MeshStandardMaterial({ color: 0x5d7a4a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

window.addEventListener('resize', () => {
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
});

const draco = new DRACOLoader();
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.register((p) => new VRMLoaderPlugin(p));
loader.register((p) => new VRMAnimationLoaderPlugin(p));
const loadGLTF = (url) => new Promise((res, rej) => loader.load(url, res, undefined,
  (e) => rej(new Error(e.message || '加载失败'))));

// ---------- 数据模型（中文键，AI 可直接填写） ----------
let story = {
  标题: '我的短片',
  时长: 40,
  演员: [
    { 名字: '风', 模型: '角色1.vrm', 初始位置: [0, 0, 0] },
    { 名字: '雪', 模型: '角色2.vrm', 初始位置: [2.2, 0, -1] },
    { 名字: '夜', 模型: '角色3.vrm', 初始位置: [-2.2, 0, -2] },
  ],
  事件: [],
};

// ---------- 引擎运行时 ----------
const R = { actors: {}, clock: 0, playing: false, paused: false, ended: false,
            evIdx: 0, moves: [], camLerp: null, orbit: null, envLerp: null,
            rec: null, chunks: [] };
let sceneGroup = null;
const SUB = { el: null, until: 0 };

const clipCache = {};
async function getClip(actor, animName) {
  const key = actor.模型 + '/' + animName;
  if (clipCache[key]) return clipCache[key];
  const agltf = await loadGLTF('/actions/' + encodeURIComponent(animName) + '.vrma');
  const anim = agltf.userData.vrmAnimations[0];
  if (!anim) return null;
  const clip = createVRMAnimationClip(anim, actor.vrm);
  clipCache[key] = clip;
  return clip;
}

// ---------- 排期表（时间段 JSON）→ 运行事件 编译器 ----------
const LOOP_SET = new Set(['走路','走','跑步','跑','跳舞','跳舞1','跳舞2','跳舞3','坐下','坐','睡觉','睡',
  '说话','打字','思考','站立','俯卧撑','吸烟','瑜伽','漂浮','缓慢走','上坡走','告别','待机','蹲走',
  'avatar_walk','avatar_run','avatar_slowwalk','avatar_stride','avatar_stand','avatar_talk',
  'avatar_crouchwalk','avatar_uphillwalk','avatar_fly','avatar_flyslow','avatar_hover',
  'avatar_smoke_idle','avatar_motorcycle_sit','avatar_sit','avatar_sleep','avatar_yoga_float',
  'avatar_surf','avatar_away','idle_loop']);

function compileSchedule(data) {
  const events = [];
  const actorDefs = [];
  let lastEnd = 0;

  // 演员：{名: {模型, 位置:[x,z], 语速}} 或 {名: '文件.vrm'}
  const defs = data['演员'] || {};
  const names = Object.keys(defs);
  names.forEach((名, i) => {
    const v = defs[名];
    const def = typeof v === 'string'
      ? { 名字: 名, 模型: v, 初始位置: [-2.5 + i * 2.5, 0, 0] }
      : { 名字: 名, 模型: String(v['模型'] || ''), 初始位置: (v['位置'] ? [v['位置'][0], 0, v['位置'][1]] : [-2.5 + i * 2.5, 0, 0]), 语速: v['语速'] ?? 0 };
    actorDefs.push(def);
  });

  // 场景（全局）
  if (data['场景']) events.push({ 时间: 0, 类型: '场景', 文件: data['场景'] });

  // 片段 → 事件
  for (const seg of data['片段'] || []) {
    const tt = seg['时间'] || [0, 5];
    const t0 = +tt[0], t1 = +tt[1];
    lastEnd = Math.max(lastEnd, t1);
    if (seg['光照']) events.push({ 时间: t0, 类型: '环境', 天气: seg['光照'] });
    if (seg['场景文件']) events.push({ 时间: t0, 类型: '场景', 文件: seg['场景文件'] });
    if (seg['背景音乐']) events.push({ 时间: t0, 类型: '背景音乐', 文件: seg['背景音乐'] });
    const cam = seg['镜头'];
    if (cam) {
      if (String(cam['类型'] || cam) === '环绕') {
        events.push({ 时间: t0, 类型: '镜头', 机位: '环绕', 持续秒: Math.min(+(cam['持续'] || (t1 - t0)), t1 - t0) });
      } else {
        events.push({ 时间: t0, 类型: '镜头', 机位: String(cam['类型'] || cam), 对准: cam['对准'] || null, 过渡秒: 0.6 });
      }
    }
    if (seg['字幕']) events.push({ 时间: t0, 类型: '字幕', 文本: seg['字幕'], 持续秒: Math.min(t1 - t0, 6) });
    const roles = seg['角色'] || {};
    for (const 名 in roles) {
      const r = roles[名] || {};
      if (r['动作']) events.push({ 时间: t0, 类型: '动作', 角色: 名, 动画: r['动作'], 循环: LOOP_SET.has(r['动作']) || !!r['循环'], 持续秒: t1 - t0 });
      if (r['走向']) events.push({ 时间: t0, 类型: '移动', 角色: 名, 到: [r['走向'][0], 0, r['走向'][1]], 持续秒: +(r['移动秒'] || (t1 - t0)) });
      if (r['台词']) events.push({ 时间: t0, 类型: '对话', 角色: 名, 台词: r['台词'], 持续秒: Math.max(2.5, r['台词'].length * 0.22), 语速: def语速(actorDefs, 名) });
    }
  }
  events.push({ 时间: lastEnd + 0.3, 类型: '结束' });
  events.sort((a, b) => a['时间'] - b['时间']);
  return { actorDefs, events, total: lastEnd + 1 };
}
function def语速(defs, 名) {
  const d = defs.find(x => x['名字'] === 名);
  return d && d['语速'] != null ? d['语速'] : 0;
}

async function importActor(a) {
  status('导入演员 ' + a.名字 + ' …');
  const gltf = await loadGLTF('/models/' + encodeURIComponent(a.模型));
  const vrm = gltf.userData.vrm;
  const proxy = new VRMLookAtQuaternionProxy();
  proxy.name = 'VRMLookAtQuaternionProxy_' + a.名字 + '_' + Math.random().toString(36).slice(2, 5);
  gltf.scene.add(proxy);
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const st = a.初始位置 || [0, 0, 0];
  gltf.scene.position.set(st[0], st[2], st[1]);
  gltf.scene.rotation.y = Math.PI;
  gltf.scene.name = '演员_' + a.名字;
  scene.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actor = { a, obj: gltf.scene, vrm, mixer, action: null, actionName: 'idle_loop', actionEnd: 0, voiceUntil: 0 };
  R.actors[a.名字] = actor;
  playAction(actor, 'idle_loop', true, 1e9);
  renderActorList();
  return actor;
}

function playAction(actor, animName, loop, holdSec) {
  return getClip(actor, animName).then(clip => {
    if (!clip) { status('⚠ 没找到动作: ' + animName); return; }
    if (actor.action) actor.action.stop();
    actor.action = actor.mixer.clipAction(clip);
    actor.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    actor.action.clampWhenFinished = !loop;
    actor.action.reset().play();
    actor.actionName = animName;
    const dur = Number.isFinite(clip.duration) ? clip.duration : 2;
    actor.actionEnd = R.clock + (loop ? (holdSec || 3) : dur);
  }).catch(() => status('⚠ 动作加载失败: ' + animName));
}

const audioCtx = new AudioContext();
const recDest = audioCtx.createMediaStreamDestination();
const voiceEls = {};
function wireAudio(el) {
  try {
    const src = audioCtx.createMediaElementSource(el);
    src.connect(audioCtx.destination);
    src.connect(recDest);
  } catch (e) { /* 已接线 */ }
}
let bgmEl = null;

// ---------- 事件执行 ----------
const ENV = {
  '白天': { sky: 0x87a8d0, sunC: 0xffffff, sunI: 1.6, sunP: [2, 4, 3] },
  '黄昏': { sky: 0xf0a167, sunC: 0xff8c4d, sunI: 2.2, sunP: [-4, 1.5, 3] },
  '夜晚': { sky: 0x0a0e1a, sunC: 0x8ca6ff, sunI: 0.5, sunP: [-3, 4, -2] },
  '黎明': { sky: 0xe8b08c, sunC: 0xffb88c, sunI: 1.8, sunP: [5, 2, -3] },
};
let envLerp = null;
function applyEnvEvent(e) {
  const p = ENV[e.天气] || ENV['白天'];
  envLerp = { from: { sky: scene.background.clone(), sunC: sun.color.clone(), sunI: sun.intensity, sunP: sun.position.clone() },
              to: { sky: new THREE.Color(e.天空色 != null ? +e.天空色 : p.sky),
                    sunC: new THREE.Color(e.太阳颜色 != null ? +e.太阳颜色 : p.sunC),
                    sunI: e.太阳强度 != null ? +e.太阳强度 : p.sunI,
                    sunP: new THREE.Vector3(...p.sunP) },
              t0: R.clock, dur: 1.2 };
  document.querySelectorAll('#envBtns button').forEach(b => b.classList.toggle('on', b.dataset.env === e.天气));
}
function tickEnv() {
  if (!envLerp) return;
  const k = Math.min(1, (R.clock - envLerp.t0) / envLerp.dur);
  scene.background.lerpColors(envLerp.from.sky, envLerp.to.sky, k);
  sun.color.lerpColors(envLerp.from.sunC, envLerp.to.sunC, k);
  sun.intensity = envLerp.from.sunI + (envLerp.to.sunI - envLerp.from.sunI) * k;
  sun.position.lerpVectors(envLerp.from.sunP, envLerp.to.sunP, k);
  if (k >= 1) envLerp = null;
}

function fire(e) {
  const ty = e['类型'];
  if (ty === '环境') applyEnvEvent(e);
  else if (ty === '动作') {
    const a = R.actors[e['角色']];
    if (a) playAction(a, resolveAnim(e['动作'] || 'idle_loop'), e['循环'] === true, e['持续秒'] || 3);
  } else if (ty === '对话') {
    fireDialogue(e);
  } else if (ty === '移动') {
    const a = R.actors[e['角色']];
    if (a) R.moves.push({ obj: a.obj, from: a.obj.position.clone(),
      to: new THREE.Vector3(e['到'][0], e['到'][1], e['到'][2]), t0: R.clock, t1: R.clock + (e['持续秒'] || 3) });
  } else if (ty === '镜头') {
    applyCameraEvent(e);
  } else if (ty === '字幕') {
    showSub(e['文本'] || '', e['持续秒'] || 4);
  } else if (ty === '场景') {
    loadSceneGLB(e['文件'] || '');
  } else if (ty === '背景音乐') {
    if (!bgmEl) { bgmEl = new Audio(e['文件'] || '/audio/bgm.wav'); bgmEl.loop = true; wireAudio(bgmEl); }
    bgmEl.volume = (e['音量'] != null ? +e['音量'] : 0.25);
    bgmEl.play().catch(() => {});
  } else if (ty === '结束') {
    R.ended = true;
    $('#theend').style.display = 'block';
    if (R.rec) setTimeout(() => stopRec(), 1200);
  }
}

function fireDialogue(e) {
  const text = e['台词'] || '';
  showSub((e['角色'] ? e['角色'] + '：' : '') + text, e['持续秒'] || Math.max(3, text.length * 0.24));
  // 语音：优先用语音文件，否则实时合成
  if (e['语音文件']) {
    let el = voiceEls[e['语音文件']];
    if (!el) { el = new Audio(e['语音文件']); el.preload = 'auto'; wireAudio(el); voiceEls[e['语音文件']] = el; }
    el.currentTime = 0;
    el.play().catch(() => {});
    return;
  }
  speakTTS(text, e['角色']).then(wavUrl => {
    if (!wavUrl) return;
    let el = voiceEls[wavUrl];
    if (!el) { el = new Audio(wavUrl); el.preload = 'auto'; wireAudio(el); voiceEls[wavUrl] = el; }
    el.currentTime = 0;
    el.play().catch(() => {});
  });
}

async function speakTTS(text, actorName) {
  try {
    const rate = { '风': 2, '雪': 0, '夜': -2 }[actorName] ?? 0;
    const r = await fetch('/api/tts', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rate }) });
    const d = await r.json();
    return d.file ? ('/voice/gen/' + d.file) : null;
  } catch { return null; }
}

// ---------- 镜头 ----------
function applyCameraEvent(e) {
  const kind = e['机位'];
  let pos, look;
  const a = e['对准'] ? R.actors[e['对准']] : null;
  const lookAt = a ? a.obj.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : null;
  if (kind === '环绕') {
    const look = lookAt || new THREE.Vector3(0, 0.95, 0);
    const cur = Math.atan2(camera.position.x - look.x, camera.position.z - look.z) * 180 / Math.PI;
    R.orbit = { t0: R.clock, dur: e['持续秒'] || 8, look, radius: camera.position.distanceTo(look),
                height: camera.position.y - look.y, from: cur, to: cur + (e['角度'] || 360) };
    D.camLerp = null;
    return;
  }
  const BUILTIN = {
    '全景': [[0, 4, 2], [0, 1.1, -2]], '中景': [[0, 1.8, 1], [0, 1.2, -2]],
    '特写': [[0.3, 1.5, 0.9], [0, 1.3, -1]], '远景': [[0, 5, 9], [0, 1, -3]],
  };
  if (BUILTIN[kind]) {
    pos = new THREE.Vector3(...BUILTIN[kind][0]);
    look = new THREE.Vector3(...BUILTIN[kind][1]);
    if (a) { look = a.obj.position.clone().add(new THREE.Vector3(0, 1.2, 0)); }
  } else if (e['位置']) {
    pos = new THREE.Vector3(e['位置'][0], e['位置'][2], e['位置'][1]);
    look = new THREE.Vector3(...(e['看向'] || [0, 1, 0]));
  } else return;
  D.orbit = null;
  R.camLerp = { fromP: camera.position.clone(), fromL: controls.target.clone(), toP: pos, toL: look,
                t0: R.clock, dur: Math.max(e['过渡秒'] || 0, 0.01) };
}
function tickCam() {
  if (R.orbit) {
    const o = R.orbit;
    const k = Math.min(1, (R.clock - o.t0) / o.dur);
    const deg = (o.from + (o.to - o.from) * k) * Math.PI / 180;
    camera.position.set(o.look.x + Math.sin(deg) * o.radius, o.look.y + o.height, o.look.z + Math.cos(deg) * o.radius);
    controls.target.copy(o.look);
    controls.update();
    if (k >= 1) R.orbit = null;
    return;
  }
  if (R.camLerp) {
    const k = Math.min(1, (R.clock - R.camLerp.t0) / R.camLerp.dur);
    const e2 = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(R.camLerp.fromP, R.camLerp.toP, e2);
    controls.target.lerpVectors(R.camLerp.fromL, R.camLerp.toL, e2);
    controls.update();
    if (k >= 1) R.camLerp = null;
  }
}

// ---------- 场景 GLB ----------
async function loadSceneGLB(file) {
  status('切换场景 ' + (file || '默认草原') + ' …');
  if (sceneGroup) { scene.remove(sceneGroup); disposeTree(sceneGroup); sceneGroup = null; }
  ground.visible = !file;
  if (!file) { status('已恢复默认草原'); return; }
  try {
    const gltf = await loadGLTF('/scenes/' + encodeURIComponent(file));
    sceneGroup = gltf.scene;
    const box = new THREE.Box3().setFromObject(sceneGroup);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    sceneGroup.scale.setScalar(14 / maxDim);
    const box2 = new THREE.Box3().setFromObject(sceneGroup);
    const center = box2.getCenter(new THREE.Vector3());
    sceneGroup.position.x -= center.x;
    sceneGroup.position.z -= center.z;
    sceneGroup.position.y -= box2.min.y;
    scene.add(sceneGroup);
    status('场景已切换: ' + file);
  } catch (e) {
    status('⚠ 场景加载失败: ' + e.message);
    ground.visible = true;
  }
}
function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
    }
  });
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let lastClock = 0;
renderer.setAnimationLoop(() => {
  const d = Math.min(clock.getDelta(), 0.1);
  if (R.playing && !R.paused && !R.ended) {
    R.clock += d;
    advance();
  }
  tickEnv();
  tickCam();
  for (const id in R.actors) R.actors[id].mixer.update(d);
  if (SUB.until && R.clock > SUB.until) { SUB.el.style.display = 'none'; SUB.until = 0; }
  $('#fill').style.width = Math.min(100, R.clock / (story['时长'] || 40) * 100) + '%';
  $('#clock').textContent = R.clock.toFixed(1) + 's';
  positionPlayhead();
});

function advance() {
  const evs = story['事件'] || [];
  while (R.evIdx < evs.length && +(evs[R.evIdx]['时间'] || 0) <= R.clock) {
    fire(evs[R.evIdx]);
    R.evIdx++;
  }
  for (const m of R.moves) {
    const k = Math.min(1, Math.max(0, (R.clock - m.t0) / (m.t1 - m.t0)));
    m.obj.position.lerpVectors(m.from, m.to, k);
  }
  for (const id in R.actors) {
    const a = R.actors[id];
    if (a.actionName && a.actionName !== 'idle_loop' && R.clock > a.actionEnd && R.clock > a.voiceUntil) {
      playAction(a, 'idle_loop', true, 1e9);
    }
  }
  if (SUB.until && R.clock > SUB.until) { SUB.el.style.display = 'none'; SUB.until = 0; }
}

// ---------- 跳转（拖动时间轴） ----------
function seekTo(sec) {
  R.clock = Math.max(0, sec);
  R.evIdx = 0;
  // 重置演员到初始
  for (const aDef of story['演员'] || []) {
    const a = R.actors[aDef['名字']];
    if (!a) continue;
    const st = aDef['初始位置'] || [0, 0, 0];
    a.obj.position.set(st[0], st[2], st[1]);
    a.obj.rotation.y = Math.PI;
    playAction(a, 'idle_loop', true, 1e9);
  }
  if (SUB.el) SUB.el.style.display = 'none';
  // 快进：只应用有"状态"意义的事件
  const evs = story['事件'] || [];
  for (const e of evs) {
    const t = +(e['时间'] || 0);
    if (t > R.clock) break;
    const ty = e['类型'];
    if (ty === '环境') applyEnvEvent(e);
    else if (ty === '镜头') applyCameraEvent(e);
    else if (ty === '场景') loadSceneGLB(e['文件'] || '');
    else if (ty === '移动') {
      const a = R.actors[e['角色']];
      if (a) a.obj.position.set(e['到'][0], e['到'][2], e['到'][1]);
    }
  }
  // 移动结束状态
  for (const m of R.moves) {
    if (m.t1 <= R.clock) m.obj.position.copy(m.to);
  }
  // 事件索引推进
  R.evIdx = 0;
  while (R.evIdx < evs.length && +(evs[R.evIdx]['时间'] || 0) <= R.clock) R.evIdx++;
  $('#seekSec').value = R.clock.toFixed(1);
}

// ---------- 录制 ----------
$('#recBtn').addEventListener('click', () => {
  if (R.rec) return;
  audioCtx.resume().catch(() => {});
  const canvasStream = renderer.domElement.captureStream(30);
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  R.chunks = [];
  R.rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 8_000_000 });
  R.rec.ondataavailable = (e) => { if (e.data.size) R.chunks.push(e.data); };
  R.rec.onstop = () => {
    const blob = new Blob(R.chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.className = 'dl';
    a.href = URL.createObjectURL(blob);
    a.download = 'movie.webm';
    a.textContent = '⬇ 下载 movie.webm (' + Math.round(blob.size / 1048576 * 10) / 10 + ' MB)';
    $('#downloads').appendChild(a);
    $('#rec').style.display = 'none';
    status('录制完成 ↓');
    R.rec = null;
  };
  R.rec.start();
  seekTo(0);
  $('#rec').style.display = 'block';
  if (!R.playing) $('#playBtn').click();
});

// ---------- 播放控制 ----------
$('#playBtn').addEventListener('click', () => {
  audioCtx.resume().catch(() => {});
  R.paused = false; R.ended = false;
  $('#theend').style.display = 'none';
  if (!R.playing) {
    if (R.clock >= (story['时长'] || 40)) seekTo(0);
    R.playing = true;
  }
});
$('#pauseBtn').addEventListener('click', () => { R.paused = !R.paused; });
$('#stopBtn').addEventListener('click', () => {
  R.playing = false; R.paused = false; R.ended = false;
  seekTo(0);
  $('#theend').style.display = 'none';
  status('已停止');
});
$('#seekBtn').addEventListener('click', () => seekTo(+$('#seekSec').value || 0));

// ---------- 时间轴 UI ----------
const TRACKS = [
  { key: '环境', types: ['环境'] },
  { key: '镜头', types: ['镜头'] },
  { key: '字幕', types: ['字幕'] },
];
function actorTracks() {
  return Object.keys(R.actors).map(n => ({ key: n, types: ['动作', '对话', '移动'], actor: n }));
}
function trackFor(e) {
  const ty = e['类型'];
  if (ty === '环境') return '环境';
  if (ty === '镜头') return '镜头';
  if (ty === '字幕') return '字幕';
  return e['角色'] || '其他';
}

let dur = story['时长'] || 40;
function tlWidth() { return dur * PX + 200; }

function renderTimeline() {
  $('#tlInner').style.width = tlWidth() + 'px';
  // 标尺
  const ruler = $('#ruler');
  ruler.innerHTML = '';
  ruler.style.width = tlWidth() + 'px';
  for (let s = 0; s <= dur; s++) {
    if (s % 5) continue;
    const t = document.createElement('div');
    t.className = 'tick';
    t.style.left = (s * PX) + 'px';
    t.textContent = s + 's';
    ruler.appendChild(t);
  }
  // 行
  const rows = $('#rows');
  rows.innerHTML = '';
  rows.style.width = tlWidth() + 'px';
  const tracks = [...TRACKS, ...actorTracks()];
  for (const tr of tracks) {
    const row = document.createElement('div');
    row.className = 'tlrow';
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = tr.key;
    row.appendChild(head);
    const area = document.createElement('div');
    area.className = 'area';
    area.style.width = (tlWidth() - 78) + 'px';
    area.dataset.track = tr.key;
    // 事件块
    for (const e of story['事件'] || []) {
      if (trackFor(e) !== tr.key) continue;
      const b = document.createElement('div');
      b.className = 'ev t-' + ty2cls(e['类型']);
      const t = +(e['时间'] || 0);
      b.style.left = (t * PX) + 'px';
      b.style.width = Math.max(30, blockW(e)) + 'px';
      b.textContent = evLabel(e);
      b.dataset.t = t;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); openInspector(e); });
      area.appendChild(b);
    }
    // 点空白新建
    area.addEventListener('click', (ev) => {
      if (ev.target !== area) return;
      const t = Math.max(0, Math.round(((ev.offsetX) / PX) * 10) / 10);
      newEventForTrack(tr, t);
    });
    row.appendChild(area);
    rows.appendChild(row);
  }
  // 播放头
  const ph = $('#playhead');
  ph.style.height = (28 * (tracks.length + 1) + 20) + 'px';
}
function ty2cls(ty) {
  return { '环境': 'env', '镜头': 'camera', '字幕': 'sub', '动作': 'act', '对话': 'talk', '移动': 'move' }[ty] || 'act';
}
function blockW(e) {
  const ty = e['类型'];
  if (ty === '对话' || ty === '字幕') return Math.max(30, (e['持续秒'] || 3) * PX);
  if (ty === '移动') return Math.max(30, (e['持续秒'] || 3) * PX);
  if (ty === '镜头' && e['机位'] === '环绕') return Math.max(30, (e['持续秒'] || 8) * PX);
  return 44;
}
function evLabel(e) {
  const ty = e['类型'];
  if (ty === 'anim2' || ty === '动作') return e['动作'];
  if (ty === '对话') return '💬 ' + (e['台词'] || '').slice(0, 8);
  if (ty === '字幕') return '字幕 ' + (e['文本'] || '').slice(0, 6);
  if (ty === '移动') return '移动';
  if (ty === '镜头') return '镜头 ' + (e['机位'] === '环绕' ? '环绕' : e['机位'] || '');
  if (ty === '环境') return '天气 ' + (e['天气'] || '');
  return ty;
}

// ---------- 属性面板（每个参数都是输入框） ----------
const FIELDS = {
  '环境': [
    { k: '天气', t: 'select', opts: ['白天', '黄昏', '夜晚', '黎明'] },
    { k: '天空色', t: 'color' }, { k: '太阳颜色', t: 'color' },
    { k: '太阳强度', t: 'number' }, { k: '太阳角度', t: 'number' },
  ],
  '动作': [
    { k: '角色', t: 'actor' }, { k: '动作', t: 'anim' },
    { k: '持续秒', t: 'number', hint: '留空=播完自动回待机' },
  ],
  '对话': [
    { k: '角色', t: 'actor' }, { k: '台词', t: 'textarea' },
    { k: '持续秒', t: 'number', hint: '留空=按字数自动' },
    { k: '语音文件', t: 'text', hint: '可选：voice/xxx.wav（留空=自动合成语音）' },
  ],
  '移动': [
    { k: '角色', t: 'actor' }, { k: '到X', t: 'number' }, { k: '到Z', t: 'number' },
    { k: '持续秒', t: 'number' },
  ],
  '镜头': [
    { k: '机位', t: 'select', opts: ['全景', '中景', '特写', '远景', '环绕'] },
    { k: '对准', t: 'actor' }, { k: '过渡秒', t: 'number' }, { k: '持续秒', t: 'number' },
  ],
  '字幕': [ { k: '文本', t: 'text' }, { k: '持续秒', t: 'number' } ],
  '场景': [ { k: '文件', t: 'scene' } ],
};
const TYPE_LABEL = { '环境': '环境与天气', '动作': '角色动作', '对话': '人物对话', '移动': '角色移动',
                     '镜头': '镜头', '字幕': '字幕', '场景': '场景切换' };

let inspTarget = null;   // 当前编辑的事件对象引用

function actorOptions(sel) {
  return Object.keys(R.actors).map(n => `<option ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
}
function openInspector(e) {
  inspTarget = e;
  const ty = e['类型'];
  $('#inspTitle').textContent = '事件属性 · ' + (TYPE_LABEL[ty] || ty) + ` @ ${e['时间']}s`;
  const body = $('#inspBody');
  body.innerHTML = '';
  const fields = FIELDS[ty] || [];
  for (const f of fields) {
    const wrap = document.createElement('div');
    wrap.className = 'fld';
    let input;
    const val = e[f.k] ?? '';
    if (f.t === 'actor') {
      input = `<select data-k="${f.k}">${actorOptions(val)}</select>`;
    } else if (f.t === 'anim') {
      input = `<input data-k="${f.k}" list="animList" value="${esc(val)}">
               <datalist id="animList">${ANIM_LIST.map(a => `<option>${a}</option>`).join('')}</datalist>`;
    } else if (f.t === 'select') {
      input = `<select data-k="${f.k}">${f.opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    } else if (f.t === 'color') {
      const hex = val !== '' ? '#' + (+val).toString(16).padStart(6, '0') : '#87a8d0';
      input = `<input data-k="${f.k}" type="color" value="${hex}">`;
    } else if (f.t === 'textarea') {
      input = `<textarea data-k="${f.k}">${esc(val)}</textarea>`;
    } else {
      input = `<input data-k="${f.k}" type="${f.t}" value="${esc(val)}" ${f.t === 'number' ? 'step="0.1"' : ''}>`;
    }
    wrap.innerHTML = `<label>${f.k}${f.hint ? '（' + f.hint + '）' : ''}</label>` + input;
    body.appendChild(wrap);
  }
  $('#inspBtns').style.display = 'flex';
  $('#applyBtn').onclick = () => {
    for (const inp of body.querySelectorAll('[data-k]')) {
      const k = inp.dataset.k;
      let v = inp.value;
      if (inp.type === 'number' || inp.type === 'range') v = parseFloat(v) || 0;
      if (inp.type === 'color') v = parseInt(inp.value.slice(1), 16);
      if (k === '持续秒' && v === 0) { delete inspTarget[k]; continue; }
      inspTarget[k] = v;
    }
    renderTimeline();
    status('已应用 ✓');
  };
  $('#delBtn').onclick = () => {
    const i = story['事件'].indexOf(inspTarget);
    if (i >= 0) story['事件'].splice(i, 1);
    closeInspector();
    renderTimeline();
  };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function closeInspector() {
  inspTarget = null;
  $('#inspBody').innerHTML = '<div style="font-size:12px;color:#6b7386">已关闭。</div>';
  $('#inspBtns').style.display = 'none';
  $('#inspTitle').textContent = '事件属性';
  document.querySelectorAll('.ev.sel').forEach(x => x.classList.remove('sel'));
}

// ---------- 新建事件 ----------
function newEventForTrack(tr, t) {
  let e;
  if (tr.types.includes('环境')) e = { 时间: t, 类型: '环境', 天气: '白天' };
  else if (tr.types.includes('镜头')) e = { 时间: t, 类型: '镜头', 机位: '中景' };
  else if (tr.types.includes('字幕')) e = { 时间: t, 类型: '字幕', 文本: '新字幕', 持续秒: 3 };
  else e = { 时间: t, 类型: '动作', 角色: tr.key, 动作: 'idle_loop', 持续秒: 2 };
  story['事件'].push(e);
  story['事件'].sort((a, b) => (a['时间'] || 0) - (b['时间'] || 0));
  renderTimeline();
  // 选中新块
  const blocks = [...document.querySelectorAll('.ev')].filter(b => +b.dataset.t === t);
  const mine = blocks[blocks.length - 1];
  if (mine) { document.querySelectorAll('.ev.sel').forEach(x => x.classList.remove('sel')); mine.classList.add('sel'); }
  openInspector(e);
}

// ---------- 播放头 / 跳转 ----------
function positionPlayhead() {
  $('#playhead').style.left = (78 + R.clock * PX) + 'px';
  $('#seekSec').value = R.clock.toFixed(1);
}
$('#ruler').addEventListener('click', (ev) => {
  const rect = $('#ruler').getBoundingClientRect();
  const t = Math.max(0, (ev.clientX - rect.left) / PX);
  seekTo(t);
});
$('#applyDur').addEventListener('click', () => {
  dur = Math.max(5, +$('#durInput').value || 40);
  story['时长'] = dur;
  renderTimeline();
});

// ---------- 演员管理 ----------
function renderActorList() {
  $('#actorList').innerHTML = Object.keys(R.actors).map(n => '· ' + n).join('　');
}
$('#addActorBtn').addEventListener('click', async () => {
  const name = $('#newActorName').value.trim();
  const file = $('#newActorModel').value;
  if (!name || !file) return;
  if (R.actors[name]) { status('该名字已存在'); return; }
  await importActor({ 名字: name, 模型: file, 初始位置: [0, 0, 0] });
  renderTimeline();
});
function refreshActorModels() {
  fetch('/api/list').then(r => r.json()).then(d => {
    $('#newActorModel').innerHTML = d.models.map(f => `<option>${f}</option>`).join('');
  });
}

// ---------- 场景列表 ----------
async function loadSceneList() {
  try {
    const files = await fetch('/api/scenes').then(r => r.json());
    for (const f of files) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f.replace(/\.glb$/i, '');
      $('#sceneSel').appendChild(o);
    }
    $('#sceneSel').addEventListener('change', () => {
      const e = { 类型: '场景', 文件: $('#sceneSel').value };
      story['事件'].push({ ...e, 时间: +R.clock.toFixed(1) });
      renderTimeline();
      loadSceneGLB($('#sceneSel').value);
    });
  } catch (e) { /* 忽略 */ }
}
document.querySelectorAll('#envBtns button').forEach(b => b.addEventListener('click', () => {
  const e = { 类型: '环境', 天气: b.dataset.env };
  story['事件'].push({ ...e, 时间: +R.clock.toFixed(1) });
  renderTimeline();
  applyEnvEvent(e);
}));

// ---------- 导出 / 导入 JSON ----------
$('#expBtn').addEventListener('click', () => {
  const doc = JSON.parse(JSON.stringify(story));
  doc['_给AI的说明'] = {
    '用法': '把本文件的【事件】数组按你的故事填写，其余字段保持格式。写完后在本页面"导入 JSON"即可演出。',
    '时间格式': '秒（数字），事件按时间顺序排列',
    '事件类型': {
      '环境': { '天气': '白天|黄昏|夜晚|黎明', '可选覆盖': '天空色/太阳颜色(十进制色值)/太阳强度/太阳角度' },
      '动作': { '角色': '演员名字', '动作': '动作名（见动作表，支持中文）', '持续秒': '循环类动作的持续秒数，可选' },
      '对话': { '角色': '演员名字', '台词': '要说的话（会自动合成语音+口型）', '持续秒': '可选' },
      '移动': { '角色': '演员名字', '到': '[x, z] 舞台坐标', '持续秒': '秒' },
      '镜头': { '机位': '全景|中景|特写|远景|环绕', '对准': '角色名（可选）', '过渡秒': '可选', '持续秒': '环绕时长' },
      '字幕': { '文本': '旁白文字', '持续秒': '可选' },
      '场景': { '文件': 'scenes/ 文件夹里的 .glb 文件名' },
      '背景音乐': { '文件': 'audio/ 文件夹里的音乐文件' },
      '结束': '无参数，剧本到此为止',
    },
    '动作表': Object.keys(ALIAS),
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (story['标题'] || 'story') + '.json';
  a.click();
});
$('#impFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    delete data['_给AI的说明'];
    if (!Array.isArray(data['事件'])) throw new Error('缺少 事件 数组');
    story = data;
    dur = story['时长'] || 40;
    $('#durInput').value = dur;
    // 重新导入演员（新增的模型）
    for (const a of story['演员'] || []) {
      if (!R.actors[a['名字']]) await importActor(a);
    }
    renderTimeline();
    status('JSON 导入成功：' + (story['标题'] || '') + '，' + (story['事件'] || []).length + ' 个事件。点"▶ 播放"看效果。');
  } catch (err) {
    status('⚠ 导入失败: ' + err.message);
  }
});

// ---------- 排期表编辑器 ----------
const DEFAULT_SCHEDULE = JSON.stringify({
  标题: '十秒测试',
  演员: {
    风: { 模型: '角色1.vrm', 位置: [-2.5, 0] },
    雪: { 模型: '角色2.vrm', 位置: [0, 0] },
    夜: { 模型: '角色3.vrm', 位置: [2.5, 0] },
  },
  场景: '东京街景.glb',
  片段: [
    { 时间: [0, 4], 光照: '白天',
      镜头: { 类型: '环绕', 持续: 4 },
      字幕: '开场：三位旅人相遇',
      角色: {
        风: { 动作: '挥手' },
        雪: { 动作: '点头' },
        夜: { 动作: '站立' } } },
    { 时间: [4, 7], 光照: '黄昏',
      镜头: { 类型: '特写', 对准: '风' },
      字幕: '风有话要说',
      角色: {
        风: { 动作: '说话', 台词: '我们出发吧！' },
        雪: { 动作: '鼓掌' },
        夜: { 动作: '点头' } } },
    { 时间: [7, 10], 光照: '夜晚',
      镜头: { 类型: '远景' },
      角色: {
        风: { 动作: '跳舞' },
        雪: { 动作: '跳舞2' },
        夜: { 动作: '睡觉' } } },
  ],
}, null, 2);

function spState(t) { $('#spState').textContent = t; }

async function runSchedule() {
  const text = $('#scheduleText').value;
  let data;
  try { data = JSON.parse(text); }
  catch (e) { spState('⚠ JSON 语法错误: ' + e.message); return; }
  if (!Array.isArray(data['片段'])) { spState('⚠ 缺少 片段 数组'); return; }
  spState('载入演员与动作…');
  // 导入缺失的演员
  const defs = data['演员'] || {};
  for (const 名 in defs) {
    if (R.actors[名]) continue;
    const v = defs[名];
    const cfg = typeof v === 'string'
      ? { 名字: 名, 模型: v, 初始位置: [0, 0, 0] }
      : { 名字: 名, 模型: String(v['模型'] || ''), 初始位置: (v['位置'] ? [v['位置'][0], 0, v['位置'][1]] : [0, 0, 0]) };
    await importActor(cfg);
  }
  const compiled = compileSchedule(data);
  // 预热动作（避免演出中卡顿）
  for (const seg of data['片段'] || []) {
    const roles = seg['角色'] || {};
    for (const 名 in roles) {
      const a = R.actors[名];
      if (a && roles[名]['动作']) await getClip(a, resolveAnim(roles[名]['动作']));
    }
  }
  // 应用到运行时
  story = { 标题: data['标题'] || '', 时长: compiled.total, 演员: compiled.actorDefs, 事件: compiled.events };
  dur = Math.ceil(compiled.total);
  $('#durInput').value = dur;
  R.clock = 0; R.evIdx = 0; R.moves = []; R.orbit = null; R.camLerp = null; R.envLerp = null; R.ended = false;
  $('#theend').style.display = 'none';
  renderTimeline();
  R.playing = true; R.paused = false;
  spState('演出中…');
  status('排期表演出中（' + compiled.events.length + ' 个事件，' + compiled.total.toFixed(0) + ' 秒）');
}

$('#runSched').addEventListener('click', runSchedule);
$('#fmtSched').addEventListener('click', () => {
  try {
    $('#scheduleText').value = JSON.stringify(JSON.parse($('#scheduleText').value), null, 2);
    spState('已格式化');
  } catch (e) { spState('⚠ JSON 格式错误'); }
});
$('#saveSched').addEventListener('click', async () => {
  try {
    await fetch('/api/save_script', { method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ file: 'schedule.json', text: $('#scheduleText').value }) });
    spState('已保存到 schedule.json ✓');
  } catch (e) { spState('保存失败'); }
});
(async () => {
  try {
    const d = await fetch('/api/read_script?file=schedule.json').then(r => r.json());
    if (d.text) $('#scheduleText').value = d.text;
    else $('#scheduleText').value = DEFAULT_SCHEDULE;
  } catch { $('#scheduleText').value = DEFAULT_SCHEDULE; }
})();

// ---------- 初始化 ----------
(async function init() {
  // 自动导入 models/ 全部模型
  try {
    const list = await fetch('/api/list').then(r => r.json());
    status('导入演员 …');
    for (const f of list.models) {
      const name = f.replace(/\.vrm$/i, '');
      if (!R.actors[name]) {
        const def = (story['演员'] || []).find(a => a['名字'] === name);
        await importActor(def || { 名字: name, 模型: f, 初始位置: [0, 0, 0] });
      }
    }
    // 演员 JSON 与模型对齐
    for (const a of story['演员'] || []) {
      if (!R.actors[a['名字']]) {
        const file = (a['模型'] || '').replace(/^models\//, '');
        await importActor({ ...a, 模型: file });
      }
    }
  } catch (e) { status('⚠ 演员导入失败: ' + e.message); }
  refreshActorModels();
  await loadSceneList();
  renderTimeline();
  status('就绪。点"▶ 播放"或直接在时间轴上排事件。');
})();
