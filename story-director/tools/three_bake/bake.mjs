// VRMA → 模型专属动画 烘焙工具
// 使用 pixiv 官方 three-vrm 的重定向器（VRMAnimation.createAnimationClip）
// 把每个 .vrma 动作重定向到指定 VRM 模型的骨骼上，按 30fps 采样导出 JSON。
//
// 用法：node bake.mjs <剥离纹理的.vrm> <actions目录> <输出目录> <动作清单文件>
// 输出：<输出目录>/<模型名>/<动作名>.json

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import fs from 'node:fs';
import path from 'node:path';

// Node 环境垫片（three 内部会引用 self/window）
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;

const FPS = 30;

function toAB(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function loadGLTF(buffer) {
  return new Promise((res, rej) => {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    loader.register((p) => new VRMAnimationLoaderPlugin(p));
    loader.parse(buffer, '', res, rej);
  });
}

// 人形骨骼名 → Godot 侧的 CamelCase 命名（与 godot-vrm 导入后的骨骼名一致）
const camel = (s) => s.replace(/(^|[_\s])(\w)/g, (_, __, c) => c.toUpperCase());

const [, , modelPath, actionsDir, outDir, listFile] = process.argv;
if (!modelPath) {
  console.error('用法: node bake.mjs <模型.vrm> <actions目录> <输出目录> <清单文件>');
  process.exit(1);
}
const modelStem = path.basename(modelPath, path.extname(modelPath));
const outModelDir = path.join(outDir, modelStem);
fs.mkdirSync(outModelDir, { recursive: true });

const actions = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

// ---- 加载模型 ----
const vrmBuf = fs.readFileSync(modelPath);
const modelGltf = await loadGLTF(toAB(vrmBuf));
const vrm = modelGltf.userData.vrm;
if (!vrm) { console.error('模型加载失败（无 VRM 数据）'); process.exit(1); }

// 人形骨骼节点重命名为 Godot 风格，并建索引
const humanBones = vrm.humanoid.humanBones;
const boneNodes = {};
for (const [name, bone] of Object.entries(humanBones)) {
  if (bone?.node) {
    bone.node.name = camel(name);
    boneNodes[camel(name)] = bone.node;
  }
}
console.log(`模型 ${modelStem} 加载完成, 人形骨骼 ${Object.keys(boneNodes).length} 根`);

// ---- 记录骨架静止层级（供 Godot 做"静止姿态差"换算）----
// godot-vrm 导入时会改写骨骼的静止朝向，three.js 的本地旋转与 Godot 的
// 骨骼姿态语义不同，必须按两边静止全局姿态的差做换算。
const nodesMeta = {};   // 节点名 -> {parent, rest_q:[xyzw], rest_gq:[xyzw]}
(function record(node, parentName, gParent) {
  const g = gParent.clone().multiply(node.quaternion);
  if (node !== vrm.scene) {
    nodesMeta[node.name] = {
      parent: parentName,
      rest_q: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
      rest_gq: [g.x, g.y, g.z, g.w],
    };
  }
  for (const c of node.children) {
    if (c.type === 'Mesh' || c.type === 'SkinnedMesh') continue;
    record(c, node.name === '' ? parentName : node.name, g);
  }
})(vrm.scene, '__ROOT__', new THREE.Quaternion());
fs.writeFileSync(path.join(outModelDir, '_meta.json'), JSON.stringify(nodesMeta));
console.log(`骨架静止层级: ${Object.keys(nodesMeta).length} 个节点`);

const mixer = new THREE.AnimationMixer(vrm.scene);
let baked = 0, skipped = 0;

for (const aname of actions) {
  const vrmaPath = path.join(actionsDir, aname + '.vrma');
  if (!fs.existsSync(vrmaPath)) { skipped++; continue; }
  let anim;
  try {
    const buf = fs.readFileSync(vrmaPath);
    const agltf = await loadGLTF(toAB(buf));
    anim = agltf.userData.vrmAnimations?.[0];
  } catch (e) {
    console.log(`[跳过] ${aname}: ${e.message}`);
    skipped++;
    continue;
  }
  if (!anim) { console.log(`[跳过] ${aname}: 无动画数据`); skipped++; continue; }

  // 官方重定向器：为这个模型生成已换算好的动画 Clip
  const clip = createVRMAnimationClip(anim, vrm);
  const dur = Number.isFinite(clip.duration) ? clip.duration : 0;
  if (dur <= 0.01) { console.log(`[跳过] ${aname}: 时长为 0`); skipped++; continue; }

  const action = mixer.clipAction(clip);
  action.play();
  const n = Math.max(2, Math.ceil(dur * FPS) + 1);
  const times = new Array(n);
  const tracks = {};
  for (const k of Object.keys(boneNodes)) tracks[k] = new Float64Array(n * 4);
  const hipsRest = boneNodes['Hips'] ? boneNodes['Hips'].position.clone() : null;
  const hipsTrack = hipsRest ? new Float64Array(n * 3) : null;

  for (let f = 0; f < n; f++) {
    mixer.setTime(f / FPS);
    // three-vrm v3 的 clip 驱动的是隐藏的 Normalized_ 标准化骨骼，
    // 必须调用 update 把姿态同步到真实骨骼上再采样
    vrm.update(1 / FPS);
    times[f] = +(f / FPS).toFixed(4);
    for (const k of Object.keys(boneNodes)) {
      const q = boneNodes[k].quaternion;
      tracks[k].set([+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)], f * 4);
    }
    if (hipsTrack) {
      const p = boneNodes['Hips'].position;
      hipsTrack.set([+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)], f * 3);
    }
  }
  action.stop();
  mixer.uncacheAction(clip);

  const out = {
    baked: 'three-vrm',
    duration: +dur.toFixed(4),
    fps: FPS,
    times,
    tracks: Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, Array.from(v)])),
  };
  if (hipsTrack && hipsRest) {
    out.hips = { rest: [hipsRest.x, hipsRest.y, hipsRest.z], track: Array.from(hipsTrack), frame0: Array.from(hipsTrack.slice(0, 3)) };
  }
  fs.writeFileSync(path.join(outModelDir, aname + '.json'), JSON.stringify(out));
  baked++;
}

console.log(`烘焙完成: 成功 ${baked} / 跳过 ${skipped}`);
