import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8d0);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.4, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(2, 4, 3);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 32),
  new THREE.MeshStandardMaterial({ color: 0x5d7a4a })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 加载 VRM 模型
const info = document.createElement('div');
info.style.cssText = 'position:fixed;top:10px;left:10px;color:#fff;font-family:monospace;font-size:14px;text-shadow:1px 1px 2px black;z-index:10';
document.body.appendChild(info);
const log = (msg) => { info.textContent = msg; console.log(msg); };

log('加载模型…');
const vrmGltf = await new Promise((res, rej) =>
  gltfLoader.load('/models/角色1.vrm', res, undefined, rej));
const vrm = vrmGltf.userData.vrm;
scene.add(vrm.scene);
log('模型加载完成');

// 加载 VRMA 动作
log('加载动作…');
const vrmaBuf = await (await fetch('/actions/avatar_hello.vrma')).arrayBuffer();
const vrmaGltf = await new Promise((res, rej) =>
  vrmaLoader.parse(vrmaBuf, '', res, rej));
const vrmAnim = vrmaGltf.userData.vrmAnimations[0];
log('动作时长: ' + vrmAnim.duration.toFixed(2) + 's');

// 创建 AnimationClip
const clip = createVRMAnimationClip(vrmAnim, vrm);
const mixer = new THREE.AnimationMixer(vrm.scene);
const action = mixer.clipAction(clip);
action.play();
log('播放中: ' + clip.duration.toFixed(2) + 's');

// 渲染循环
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  mixer.update(dt);
  vrm.update(dt);
  controls.update();
  renderer.render(scene, camera);
});
log('运行中: 挥手动作循环播放');
