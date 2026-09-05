class_name VrmActor
extends Node3D
## VRM 二次元角色演员。
##
## 职责：
##  1. 实例化 .vrm 模型（godot-vrm 插件导入后的场景）
##  2. 加载 .vrma 动作，用"静止姿态重定向"把动捕骨架的动作搬到模型骨架上
##     （公式：目标局部旋转 = 目标父骨动画世界Q⁻¹ × 目标父骨静止世界Q ×
##             静止修正M × 源父骨静止世界Q⁻¹ × 源骨动画世界Q）
##  3. 提供与 DemoActor 相同的接口（play_anim / move_to / face_towards /
##     play_voice），导演无需关心演员是几何小人还是 VRM 模型
##
## 性能设计：动作库懒加载——启动时只扫文件名建索引，剧本真正用到的
## 动作在 warm_up()/首次播放时才解析（单个文件几十毫秒）。

const VrmaLoaderScript := preload("res://scripts/vrma_loader.gd")

const LOOP_NAMES := ["idle_loop", "avatar_walk", "avatar_run", "avatar_slowwalk",
	"avatar_stride", "avatar_stand", "avatar_talk", "avatar_crouchwalk",
	"avatar_uphillwalk", "avatar_fly", "avatar_flyslow", "avatar_hover",
	"avatar_smoke_idle", "avatar_motorcycle_sit", "avatar_sit", "avatar_sleep",
	"avatar_yoga_float", "avatar_surf", "avatar_away", "idle", "walk", "run"]

const BAKED_DIR := "res://actions_baked"   # three-vrm 烘焙的模型专属动作（精确重定向）

var _model_stem := ""

var display_name := "演员"
var current_action := ""
var voice_playing := false

var _model_root: Node3D
var _skeleton: Skeleton3D
var _action_paths := {}      # 动作名 -> 文件路径（索引）
var _actions := {}           # 动作名 -> 解析后的 clip（缓存）
var _bone_by_lower := {}     # 骨骼名小写 -> 骨骼 idx
var _idle_name := "idle_loop"
var _action_time := 0.0
var _action_loop := false

# ---- 重定向常量（setup / 首次播放时计算）----
var _fix := Quaternion.IDENTITY        # 骨架空间 -> 世界的旋转
var _fix_inv := Quaternion.IDENTITY
var _chain_cache := {}       # 动作名 -> 重定向链
var _hips_bone := -1
var _hips_rest_pos := Vector3.ZERO
var _rest_pose := {}         # bone_idx -> 模型静止局部旋转

var _voice: AudioStreamPlayer
var _move_tween: Tween

# ---- 口型同步 ----
var _mouth_meshes := []      # [{mesh: MeshInstance3D, idx: int}] 张嘴 morph
var _mouth_was := false
const WALK_BASE_SPEED := 1.35  # avatar_walk 动作的原始步速（米/秒）
var _gait_scale := 1.0         # 走路播放倍速（让脚步匹配位移速度）


func _ready() -> void:
	_voice = AudioStreamPlayer.new()
	add_child(_voice)
	_voice.finished.connect(func() -> void:
		voice_playing = false
		if current_action == "avatar_talk":
			play_anim(_idle_name, true))


