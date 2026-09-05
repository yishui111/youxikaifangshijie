# -*- coding: utf-8 -*-
"""
Blender 版"故事导演"：读取 story 剧本（与 Godot 版同一格式），
用 VRM 官方插件的 .vrma 自动融合能力搭建并渲染整部短片。

用法：
  blender.exe --background --python blender_director.py -- \
      <story.json> <输出目录> [起始秒 渲染秒数]

职责划分：
  模型 + 动作的融合  → VRM 插件自动完成（不再手写换算）
  时间轴/镜头/字幕    → 本脚本按剧本排布
"""

import bpy
import json
import math
import os
import sys
import addon_utils

argv = sys.argv[sys.argv.index("--") + 1:]
story_path = argv[0]
out_dir = argv[1]
start_sec = float(argv[2]) if len(argv) > 3 else 0.0
render_sec = float(argv[3]) if len(argv) > 3 else -1.0

FPS = 30
HERE = os.path.dirname(os.path.abspath(__file__))
story = json.load(open(story_path, encoding="utf-8"))
MODELS_DIR = os.path.join(os.path.dirname(story_path), "models")
ACTIONS_DIR = os.path.join(os.path.dirname(story_path), "actions")
VOICE_DIR = os.path.dirname(story_path)

story["cameras"] = story.get("cameras", {})
TOTAL_END = max(
    [e.get("t", 0.0) for e in story.get("timeline", [])] + [10.0])

bpy.ops.wm.read_factory_settings(use_empty=True)

# 启用 VRM 插件（必须在恢复出厂设置之后，否则会被重置掉）
for mod_id in ("bl_ext.user_default.vrm", "io_scene_vrm"):
    try:
        addon_utils.enable(mod_id, default_set=True, persistent=True)
        break
    except Exception:
        continue

scene = bpy.context.scene
scene.render.fps = FPS

# ---------- 工具 ----------

def gd_v3(a):
    """剧本坐标(Godot: x右 y上 z前) → Blender(x右 z前 y上)"""
    return (float(a[0]), float(a[2]), float(a[1]))


def look_euler(pos, look):
    d = (look[0] - pos[0], look[1] - pos[1], look[2] - pos[2])
    length = math.sqrt(sum(c * c for c in d))
    if length < 1e-6:
        return (0, 0, 0)
    d = tuple(c / length for c in d)
    # Blender 相机沿 -Z 看、Y 朝上：由方向向量反解 XYZ 欧拉角
    rot_x = math.acos(max(-1.0, min(1.0, -d[2])))
    rot_z = math.atan2(-d[0], d[1])
    return (rot_x, 0, rot_z)


def key_linear(fcurve):
    for kp in fcurve.keyframe_points:
        kp.interpolation = "LINEAR"


def set_at(obj, attr, frame, value):
    setattr(obj, attr, value)
    obj.keyframe_insert(attr, frame=frame)


# ---------- 舞台 ----------

bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
ground = bpy.context.object
gm = bpy.data.materials.new("地面")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.5, 0.3, 1)
ground.data.materials.append(gm)

bpy.ops.object.light_add(type="SUN", location=(4, -3, 8))
sun = bpy.context.object
sun.data.energy = 3.0

world = bpy.data.worlds.new("世界")
scene.world = world
world.use_nodes = False
world.color = (0.55, 0.7, 0.9)

# 几块道具石头
for pos, size in [((-6, -5, 0.6), (2, 2, 1.2)), ((7, -3, 0.9), (1.4, 1.4, 1.8)),
                  ((-8, 4, 0.5), (1.8, 1.8, 1.0)), ((6, 7, 0.4), (1.2, 1.2, 0.8))]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(pos[0], pos[1], pos[2] / 2))
    rock = bpy.context.object
    rock.scale = (size[0], size[1], size[2])
    rm = bpy.data.materials.new("石头")
    rm.use_nodes = True
    rm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.42, 0.4, 1)
    rock.data.materials.append(rm)

# ---------- 导入演员与动作 ----------

print("== 导入模型与动作 ==")
actors = {}
anim_actions = {}   # 动作名 -> Action 数据块（三模型骨骼同名，可共用）

