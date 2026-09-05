// 共享舞台模块：所有模块页面复用的 three.js + three-vrm 舞台
// 用法：
//   import { createStage, loadModel, playAnim, loadTestStory } from './common.js';
//   const stage = await createStage('#stage');
//   await stage.loadModel('角色1.vrm');
//   await stage.playAnim('avatar_hello', true);

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

export async function createStage(containerSel = '#stage', opts = {}) {
  const container = document.querySelector(containerSel);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.sky ?? 0x87a8d0);

  const camera = new THREE.PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.35, 3.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.95, 0);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x5d7a4a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  });

  // 加载器
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  loader.register((p) => new VRMAnimationLoaderPlugin(p));
  const loadGLTF = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  // 状态
  const state = {
    vrm: null, modelFile: null,
    mixer: null, action: null,
    speed: 1, loop: true,
    onStatus: () => {},
  };

  async function loadModel(file) {
    state.onStatus(`加载模型 ${file} …`);
    if (state.vrm) {
      scene.remove(state.vrm.scene);
      VRMUtils.deepDispose(state.vrm.scene);
      state.vrm = null; state.action = null;
      if (state.mixer) state.mixer.stopAllAction();
    }
    const gltf = await loadGLTF('/models/' + encodeURIComponent(file));
    state.vrm = gltf.userData.vrm;
    // 预创建视线代理，消除 VRMA 播放时的警告
    const lookProxy = new VRMLookAtQuaternionProxy();
    lookProxy.name = 'VRMLookAtQuaternionProxy';
    gltf.scene.add(lookProxy);
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(gltf.scene);
    state.mixer = new THREE.AnimationMixer(state.vrm.scene);
    state.modelFile = file;
    state.onStatus('模型就绪: ' + file);
  }

  const animCache = {};   // 动作名 -> clip
  async function playAnim(name, loop = state.loop) {
    if (!state.vrm) { state.onStatus('请先加载模型'); return null; }
    let clip = animCache[name + '_' + state.modelFile];
    if (!clip) {
      state.onStatus('加载动作 ' + name + ' …');
      const agltf = await loadGLTF('/actions/' + encodeURIComponent(name) + '.vrma');
      const anim = agltf.userData.vrmAnimations[0];
      if (!anim) { state.onStatus('该文件没有动画: ' + name); return null; }
      clip = createVRMAnimationClip(anim, state.vrm);
      animCache[name + '_' + state.modelFile] = clip;
    }
    if (state.action) state.action.stop();
    state.action = state.mixer.clipAction(clip);
    state.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    state.action.clampWhenFinished = true;
    state.action.reset().play();
    state.onStatus('播放: ' + name);
    return state.action;
  }

  function setCamera(pos, target) {
    if (pos) camera.position.set(...pos);
    if (target) controls.target.set(...target);
    controls.update();
  }

  // 主循环（带冻结开关，供截图）
  const clock = 'Timer' in THREE ? new THREE.Timer() : new THREE.Clock();
  const tickDelta = () => { if ('Timer' in THREE) clock.update(); return clock.getDelta(); };
  renderer.setAnimationLoop(() => {
    if (window.__frozen) return;
    const d = tickDelta();
    if (state.mixer) state.mixer.update(d * state.speed);
    if (state.vrm) state.vrm.update(d);
    controls.update();
    renderer.render(scene, camera);
  });

  window.__view = { renderer, scene, camera, controls };
  window.__stageState = state;

  return {
    renderer, scene, camera, controls, state,
    loadModel, playAnim, setCamera,
    loadGLTF,
  };
}

// 测试剧本（模块 2/5 用）
export const TEST_STORY = {
  title: "测试剧本 · 模块联调",
  duration: 22,
  events: [
    { t: 0.5,  type: "subtitle", text: "模块2测试：剧本时间轴驱动动作" },
    { t: 1.0,  type: "anim", anim: "avatar_hello", hold: 2.5 },
    { t: 4.0,  type: "anim", anim: "avatar_clap", hold: 2.5 },
    { t: 4.0,  type: "subtitle", text: "时间轴按秒触发：拍手" },
    { t: 7.0,  type: "anim", anim: "avatar_walk", loop: true, hold: 4.0 },
    { t: 7.0,  type: "subtitle", text: "走路循环 4 秒" },
    { t: 11.5, type: "anim", anim: "avatar_dance1", hold: 6.0 },
    { t: 11.5, type: "subtitle", text: "舞蹈 6 秒（大幅动作）" },
    { t: 18.0, type: "anim", anim: "avatar_bow", hold: 2.2 },
    { t: 18.0, type: "subtitle", text: "鞠躬收尾" },
  ],
};