func setup_model(model_path: String, actions_dir: String) -> bool:
	var scene := load(model_path)
	if scene == null:
		push_error("VrmActor: 模型加载失败 " + model_path)
		return false
	_model_root = scene.instantiate()
	add_child(_model_root)
	_skeleton = _find_skeleton(_model_root)
	if _skeleton == null:
		push_error("VrmActor: 场景里找不到 Skeleton3D " + model_path)
		return false

	for i in _skeleton.get_bone_count():
		_bone_by_lower[_skeleton.get_bone_name(i).to_lower()] = i
		_rest_pose[i] = _skeleton.get_bone_pose_rotation(i)

	# 骨架相对角色根的旋转（用局部变换链推导，不依赖场景树状态）
	var xf := Transform3D()
	var n: Node = _skeleton
	while n != null and n != _model_root:
		xf = (n as Node3D).transform * xf
		n = n.get_parent()
	_fix = xf.basis.get_rotation_quaternion()
	_fix_inv = _fix.inverse()

	# 髋部骨骼（导入后人形骨骼名即标准人形名，J_Bip 旧命名做回退）
	var hips_idx := _find_humanoid_bone("hips")
	if hips_idx >= 0:
		_hips_bone = hips_idx
		_hips_rest_pos = _skeleton.get_bone_global_rest(_hips_bone).origin

	_model_stem = model_path.get_file().get_basename()

	# 动作库索引（懒加载）
	var dir := DirAccess.open(actions_dir)
	if dir:
		for f in dir.get_files():
			if f.to_lower().ends_with(".vrma"):
				_action_paths[f.get_basename()] = actions_dir.path_join(f)
	print("演员[%s] 动作库索引完成: %d 个动作" % [display_name, _action_paths.size()])

	if not _action_paths.has(_idle_name):
		# 没有 idle_loop 就随便找一个能循环的
		for cand in LOOP_NAMES:
			if _action_paths.has(cand):
				_idle_name = cand
				break
	# 开机即待机，避免 T-pose 罚站
	play_anim(_idle_name, true)
	_find_mouth_shapes()
	return true


## 预解析剧本会用到的动作（避免演出中途卡顿）
func warm_up(names: Array) -> void:
	for n in names:
		_get_clip(String(n))


func _get_clip(aname: String) -> Dictionary:
	if _actions.has(aname):
		return _actions[aname]
	# 优先级 1：three-vrm 官方重定向器烘焙的模型专属动作（精确）
	var baked_path := "%s/%s/%s.json" % [BAKED_DIR, _model_stem, aname]
	if FileAccess.file_exists(baked_path):
		var baked := _load_baked(baked_path)
		if not baked.is_empty():
			_actions[aname] = baked
			return baked
	# 优先级 2：VRMA 近似重定向（回退通道）
	if not _action_paths.has(aname):
		return {}
	var clip: Dictionary = VrmaLoaderScript.load_vrma(_action_paths[aname])
	if clip.is_empty():
		_action_paths.erase(aname)  # 文件里没有动画数据，别再试
		return {}
	var src_global := {}
	_compute_src_global(clip, _fix_inv, src_global)
	clip["src_global_rest"] = src_global
	_actions[aname] = clip
	_build_chain(clip)
	return clip


## 解析 three-vrm 烘焙的 JSON → 内部 clip 结构。
## three-vrm 的重定向输出是 three.js 节点本地旋转，而 godot-vrm 导入时
## 改写了骨骼的静止朝向（实测 RightUpperArm 被转了 180°），所以烘焙数据
## 不能直接当骨骼姿态用——这里带上 three.js 侧的骨架静止层级（_meta.json），
## 在 Godot 里再做一次"静止姿态差"换算（复用 VRMA 路径的同一套数学）。
var _baked_meta := {}   # model_stem -> three.js 骨架静止层级

func _get_baked_meta() -> Dictionary:
	if _baked_meta.has(_model_stem):
		return _baked_meta[_model_stem]
	var meta := {}
	var mp := "%s/%s/_meta.json" % [BAKED_DIR, _model_stem]
	if FileAccess.file_exists(mp):
		var txt := FileAccess.get_file_as_string(mp)
		var data = JSON.parse_string(txt)
		if typeof(data) == TYPE_DICTIONARY:
			meta = data
	_baked_meta[_model_stem] = meta
	return meta