model_import_op = bpy.ops.import_scene.vrm
for aid, cfg in story["actors"].items():
    model_path = cfg.get("model", "")
    if model_path and not os.path.isabs(model_path):
        model_path = os.path.join(os.path.dirname(story_path), model_path)
    if not model_path and os.path.exists(os.path.join(MODELS_DIR, aid + ".vrm")):
        model_path = os.path.join(MODELS_DIR, aid + ".vrm")
    if model_path:
        before = set(o.name for o in bpy.data.objects)
        bpy.ops.import_scene.vrm(filepath=model_path)
        new_names = [o.name for o in bpy.data.objects if o.name not in before]
        new_objs = [bpy.data.objects[n] for n in new_names]
        print("导入对象:", new_names)
        arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
        roots = [o for o in new_objs if o.parent is None or o.parent.name not in new_names]
        actor_obj = (roots[0] if roots else arm)
        actor_obj.rotation_euler = (0, 0, math.pi)   # VRM 默认背对镜头，转正
        print("演员根对象:", actor_obj.name if actor_obj else "无", "| 骨架:", arm.name if arm else "无")
        actor_obj.location = gd_v3(cfg.get("start", [0, 0, 0]))
        actor_obj.name = "演员_" + aid
    else:
        # 几何小人兜底
        bpy.ops.mesh.primitive_capsule_add(radius=0.32, depth=1.15, location=(0, 0, 0.9))
        actor_obj = bpy.context.object
        actor_obj.name = "演员_" + aid
    actors[aid] = actor_obj
    print("演员就位:", aid, actor_obj.name)

# 动作导入：一次导入即生成 Action（骨骼名相同 → 三个模型共用）
def get_action(anim_name):
    if anim_name in anim_actions:
        return anim_actions[anim_name]
    p = os.path.join(ACTIONS_DIR, anim_name + ".vrma")
    if not os.path.exists(p):
        return None
    before_actions = set(a.name for a in bpy.data.actions)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    before_act = {o.name: (o.animation_data.action.name if o.animation_data and o.animation_data.action else None) for o in arms}
    try:
        bpy.ops.import_scene.vrma(filepath=p)
    except Exception as e:
        print("VRMA 导入失败:", anim_name, e)
        return None
    # VRMA 导入会把动作赋给"当前激活的 VRM 骨架"，用新增 Action 数据块来定位
    act = None
    new_actions = [a for a in bpy.data.actions if a.name not in before_actions]
    if new_actions:
        act = new_actions[-1]
    else:
        for o in arms:
            if o.animation_data and o.animation_data.action:
                if before_act.get(o.name) != o.animation_data.action.name:
                    act = o.animation_data.action
                    break
    if act is None:
        print("VRMA 未产生动作:", anim_name)
        return None
    act.name = anim_name
    act.use_frame_range = False
    # 解除骨架占用（Action 数据块已留存，NLA 排布时再引用）
    for o in arms:
        if o.animation_data and o.animation_data.action:
            o.animation_data.action = None
    anim_actions[anim_name] = act
    print("动作导入:", anim_name)
    return act

# 预导入剧本用到的动作 + 待机/走路/说话
used = set()
for e in story["timeline"]:
    if e.get("type") == "anim":
        used.add(e.get("anim"))
for a in ("idle_loop", "avatar_walk", "avatar_talk"):
    used.add(a)
for a in sorted(used):
    get_action(a)
print("动作库就绪:", len(anim_actions), "个")

# ---------- 时间轴排布 ----------

# NLA：基础待机轨 + 动作事件轨
def setup_nla(aid):
    arm = actors[aid]
    if not arm.animation_data:
        arm.animation_data_create()
    ad = arm.animation_data
    ad.action = None
    idle = anim_actions.get("idle_loop")
    if idle is None:
        return
    tr = ad.nla_tracks.new()
    tr.name = "待机"
    fr0 = 1
    clip_len = (idle.frame_range[1] - idle.frame_range[0])
    repeats = max(1, int((TOTAL_END * FPS + 60) / max(clip_len, 1)) + 1)
    strip = tr.strips.new("待机", fr0, idle)
    strip.repeat = repeats
    strip.extrapolation = "HOLD_FORWARD"

setup_nla_list = list(actors.keys())
for aid in setup_nla_list:
    setup_nla(aid)

# 动作事件 → 高优先级 NLA 轨（每演员一条）
nla_by_actor = {}
for aid in actors:
    arm = actors[aid]
    tr = arm.animation_data.nla_tracks.new()
    tr.name = "动作"
    nla_by_actor[aid] = tr

for e in story["timeline"]:
    if e.get("type") != "anim":
        continue
    aid = e.get("actor")
    act = anim_actions.get(e.get("anim"))
    if act is None or aid not in actors:
        continue
    arm = actors[aid]
    tr = nla_by_actor[aid]
    fr = max(1, int(e["t"] * FPS))
    dur_frames = max(2, int((act.frame_range[1] - act.frame_range[0])))
    if bool(e.get("loop")):
        dur_frames = int(float(e.get("hold", 3.0)) * FPS)
    strip = tr.strips.new(e.get("anim", "动作")[:40], fr, act)
    strip.action_frame_start = int(act.frame_range[0])
    strip.action_frame_end = int(act.frame_range[0]) + dur_frames
    strip.extrapolation = "HOLD_FORWARD"

