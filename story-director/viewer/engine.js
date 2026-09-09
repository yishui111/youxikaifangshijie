import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const $ = (s) => document.querySelector(s);
const statusEl = () => document.querySelector('#status');
const setStatus = (t) => { const el = statusEl(); if (el) el.textContent = t; };

// ---------- 常量 ----------
const FPS = 30;
const ALIAS = {
  '挥手':'avatar_hello','打招呼':'avatar_hello','鞠躬':'avatar_bow','拍手':'avatar_clap','鼓掌':'avatar_clap',
  '跳':'avatar_jump','后空翻':'avatar_backflip','走':'avatar_walk','走路':'avatar_walk','跑步':'avatar_run',
  '跳舞':'avatar_dance1','跳舞1':'avatar_dance1','跳舞2':'avatar_dance2','跳舞3':'avatar_dance3',
  '坐下':'avatar_sit_ground','坐':'avatar_sit_ground','睡觉':'avatar_sleep','睡':'avatar_sleep',
  '开心':'avatar_express_laugh','笑':'avatar_express_laugh','大笑':'avatar_express_laugh','难过':'avatar_express_sad',
  '生气':'avatar_express_anger','惊讶':'avatar_express_surprise','吃惊':'avatar_express_surprise',
  '害羞':'avatar_express_embarrased','担忧':'avatar_express_worry','眨眼':'avatar_express_wink',
  '耸肩':'avatar_express_shrug','敬礼':'avatar_salute','点头':'avatar_yes_head','摇头':'avatar_no_head',
  '指我':'avatar_point_me','指你':'avatar_point_you','伸懒腰':'avatar_stretch','加油':'avatar_fist_pump',
  '喝水':'avatar_drink','飞吻':'avatar_blowkiss','吹口哨':'avatar_whistle','告别':'avatar_away',
  '说话':'avatar_talk','打字':'avatar_type','思考':'avatar_type','站立':'avatar_stand',
};
const resolveAnim = (n) => ALIAS[n] || (n.startsWith('avatar_') || n.startsWith('cmu_') || n === 'idle_loop' ? n : 'avatar_' + n);
const LOOP_NAMES = new Set(['idle_loop','avatar_walk','avatar_run','avatar_slowwalk','avatar_stride',
  'avatar_stand','avatar_talk','avatar_crouchwalk','avatar_uphillwalk','avatar_fly','avatar_flyslow',
  'avatar_hover','avatar_smoke_idle','avatar_motorcycle_sit','avatar_sit','avatar_sleep',
  'avatar_yoga_float','avatar_surf','avatar_away','走路','跑步']);

const ENV_PRESETS = {
  '白天': { sky: 0x87a8d0, sunC: 0xffffff, sunI: 1.6, sunP: [2, 4, 3] },
  '黄昏': { sky: 0xf0a167, sunC: 0xff8c4d, sunI: 2.2, sunP: [-4, 1.5, 3] },
  '夜晚': { sky: 0x0a0e1a, sunC: 0x8ca6ff, sunI: 0.5, sunP: [-3, 4, -2] },
  '黎明': { sky: 0xe8b08c, sunC: 0xffb88c, sunI: 1.8, sunP: [5, 2, -3] },
};

// ---------- 舞台 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8d0);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
camera.position.set(0, 1.5, 4.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const stageEl = document.querySelector('#stage');
stageEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
sunLight.position.set(2, 4, 3);
sunLight.castShadow = true;
scene.add(sunLight);
scene.add(new THREE.DirectionalLight(0x8899ff, 0.3));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 48),
  new THREE.MeshStandardMaterial({ color: 0x5d7a4a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

window.addEventListener('resize', () => {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ---------- 加载器 ----------
const draco = new DRACOLoader();
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);
gltfLoader.register((p) => new VRMLoaderPlugin(p));
gltfLoader.register((p) => new VRMAnimationLoaderPlugin(p));

const loadGLTF = (url) => new Promise((res, rej) =>
  gltfLoader.load(url, res, undefined, (e) => rej(new Error(e.message || 'load fail'))));

const clipCache = {};
async function getClip(modelFile, animName, vrm) {
  const key = modelFile + '/' + animName;
  if (clipCache[key]) return clipCache[key];
  const agltf = await loadVRMA('/actions/' + encodeURIComponent(animName) + '.vrma');
  if (!agltf) return null;
  const clip = createVRMAnimationClip(agltf.anim, vrm);
  clipCache[key] = clip;
  return clip;
}

async function loadVRMA(path) {
  const buf = await (await fetch(path)).arrayBuffer();
  const gltf = await new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej));
  const anim = gltf.userData.vrmAnimations[0];
  if (!anim) return null;
  return anim;
}

// ---------- VRM 演员 ----------
const actors = {};

async function importActor(name, modelFile) {
  if (actors[name]) return actors[name];
  setStatus('导入演员 ' + name + ' …');
  const gltf = await loadGLTF('/models/' + encodeURIComponent(modelFile));
  const vrm = gltf.userData.vrm;
  const proxy = new VRMLookAtQuaternionProxy();
  proxy.name = 'VRMLookAtQuaternionProxy_' + name;
  gltf.scene.add(proxy);
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  gltf.scene.name = '演员_' + name;
  scene.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actor = { 名字: name, obj: gltf.scene, vrm, mixer, action: null, actionName: '', actionEnd: 0, voiceUntil: 0 };
  actors[name] = actor;
  playAction(actor, 'idle_loop', true);
  return actor;
}

function playAction(actor, animName, loop, holdSec) {
  return getClip(actor, animName).then(clip => {
    if (!clip) { if (animName !== 'idle_loop') playAction(actor, 'idle_loop', true); return; }
    if (actor.action) actor.action.stop();
    actor.action = actor.mixer.clipAction(clip);
    actor.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    actor.action.clampWhenFinished = !loop;
    actor.action.reset().play();
    actor.actionName = animName;
    actor.actionEnd = R.clock + (loop ? (holdSec || 3) : clip.duration);
  }).catch(() => setStatus('⚠ 动作加载失败: ' + animName));
}

// ---------- 导出 API ----------
export { scene, camera, renderer, controls, actors, importActor, playAction, getClip,
         setStatus, loadSceneGLB, applyEnvPreset, playVoiceFile, playBGM, stopBGM,
         R };
export function setGroundVisible(v) { ground.visible = v; }
export function getGround() { return ground; }
export function getSun() { return sunLight; }
