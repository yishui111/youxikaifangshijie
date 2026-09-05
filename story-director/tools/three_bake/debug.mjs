import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import fs from 'node:fs';

globalThis.self ??= globalThis;
globalThis.window ??= globalThis;

const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loadGLTF = (buffer) => new Promise((res, rej) => {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  loader.register((p) => new VRMAnimationLoaderPlugin(p));
  loader.parse(buffer, '', res, rej);
});

const vrmBuf = fs.readFileSync('stripped/角色1.vrm');
const gltf = await loadGLTF(toAB(vrmBuf));
const vrm = gltf.userData.vrm;
const hb = vrm.humanoid.humanBones;
for (const [name, bone] of Object.entries(hb)) bone.node.name = name.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());

const vrmaBuf = fs.readFileSync('../../actions/avatar_hello.vrma');
const agltf = await loadGLTF(toAB(vrmaBuf));
const anim = agltf.userData.vrmAnimations[0];
console.log('VRMAnimation.humanoidTracks.rotation 数量:', anim.humanoidTracks.rotation.size);
console.log('VRMAnimation.duration:', anim.duration);
const clip = createVRMAnimationClip(anim, vrm);
console.log('clip.tracks 数量:', clip.tracks.length);
for (const t of clip.tracks.slice(0, 3)) {
  console.log('轨道:', t.name, '| 关键帧数:', t.times.length, '| t=0.5处值:', t.values.slice(60, 64).map(v => +v.toFixed(3)));
}
// 测试 mixer 驱动
const mixer = new THREE.AnimationMixer(vrm.scene);
const action = mixer.clipAction(clip);
action.play();
const armNode = hb.rightUpperArm.node;
const before = armNode.quaternion.clone();
mixer.setTime(0.5);
console.log('右臂 mixer驱动后 local Q:', armNode.quaternion.toArray().map(v => +v.toFixed(4)), '| 驱动前:', before.toArray().map(v => +v.toFixed(4)));
process.exit(0);