# ---------- 移动/转身/定位（对象位置关键帧） ----------

def actor_move(e):
    aid = e["actor"]
    if aid not in actors:
        return
    obj = actors[aid]
    to = gd_v3(e["to"])
    t0 = int(e["t"] * FPS)
    t1 = int((e["t"] + e.get("duration", 1.0)) * FPS)
    cur = tuple(obj.location)
    obj.location = cur
    obj.keyframe_insert("location", frame=t0)
    obj.location = to
    obj.keyframe_insert("location", frame=max(t1, t0 + 1))
    for fc in obj.animation_data.action.fcurves:
        if fc.data_path == "location":
            key_linear(fc)


for e in story["timeline"]:
    ty = e.get("type")
    if ty == "move":
        actor_move(e)
    elif ty == "place":
        aid = e.get("actor")
        if aid in actors:
            actors[aid].location = gd_v3(e["to"])
            actors[aid].keyframe_insert("location", frame=int(e["t"] * FPS))
    elif ty == "face":
        aid = e.get("actor")
        if aid in actors:
            obj = actors[aid]
            p = gd_v3(e["to"])
            d = (p[0] - obj.location.x, p[1] - obj.location.y)
            obj.rotation_euler = (0, 0, math.atan2(d[1], d[0]) - math.pi / 2)
            obj.keyframe_insert("rotation_euler", frame=int(e["t"] * FPS))

# ---------- 镜头 ----------

cam_data = bpy.data.cameras.new("主相机")
cam_obj = bpy.data.objects.new("主相机", cam_data)
bpy.context.collection.objects.link(cam_obj)
scene.camera = cam_obj

def cam_pose(pos, look):
    p = gd_v3(pos)
    l = gd_v3(look)
    return (p, look_euler(p, l))

camera_keys = []   # (frame, pose)
prev_pose = None
for e in story["timeline"]:
    ty = e.get("type")
    if ty == "camera":
        cameras = story.get("cameras", {})
        if e.get("name") and e["name"] in cameras:
            c = cameras[e["name"]]
            pose = cam_pose(c["pos"], c["look"])
        elif "pos" in e:
            pose = cam_pose(e["pos"], e["look"])
        else:
            continue
        trans = max(int(float(e.get("transition", 0)) * FPS), 1)
        t = max(1, int(e["t"] * FPS))
        if prev_pose is not None and trans > 1:
            camera_keys.append((t, prev_pose))
        camera_keys.append((t + trans, pose))
        prev_pose = pose
    elif ty == "orbit":
        look = gd_v3(e.get("look", [0, 1, 0]))
        radius = float(e.get("radius", 8))
        height = float(e.get("height", 2))
        f0 = float(e.get("from_deg", 0))
        f1 = float(e.get("to_deg", 360))
        dur = max(float(e.get("duration", 8)), 0.2)
        t = int(e["t"] * FPS)
        steps = max(int(dur * FPS / 4), 2)
        if prev_pose is not None:
            camera_keys.append((t, prev_pose))
        for k in range(steps + 1):
            kk = k / steps
            deg = math.radians(f0 + (f1 - f0) * kk)
            pos = (look[0] + math.sin(deg) * radius, look[1] + math.cos(deg) * radius, look[2] + height)
            camera_keys.append((t + int(kk * dur * FPS), (pos, look_euler(pos, look))))
        prev_pose = camera_keys[-1][1]

last_frame = 1
for fr, pose in sorted(camera_keys, key=lambda k: k[0]):
    if fr <= last_frame:
        continue
    last_frame = fr
    cam_obj.location = pose[0]
    cam_obj.rotation_euler = pose[1]
    cam_obj.keyframe_insert("location", frame=fr)
    cam_obj.keyframe_insert("rotation_euler", frame=fr)
for fc in cam_obj.animation_data.action.fcurves:
    key_linear(fc)

# ---------- 环境光照关键帧 ----------

PRESETS = {
    "day":    dict(sun_rot=(0.5, 0.15, 0.4), sun_e=3.0, sun_c=(1, 1, 1), w=(0.55, 0.7, 0.9)),
    "sunset": dict(sun_rot=(1.35, 0, -1.05), sun_e=2.6, sun_c=(1.0, 0.55, 0.3), w=(0.95, 0.55, 0.35)),
    "night":  dict(sun_rot=(1.2, 0, 2.1), sun_e=0.7, sun_c=(0.55, 0.65, 1.0), w=(0.05, 0.06, 0.13)),
    "dawn":   dict(sun_rot=(1.45, 0, -1.75), sun_e=2.0, sun_c=(1.0, 0.72, 0.5), w=(0.85, 0.62, 0.55)),
}
env_keys = []
for e in story["timeline"]:
    if e.get("type") == "environment":
        p = dict(PRESETS.get(e.get("preset", "day"), PRESETS["day"]))
        if "sun_deg" in e:
            s = e["sun_deg"]
            p["sun_rot"] = (math.radians(s[0]), math.radians(s[1]), 0)
        if "sun_color" in e:
            c = e["sun_color"]
            p["sun_c"] = (c[0], c[1], c[2])
        if "sun_energy" in e:
            p["sun_e"] = float(e["sun_energy"])
        if "sky_top" in e:
            c = e["sky_top"]
            p["w"] = (c[0], c[1], c[2])
        env_keys.append((int(e["t"] * FPS), p))

