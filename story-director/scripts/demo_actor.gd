class_name DemoActor
extends Node3D
## 演示用演员：几何体拼装的简单角色（身体 + 头 + 手臂）。
## 内置动画：idle(待机·循环) / walk(走路·循环) / wave(挥手) / nod(点头) / jump(跳)
## 对外接口：
##   play_anim(name)            播放动作，播完自动回 idle
##   move_to(目标点, 秒)        走过去（自动面向方向），走完回 idle
##   face_towards(点)           转身面向某点
##   play_voice(res路径)        播放语音（wav/ogg）
## 接入 VRM 二次元角色的方法见 README.md「接入 VRM 角色」。

var display_name := "演员"

var _color: Color
var _anim: AnimationPlayer
var _voice: AudioStreamPlayer
var _move_tween: Tween


func _init(color := Color(0.3, 0.55, 0.95)) -> void:
	_color = color


func _ready() -> void:
	_build_body()
	_build_anims()
	_voice = AudioStreamPlayer.new()
	add_child(_voice)
	_anim.animation_finished.connect(_on_anim_finished)
	_anim.play("idle")


# ---------- 对外接口 ----------

func play_anim(anim_name: String) -> void:
	if not _anim.has_animation(anim_name):
		push_warning("演员 [" + display_name + "] 没有动画: " + anim_name)
		return
	_anim.play(anim_name)


func move_to(target: Vector3, duration: float) -> void:
	face_towards(target)
	if _move_tween and _move_tween.is_valid():
		_move_tween.kill()
	_anim.play("walk")
	_move_tween = create_tween()
	_move_tween.tween_property(self, "global_position", target, maxf(duration, 0.05))
	_move_tween.tween_callback(func() -> void: _anim.play("idle"))


func face_towards(point: Vector3) -> void:
	var d := point - global_position
	d.y = 0.0
	if d.length() > 0.01:
		rotation.y = atan2(d.x, d.z)


func play_voice(path: String) -> void:
	if path.is_empty():
		return
	var stream := load(path)
	if stream == null:
		push_warning("找不到语音文件: " + path)
		return
	_voice.stream = stream
	_voice.play()


func stop_voice() -> void:
	_voice.stop()


# ---------- 内部实现 ----------

func _on_anim_finished(anim_name: StringName) -> void:
	if anim_name != StringName("idle"):
		_anim.play("idle")


func _build_body() -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = _color
	mat.roughness = 0.8

	var body := MeshInstance3D.new()
	body.name = "Body"
	var cm := CapsuleMesh.new()
	cm.radius = 0.32
	cm.height = 1.15
	body.mesh = cm
	body.material_override = mat
	body.position = Vector3(0, 0.9, 0)
	add_child(body)

	var head := MeshInstance3D.new()
	head.name = "Head"
	var sm := SphereMesh.new()
	sm.radius = 0.24
	sm.height = 0.48
	head.mesh = sm
	head.material_override = mat
	head.position = Vector3(0, 1.7, 0)
	add_child(head)

	var pivot := Node3D.new()
	pivot.name = "ArmPivot"
	pivot.position = Vector3(0.42, 1.5, 0)
	add_child(pivot)
	var arm := MeshInstance3D.new()
	arm.name = "Arm"
	var bm := BoxMesh.new()
	bm.size = Vector3(0.14, 0.55, 0.14)
	arm.mesh = bm
	arm.material_override = mat
	arm.position = Vector3(0, -0.26, 0)
	pivot.add_child(arm)


func _build_anims() -> void:
	_anim = AnimationPlayer.new()
	_anim.root_node = NodePath("..")
	add_child(_anim)

	var lib := AnimationLibrary.new()
	lib.add_animation("idle", _make_idle())
	lib.add_animation("walk", _make_walk())
	lib.add_animation("wave", _make_wave())
	lib.add_animation("nod", _make_nod())
	lib.add_animation("jump", _make_jump())
	_anim.add_animation_library("", lib)


func _new_anim(length: float, loop: bool) -> Animation:
	var a := Animation.new()
	a.length = length
	a.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	return a


func _add_vec_track(a: Animation, path: String, keys: Array) -> void:
	var t := a.add_track(Animation.TYPE_VALUE)
	a.track_set_path(t, path)
	for k in keys:
		a.track_insert_key(t, float(k[0]), k[1])


func _make_idle() -> Animation:
	var a := _new_anim(2.0, true)
	_add_vec_track(a, "Body:position", [
		[0.0, Vector3(0, 0.90, 0)],
		[1.0, Vector3(0, 0.84, 0)],
		[2.0, Vector3(0, 0.90, 0)],
	])
	_add_vec_track(a, "Head:position", [
		[0.0, Vector3(0, 1.70, 0)],
		[1.0, Vector3(0, 1.66, 0)],
		[2.0, Vector3(0, 1.70, 0)],
	])
	return a


func _make_walk() -> Animation:
	var a := _new_anim(1.0, true)
	_add_vec_track(a, "Body:position", [
		[0.0, Vector3(0, 0.90, 0)],
		[0.25, Vector3(0, 0.84, 0)],
		[0.5, Vector3(0, 0.90, 0)],
		[0.75, Vector3(0, 0.84, 0)],
		[1.0, Vector3(0, 0.90, 0)],
	])
	_add_vec_track(a, "Body:rotation", [
		[0.0, Vector3(0, 0, 0)],
		[0.25, Vector3(0, 0, 0.05)],
		[0.5, Vector3(0, 0, 0)],
		[0.75, Vector3(0, 0, -0.05)],
		[1.0, Vector3(0, 0, 0)],
	])
	return a


func _make_wave() -> Animation:
	var a := _new_anim(1.2, false)
	_add_vec_track(a, "ArmPivot:rotation", [
		[0.0, Vector3(0, 0, 0)],
		[0.3, Vector3(0, 0, -2.4)],
		[0.55, Vector3(0, 0, -1.8)],
		[0.8, Vector3(0, 0, -2.4)],
		[1.2, Vector3(0, 0, 0)],
	])
	return a


func _make_nod() -> Animation:
	var a := _new_anim(1.2, false)
	_add_vec_track(a, "Head:rotation", [
		[0.0, Vector3(0, 0, 0)],
		[0.3, Vector3(0.45, 0, 0)],
		[0.6, Vector3(0, 0, 0)],
		[0.9, Vector3(0.45, 0, 0)],
		[1.2, Vector3(0, 0, 0)],
	])
	return a


func _make_jump() -> Animation:
	var a := _new_anim(0.7, false)
	_add_vec_track(a, "Body:position", [
		[0.0, Vector3(0, 0.90, 0)],
		[0.35, Vector3(0, 1.45, 0)],
		[0.7, Vector3(0, 0.90, 0)],
	])
	return a