func _load_baked(path: String) -> Dictionary:
	var txt := FileAccess.get_file_as_string(path)
	if txt.is_empty():
		return {}
	var data = JSON.parse_string(txt)
	if typeof(data) != TYPE_DICTIONARY or not data.has("tracks"):
		return {}
	var n := int(data.get("times", []).size())
	if n < 2:
		return {}
	var fps := maxf(float(data.get("fps", 30)), 1.0)
	var meta := _get_baked_meta()
	if meta.is_empty():
		return {}
	var times := PackedFloat32Array()
	times.resize(n)
	for i in n:
		times[i] = i / fps

	# three.js 侧骨架的静止层级
	var parent := {}
	var rest_q := {}
	var rest_g := {}
	for node_name in meta:
		parent[node_name] = meta[node_name]["parent"]
		var rq: Array = meta[node_name]["rest_q"]
		rest_q[node_name] = Quaternion(float(rq[0]), float(rq[1]), float(rq[2]), float(rq[3]))
		var gq: Array = meta[node_name]["rest_gq"]
		rest_g[node_name] = Quaternion(float(gq[0]), float(gq[1]), float(gq[2]), float(gq[3]))
	# 拓扑序（父先子后）
	var order: Array = []
	var visited := {}
	var stack: Array = []
	for node_name in meta:
		stack.clear()
		var cur: String = node_name
		while true:
			if visited.has(cur):
				break
			visited[cur] = true
			stack.append(cur)
			if parent.has(cur):
				cur = parent[cur]
			else:
				break
		while not stack.is_empty():
			order.append(stack.pop_back())

	# 动画轨道（键 = 源节点名，局部旋转共轭到骨架空间）
	var tracks := {}
	for bone_name in data["tracks"]:
		var arr: Array = data["tracks"][bone_name]
		var quats: Array[Quaternion] = []
		quats.resize(n)
		for i in n:
			var q := Quaternion(float(arr[i * 4]), float(arr[i * 4 + 1]), float(arr[i * 4 + 2]), float(arr[i * 4 + 3]))
			quats[i] = (_fix_inv * q * _fix_inv.inverse()).normalized()
		tracks[String(bone_name)] = {"times": times, "quats": quats}

	# 髋部增量（three-vrm 输出模型本地坐标，减首帧得到起伏）
	var hips_track := {}
	var hips: Dictionary = data.get("hips", {})
	if hips.has("track") and _hips_bone >= 0:
		var tr: Array = hips["track"]
		var f0: Array = hips.get("frame0", [tr[0], tr[1], tr[2]])
		var vecs := PackedVector3Array()
		vecs.resize(n)
		for i in n:
			vecs[i] = Vector3(float(tr[i * 3]) - float(f0[0]), float(tr[i * 3 + 1]) - float(f0[1]), float(tr[i * 3 + 2]) - float(f0[2]))
		hips_track = {"times": times, "vecs": vecs}

	# 换算链：按 Godot 骨骼深度排序（父先子后），预计算静止修正 M
	var b_tracks: Array = []
	var entries: Array = []
	for bone_name in data["tracks"]:
		var hum := String(bone_name).to_lower()
		var bi := _find_humanoid_bone(hum)
		if bi < 0:
			continue
		entries.append({"node": String(bone_name), "bi": bi, "depth": _bone_depth(bi)})
	entries.sort_custom(func(a, b): return int(a["depth"]) < int(b["depth"]))
	for e in entries:
		var node: String = e["node"]
		var bi: int = e["bi"]
		var p_bi := _skeleton.get_bone_parent(bi)
		var Rt: Quaternion = _skeleton.get_bone_global_rest(bi).basis.get_rotation_quaternion()
		var RtP: Quaternion = (Quaternion.IDENTITY if p_bi < 0
			else _skeleton.get_bone_global_rest(p_bi).basis.get_rotation_quaternion())
		var pname: String = parent.get(node, "__ROOT__")
		var Rs: Quaternion = rest_g.get(node, Quaternion.IDENTITY)
		var RsP: Quaternion = (Quaternion.IDENTITY if pname == "__ROOT__" else rest_g.get(pname, Quaternion.IDENTITY))
		# 共轭到骨架空间
		Rs = (_fix_inv * Rs * _fix_inv.inverse()).normalized()
		RsP = (_fix_inv * RsP * _fix_inv.inverse()).normalized()
		var M: Quaternion = (RtP.inverse() * Rt) * (RsP.inverse() * Rs).inverse()
		var rq: Array = meta[node]["rest_q"]
		var rest_l := (_fix_inv * Quaternion(float(rq[0]), float(rq[1]), float(rq[2]), float(rq[3])) * _fix_inv.inverse()).normalized()
		b_tracks.append({
			"bi": bi, "p_bi": p_bi, "node": node,
			"RsP": RsP, "RtP": RtP, "M": M, "rest_l": rest_l,
			"anim": tracks.get(node, {}),
			"p_humanoid": tracks.has(pname),
			"p_node": pname,
		})
	if b_tracks.is_empty():
		return {}
	b_tracks.sort_custom(func(a, b): return _bone_depth(int(a["bi"])) < _bone_depth(int(b["bi"])))
	return {
		"baked": true,
		"duration": float(data.get("duration", (n - 1) / fps)),
		"times": times,
		"b_tracks": b_tracks,
		"hips": hips_track,
	}