sun.rotation_euler = PRESETS["day"]["sun_rot"]
sun.data.color = PRESETS["day"]["sun_c"]
sun.data.energy = PRESETS["day"]["sun_e"]
world.color = PRESETS["day"]["w"]
for fr, p in env_keys:
    sun.rotation_euler = p["sun_rot"]
    sun.keyframe_insert("rotation_euler", frame=fr)
    sun.data.color = p["sun_c"]
    sun.data.keyframe_insert("color", frame=fr)
    sun.data.keyframe_insert("energy", frame=fr)
    world.color = p["w"]
    world.keyframe_insert("color", frame=fr)

# ---------- 剪辑台：语音 + 字幕 + 背景音乐 ----------

scene.sequence_editor_create()
se = scene.sequence_editor
try:
    seq_new_sound = se.sequences.new_sound
    seq_new_effect = se.sequences.new_effect
except AttributeError:
    seq_new_sound = se.strips.new_sound
    seq_new_effect = se.strips.new_effect

font = None
for fp in ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf"):
    if os.path.exists(fp):
        font = bpy.data.fonts.load(fp)
        break

def add_voice(e):
    fr = int(e["t"] * FPS)
    file_path = e.get("file", "")
    if file_path:
        wav = os.path.join(VOICE_DIR, file_path)
        if os.path.exists(wav):
            try:
                seq_new_sound("voice_" + str(fr), wav, 1, fr)
            except Exception as ex:
                print("语音轨添加失败:", wav, ex)
    text = e.get("subtitle", "")
    if text:
        disp = story["actors"].get(e.get("actor", ""), {}).get("display", e.get("actor", ""))
        _add_text(disp + "：" + text, fr, int((e["t"] + e.get("duration", 4.5)) * FPS))

def _add_text(text, fr0, fr1):
    try:
        s = seq_new_effect("字幕" + str(fr0), 'TEXT', 3, fr0, fr1)
    except Exception as ex:
        print("字幕添加失败:", ex)
        return
    s.text = text
    if font:
        s.font = font
    s.font_size = 26
    s.location = (0.5, 0.1)
    s.align = "CENTER"
    s.use_shadow = True

def add_subtitle(e):
    _add_text(e.get("text", ""), int(e["t"] * FPS),
              int((e["t"] + e.get("duration", 4.0)) * FPS))

for e in story["timeline"]:
    ty = e.get("type")
    if ty == "voice":
        add_voice(e)
    elif ty == "subtitle":
        add_subtitle(e)
    elif ty == "bgm":
        bgm_path = os.path.join(VOICE_DIR, e.get("file", "audio/bgm.wav"))
        if os.path.exists(bgm_path) and not e.get("stop"):
            try:
                seq_new_sound("bgm", bgm_path, 0, 1)
            except Exception as ex:
                print("bgm 添加失败:", ex)

# ---------- 渲染设置 ----------

scene.frame_start = 1
end_sec = TOTAL_END + 2.0
if render_sec > 0:
    scene.frame_start = max(1, int(start_sec * FPS))
    scene.frame_end = int((start_sec + render_sec) * FPS)
else:
    if start_sec > 0:
        scene.frame_start = max(1, int(start_sec * FPS))
    scene.frame_end = int(end_sec * FPS)
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = eng
        break
    except Exception:
        continue
if len(argv) > 4 and argv[4] == "png":
    scene.render.image_settings.file_format = "PNG"
else:
    scene.render.image_settings.file_format = "FFMPEG"
scene.render.ffmpeg.format = "MPEG4"
scene.render.ffmpeg.codec = "H264"
scene.render.ffmpeg.audio_codec = "AAC"
try:
    scene.render.use_audio = True
except AttributeError:
    pass
scene.render.filepath = os.path.join(out_dir, "movie_")
print(f"渲染范围: 帧 {scene.frame_start} ~ {scene.frame_end} (约 {(scene.frame_end - scene.frame_start) / FPS:.0f} 秒)")
print("渲染引擎:", scene.render.engine)

bpy.ops.render.render(animation=True)
print("Blender 渲染完成")
