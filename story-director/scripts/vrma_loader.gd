class_name VrmaLoader
extends Object
## .vrma（VRM Animation，glTF 二进制格式）解析器 + .vrm 人形骨骼映射读取。
##
## VRMA 文件里是一套"动捕原始骨架"（节点名五花八门，如 BVH 风格的
## lShldr / Hips），但文件自带的 VRMC_vrm_animation.humanoid.humanBones
## 把"标准人形骨骼名"（hips / leftUpperArm ...）映射到了动画节点。
## .vrm 文件里的 VRMC_vrm.humanoid.humanBones 则把标准人形名映射到
## 模型骨骼节点名（Godot 导入后即 Skeleton3D 的骨骼名）。
## 两边用"标准人形名"对接，即可把任意 VRMA 动作重定向到任意 VRM 模型。
##
## 用法：
##   var clip := VrmaLoader.load_vrma("res://actions/avatar_hello.vrma")
##   var bone_map := VrmaLoader.load_vrm_bones("res://models/角色1.vrm")
## 返回的都是 Dictionary，结构见各函数注释。

const JSON_CHUNK_TYPE := 0x4E4F534A   # "JSON"（little-endian）
const BIN_CHUNK_TYPE := 0x004E4942    # "BIN\0"（little-endian）


## 读取 glb（glTF 二进制）的两个 chunk：JSON 与 BIN
static func _read_glb(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("VrmaLoader: 打不开文件 " + path)
		return {}
	var magic := f.get_32()
	if magic != 0x46546C67:
		push_error("VrmaLoader: 不是 glTF 文件 " + path)
		return {}
	f.get_32()  # version
	f.get_32()  # total length
	var json := {}
	var bin := PackedByteArray()
	while f.get_position() < f.get_length():
		var clen := f.get_32()
		var ctype := f.get_32()
		if ctype == JSON_CHUNK_TYPE:
			json = JSON.parse_string(f.get_buffer(clen).get_string_from_utf8())
		elif ctype == BIN_CHUNK_TYPE:
			bin = f.get_buffer(clen)
		else:
			f.seek(f.get_position() + clen)
	return {"json": json, "bin": bin}


## 按 glTF accessor 定义从 BIN 里取 float 数组
static func _read_accessor(json: Dictionary, bin: PackedByteArray, acc_idx: int) -> PackedFloat32Array:
	var acc: Dictionary = json["accessors"][acc_idx]
	var bv: Dictionary = json["bufferViews"][acc["bufferView"]]
	var comp_count: int = int({"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}.get(acc["type"], 1))
	var comp_size := 4  # 本加载器只遇到 float32 (componentType 5126)
	var stride: int = int(bv.get("byteStride", comp_count * comp_size))
	var off := int(bv.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
	var count := int(acc["count"])
	var total := count * comp_count
	# 紧密排列时走快速通道（绝大多数情况）
	if int(stride) == comp_count * comp_size:
		return bin.slice(off, off + total * comp_size).to_float32_array()
	var out := PackedFloat32Array()
	out.resize(total)
	var sp := StreamPeerBuffer.new()
	sp.data_array = bin
	for i in count:
		sp.seek(off + i * stride)
		for c in comp_count:
			out[i * comp_count + c] = sp.get_float()
	return out


## 解析 .vrma →
## {
##   duration: float,
##   order:  Array[int],            # 全部节点拓扑序（父先子后）
##   parent: Dictionary,            # node_idx -> 父 node_idx（根为 -1）
##   rest_q: Dictionary,            # node_idx -> Quaternion 静止局部旋转
##   rest_t: Dictionary,            # node_idx -> Vector3    静止局部平移
##   tracks: Dictionary,            # node_idx -> {times: PackedFloat32Array, quats: Array[Quaternion]}
##   hips:   Dictionary,            # {node:int, times, vecs:PackedVector3Array} 髋部位移轨（可能为空）
##   humanoid: Dictionary,          # 标准人形名 -> node_idx
## }
static func load_vrma(path: String) -> Dictionary:
	var g := _read_glb(path)
	if g.is_empty():
		return {}
	var js: Dictionary = g["json"]
	var bin: PackedByteArray = g["bin"]
	var nodes: Array = js.get("nodes", [])
	var anims: Array = js.get("animations", [])
	if anims.is_empty():
		return {}  # 有些 .vrma 文件（如猜拳系列）本身不含动画数据，静默跳过
	var anim: Dictionary = anims[0]

	var parent := {}
	var rest_q := {}
	var rest_t := {}
	for i in nodes.size():
		var n: Dictionary = nodes[i]
		rest_q[i] = Quaternion(
			float(n.get("rotation", [0, 0, 0, 1])[0]), float(n.get("rotation", [0, 0, 0, 1])[1]),
			float(n.get("rotation", [0, 0, 0, 1])[2]), float(n.get("rotation", [0, 0, 0, 1])[3]))
		var t: Array = n.get("translation", [0, 0, 0])
		rest_t[i] = Vector3(float(t[0]), float(t[1]), float(t[2]))
		for c in n.get("children", []):
			parent[int(c)] = i

	# 拓扑排序（父先子后，迭代写法）
	var order: Array[int] = []
	var visited := {}
	var stack: Array[int] = []
	for i in nodes.size():
		stack.clear()
		var cur := i
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

	# 采样轨道：node_idx -> {times, quats}
	var tracks := {}
	var hips := {}
	var duration := 0.0
	for ch in anim["channels"]:
		var target: Dictionary = ch["target"]
		if not target.has("node"):
			continue
		var node_idx := int(target["node"])
		var s: Dictionary = anim["samplers"][int(ch["sampler"])]
		var times := _read_accessor(js, bin, int(s["input"]))
		var vals := _read_accessor(js, bin, int(s["output"]))
		if times.size() == 0:
			continue
		duration = maxf(duration, times[times.size() - 1])
		if vals.size() == times.size() * 4:  # 旋转四元数
			var quats: Array[Quaternion] = []
			for k in times.size():
				quats.append(Quaternion(vals[k * 4], vals[k * 4 + 1], vals[k * 4 + 2], vals[k * 4 + 3]))
			tracks[node_idx] = {"times": times, "quats": quats}
		elif vals.size() == times.size() * 3:  # 平移（只有髋部会有）
			var vecs := PackedVector3Array()
			for k in times.size():
				vecs.append(Vector3(vals[k * 3], vals[k * 3 + 1], vals[k * 3 + 2]))
			hips = {"node": node_idx, "times": times, "vecs": vecs}

	# 标准人形名 -> node_idx
	var humanoid := {}
	var hb: Dictionary = js.get("extensions", {}).get("VRMC_vrm_animation", {}) \
			.get("humanoid", {}).get("humanBones", {})
	for bone_name in hb:
		humanoid[String(bone_name).to_lower()] = int(hb[bone_name]["node"])

	return {"duration": duration, "order": order, "parent": parent,
		"rest_q": rest_q, "rest_t": rest_t, "tracks": tracks,
		"hips": hips, "humanoid": humanoid}


## 读取 .vrm 的"标准人形名 -> 骨骼节点名"映射（骨骼节点名 = Godot 导入后的骨骼名）
static func load_vrm_bones(path: String) -> Dictionary:
	var g := _read_glb(path)
	if g.is_empty():
		return {}
	var js: Dictionary = g["json"]
	var nodes: Array = js.get("nodes", [])
	var hb: Dictionary = js.get("extensions", {}).get("VRMC_vrm", {}) \
			.get("humanoid", {}).get("humanBones", {})
	var out := {}
	for bone_name in hb:
		var node_idx := int(hb[bone_name]["node"])
		var node_name := String(nodes[node_idx].get("name", ""))
		if node_name != "":
			out[String(bone_name).to_lower()] = node_name
	return out


## 在 clip 的轨道上按时间采样某节点的旋转（LINEAR + Quaternion.slerp）
static func sample_quat(track: Dictionary, t: float) -> Quaternion:
	var times: PackedFloat32Array = track["times"]
	var quats: Array = track["quats"]
	var last := times.size() - 1
	if t <= times[0]:
		return quats[0]
	if t >= times[last]:
		return quats[last]
	var lo := 0
	var hi := last
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if times[mid] <= t:
			lo = mid
		else:
			hi = mid
	var span := times[hi] - times[lo]
	var f := 0.0 if span <= 0.0001 else (t - times[lo]) / span
	return quats[lo].slerp(quats[hi], f)


## 采样髋部位移轨
static func sample_vec(track: Dictionary, t: float) -> Vector3:
	var times: PackedFloat32Array = track["times"]
	var vecs: PackedVector3Array = track["vecs"]
	var last := times.size() - 1
	if t <= times[0]:
		return vecs[0]
	if t >= times[last]:
		return vecs[last]
	var lo := 0
	var hi := last
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if times[mid] <= t:
			lo = mid
		else:
			hi = mid
	var span := times[hi] - times[lo]
	var f := 0.0 if span <= 0.0001 else (t - times[lo]) / span
	return vecs[lo].lerp(vecs[hi], f)