func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node
	for c in node.get_children():
		var r := _find_skeleton(c)
		if r != null:
			return r
	return null


## 找张嘴 morph（VRoid 命名 Fcl_MTH_A；VRM0 旧命名 aa）
func _find_mouth_shapes() -> void:
	_mouth_meshes.clear()
	var stack: Array[Node] = [_model_root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			var mi := n as MeshInstance3D
			var cnt: int = mi.mesh.get_blend_shape_count()
			for i in cnt:
				var bn: String = String(mi.mesh.get_blend_shape_name(i)).to_lower()
				if bn == "aa" or bn.ends_with("mth_a"):
					_mouth_meshes.append({"mesh": mi, "idx": i})
		for c in n.get_children():
			stack.append(c)


## 源（动捕）骨架各节点"全局静止旋转"，并共轭变换到模型骨架空间
func _compute_src_global(clip: Dictionary, fix_inv: Quaternion, out: Dictionary) -> void:
	var rest_q: Dictionary = clip["rest_q"]
	var parent: Dictionary = clip["parent"]
	for n in clip["order"]:
		var local: Quaternion = rest_q[n]
		var p := int(parent.get(n, -1))
		var g: Quaternion = local if p < 0 else out[p] * local
		out[n] = fix_inv * g * fix_inv.inverse()


## 预计算某动作的重定向链（父先子后）
func _build_chain(clip: Dictionary) -> void:
	var humanoid: Dictionary = clip["humanoid"]
	var src_rest_global: Dictionary = clip["src_global_rest"]
	var parent: Dictionary = clip["parent"]
	var chain: Array = []
	var entries: Array = []
	for hum in humanoid:
		var bone_idx := _find_humanoid_bone(String(hum))
		if bone_idx < 0:
			continue
		entries.append({"hum": hum, "bone": bone_idx,
			"node": int(humanoid[hum]), "depth": _bone_depth(bone_idx)})
	entries.sort_custom(func(a, b): return int(a["depth"]) < int(b["depth"]))

	for e in entries:
		var bone_idx: int = e["bone"]
		var node_idx: int = e["node"]
		var p_node := int(parent.get(node_idx, -1))
		var p_bone := _skeleton.get_bone_parent(bone_idx)
		var Rt: Quaternion = _skeleton.get_bone_global_rest(bone_idx).basis.get_rotation_quaternion()
		var RtP: Quaternion = (Quaternion.IDENTITY if p_bone < 0
			else _skeleton.get_bone_global_rest(p_bone).basis.get_rotation_quaternion())
		var Rs: Quaternion = src_rest_global[node_idx]
		var RsP: Quaternion = (Quaternion.IDENTITY if p_node < 0 else src_rest_global[p_node])
		# 静止修正 M = 目标父骨静止Q⁻¹×目标骨静止Q × (源父骨静止Q⁻¹×源骨静止Q)⁻¹
		var M: Quaternion = (RtP.inverse() * Rt) * (RsP.inverse() * Rs).inverse()
		chain.append({"bone": bone_idx, "p_bone": p_bone, "node": node_idx,
			"p_node": p_node, "RtP": RtP, "M": M})
	clip["chain"] = chain


func _bone_depth(i: int) -> int:
	var d := 0
	while i >= 0:
		i = _skeleton.get_bone_parent(i)
		d += 1
	return d


## 标准人形名 -> 骨骼 idx（插件通常把人形骨直接命名为 Hips/LeftUpperArm 等；
## 老版本命名 J_Bip_L_UpperArm 走前缀回退）
func _find_humanoid_bone(hum: String) -> int:
	var h := hum.to_lower()
	if _bone_by_lower.has(h):
		return _bone_by_lower[h]
	if h.begins_with("left") and _bone_by_lower.has("j_bip_l_" + h.substr(4)):
		return _bone_by_lower["j_bip_l_" + h.substr(4)]
	if h.begins_with("right") and _bone_by_lower.has("j_bip_r_" + h.substr(5)):
		return _bone_by_lower["j_bip_r_" + h.substr(5)]
	if _bone_by_lower.has("j_bip_c_" + h):
		return _bone_by_lower["j_bip_c_" + h]
	return -1


# ---------- 演员接口（与 DemoActor 一致）----------

func play_anim(aname: String, loop: bool = false) -> void:
	var clip := _get_clip(aname)
	if clip.is_empty():
		if aname != _idle_name:
			play_anim(_idle_name, true)
		return
	current_action = aname
	_action_time = 0.0
	_action_loop = loop or (aname in LOOP_NAMES)
	if aname != "avatar_walk":
		_gait_scale = 1.0


func move_to(target: Vector3, duration: float) -> void:
	face_towards(target)
	if _move_tween and _move_tween.is_valid():
		_move_tween.kill()
	var gait := "avatar_walk"
	if _get_clip(gait).is_empty():
		gait = _idle_name
	else:
		play_anim("avatar_walk", true)
		# 脚步与位移匹配：走得快就放大步频，走得慢就放慢
		var dist := global_position.distance_to(target)
		_gait_scale = clampf((dist / maxf(duration, 0.05)) / WALK_BASE_SPEED, 0.55, 2.5)
	_move_tween = create_tween()
	_move_tween.tween_property(self, "global_position", target, maxf(duration, 0.05))
	_move_tween.tween_callback(func() -> void:
		if not voice_playing:
			play_anim(_idle_name, true))


func face_towards(point: Vector3) -> void:
	var d := point - global_position
	d.y = 0.0
	if d.length() > 0.01:
		rotation.y = atan2(d.x, d.z)


func play_voice(path: String) -> void:
	var stream := load(path)
	if stream == null:
		push_warning("找不到语音文件: " + path)
		return
	_voice.stream = stream
	_voice.play()
	voice_playing = true
	# 说话时如果闲着，就边说边比划
	if (current_action == _idle_name or current_action == "") \
			and not _get_clip("avatar_talk").is_empty():
		play_anim("avatar_talk", true)


func stop_voice() -> void:
	_voice.stop()
	voice_playing = false


# ---------- 每帧重定向 ----------

func _process(delta: float) -> void:
	if _skeleton == null or current_action == "":
		return
	var clip := _get_clip(current_action)
	if clip.is_empty():
		return
	var dur: float = maxf(float(clip["duration"]), 0.05)
	var adv := delta * (_gait_scale if current_action == "avatar_walk" else 1.0)
	if _action_loop:
		_action_time = fmod(_action_time + adv, dur)
	else:
		_action_time = minf(_action_time + adv, dur)
		if _action_time >= dur and current_action != _idle_name:
			play_anim(_idle_name, true)
			return
	var t := _action_time

	if clip.get("baked", false):
		# ---- 烘焙路径：three-vrm 官方重定向 + 静止姿态差换算 ----
		var tgt_global := {}
		var Ws := {}   # 源节点动画全局旋转（骨架空间）
		for tr in clip["b_tracks"]:
			var node: String = tr["node"]
			var l3: Quaternion
			var anim: Dictionary = tr["anim"]
			if anim.is_empty():
				l3 = tr["rest_l"]   # 无动画的节点保持静止姿态
			else:
				l3 = VrmaLoaderScript.sample_quat(anim, t)
			var Wg: Quaternion
			if bool(tr.get("p_humanoid", false)):
				Wg = Ws[tr["p_node"]] * l3   # 父骨是人形链上的动画骨
			else:
				Wg = tr["RsP"] * l3          # 父骨是静态节点（如 Armature）
			Ws[node] = Wg
			var delta_q: Quaternion = (tr["RsP"] as Quaternion).inverse() * Wg
			var WtP: Quaternion = (tgt_global.get(int(tr["p_bi"]), tr["RtP"]) as Quaternion) if int(tr["p_bi"]) >= 0 else Quaternion.IDENTITY
			var l_t: Quaternion = (WtP.inverse() * (tr["RtP"] as Quaternion) * ((tr["M"] as Quaternion) * delta_q)).normalized()
			tgt_global[int(tr["bi"])] = WtP * l_t
			_skeleton.set_bone_pose_rotation(int(tr["bi"]), l_t)
		var hips_track: Dictionary = clip.get("hips", {})
		if _hips_bone >= 0 and not hips_track.is_empty():
			var d: Vector3 = VrmaLoaderScript.sample_vec(hips_track, t)
			if d.length() > 0.6:
				d = Vector3(0.0, clampf(d.y, -0.4, 0.4), 0.0)
			_skeleton.set_bone_pose_position(_hips_bone, _hips_rest_pos + _fix_inv * d)
	else:
		# ---- VRMA 回退路径：动捕骨架 → 模型骨架的近似重定向 ----
		var tracks: Dictionary = clip["tracks"]
		var src_anim := {}
		var parent: Dictionary = clip["parent"]
		var rest_q: Dictionary = clip["rest_q"]

		# 1) 源骨架正向运动学（骨架空间）
		for n in clip["order"]:
			var l: Quaternion
			if tracks.has(n):
				l = VrmaLoaderScript.sample_quat(tracks[n], t)
			else:
				l = rest_q[n]
			var p := int(parent.get(n, -1))
			src_anim[n] = l if p < 0 else src_anim[p] * l

		# 2) 髋部位移
		var hips_track: Dictionary = clip["hips"]
		if _hips_bone >= 0 and not hips_track.is_empty():
			var pos: Vector3 = VrmaLoaderScript.sample_vec(hips_track, t)
			var node_idx: int = int(hips_track["node"])
			var rt: Vector3 = clip["rest_t"][node_idx]
			var hips_delta: Vector3 = pos - rt
			# 有些 .vrma 的髋部轨迹是动捕绝对坐标（带根运动），直接当偏移用会把
			# 角色"甩"出十几米。位移超过阈值时丢弃水平分量，只保留垂直起伏。
			if hips_delta.length() > 0.6:
				hips_delta = Vector3(0.0, clampf(hips_delta.y, -0.4, 0.4), 0.0)
			_skeleton.set_bone_pose_position(_hips_bone, _hips_rest_pos + _fix_inv * hips_delta)

		# 3) 逐骨骼重定向（链已按深度排序，父先子后）
		var src_global: Dictionary = clip["src_global_rest"]
		var tgt_global := {}
		for c in clip["chain"]:
			var bone: int = c["bone"]
			var p_bone: int = c["p_bone"]
			var Ws: Quaternion = src_anim[int(c["node"])]
			var p_node := int(c["p_node"])
			var RsP: Quaternion = (Quaternion.IDENTITY if p_node < 0 else src_global[p_node])
			var delta_q: Quaternion = RsP.inverse() * Ws
			# 父骨不在人形链里（如 Root_）时没被动画驱动，用它的静止全局姿态
			var WtP: Quaternion = (tgt_global.get(p_bone, c["RtP"]) as Quaternion) if p_bone >= 0 else Quaternion.IDENTITY
			var l_t: Quaternion = (WtP.inverse() * (c["RtP"] as Quaternion) * ((c["M"] as Quaternion) * delta_q)).normalized()
			tgt_global[bone] = WtP * l_t
			_skeleton.set_bone_pose_rotation(bone, l_t)

	# 4) 口型同步：说话时用张嘴 morph 模拟音节开合
	if _mouth_meshes.is_empty():
		return
	var open := 0.0
	if voice_playing:
		var tt := Time.get_ticks_msec() / 1000.0
		open = clampf(0.2 + 0.8 * absf(sin(tt * 11.0)) * (0.55 + 0.45 * sin(tt * 2.9)), 0.0, 1.0)
		_mouth_was = true
	elif _mouth_was:
		_mouth_was = false
	else:
		return
	for m in _mouth_meshes:
		(m["mesh"] as MeshInstance3D).set_blend_shape_value(int(m["idx"]), open)


func reset_pose() -> void:
	if _skeleton == null:
		return
	for i in _rest_pose:
		_skeleton.set_bone_pose_rotation(i, _rest_pose[i])
	if _hips_bone >= 0:
		_skeleton.set_bone_pose_position(_hips_bone, _hips_rest_pos)
