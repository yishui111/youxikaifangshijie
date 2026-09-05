class_name StoryDirector
extends Node
## 故事导演（StoryDirector）
## 读取 story.json 剧本，按时间轴调度七类事件：
##   camera      切换镜头（预设机位/临时坐标，支持平滑过渡）
##   orbit       环绕镜头（绕某点弧线运镜，适合开场/谢幕）
##   anim        播放动作（VRM 演员播 .vrma 动作库，几何演员播内置动作）
##   move        角色移动（自动面向、播放走路动作）
##   face/place  转身面向 / 瞬移定位
##   voice       语音 + 字幕（VRM 演员说话时自动配合 talk 动作）
##   subtitle    纯字幕（旁白）
##   environment 切换环境光照（day / sunset / night / dawn）
##   bgm         背景音乐 开/停
##   end         剧终（渲染模式下自动收尾退出）
##
## 演员加载约定（build_actors）：
##   story.json 的 "actors" 里每个角色可指定 "model": "models/xxx.vrm"；
##   不指定时若 res://models/<角色id>.vrm 存在则自动使用；都没有则退回
##   几何演示演员。以后只要把 .vrm 丢进 models/ 文件夹就能被读到。
##
## 剧本格式详见 README.md。运行时快捷键：空格=暂停，R=重播，Esc=退出。
## 调试参数（用户参数）：++ start=秒数  → 从剧本中间某秒开始播。

const VrmActorScript := preload("res://scripts/vrm_actor.gd")
const DemoActorScript := preload("res://scripts/demo_actor.gd")

const MODELS_DIR := "res://models"
const ACTIONS_DIR := "res://actions"

var actors: Dictionary = {}          # id -> 演员节点
var display_names: Dictionary = {}   # id -> 字幕显示名
var story: Dictionary = {}
var events: Array = []
var clock := 0.0
var event_index := 0
var playing := false
var is_movie_mode := false

var cam: Camera3D
var cam_tween: Tween
var orbit := {}                      # 环绕镜头状态（空 = 无）

var _sun: DirectionalLight3D
var _sky_mat: ProceduralSkyMaterial
var _env: Environment
var _bgm: AudioStreamPlayer

var subtitle_label: Label
var end_label: Label
var info_label: Label
var _subtitle_hide_at := -1.0


## 舞台引用：阳光和环境（供 environment 事件调节光照）
func setup_stage(sun: DirectionalLight3D, env: Environment, sky_mat: ProceduralSkyMaterial) -> void:
	_sun = sun
	_env = env
	_sky_mat = sky_mat


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# 引擎会吞掉自己的启动参数（如 --write-movie），所以渲染成片的 bat 里
	# 额外用 ++ 传一个用户参数 "movie" 进来，作为双保险检测。
	is_movie_mode = OS.get_cmdline_args().has("--write-movie") \
			or OS.get_cmdline_user_args().has("movie")
	_build_ui()


func load_story(path: String) -> bool:
	var txt := FileAccess.get_file_as_string(path)
	if txt.is_empty():
		push_error("读不到剧本文件: " + path)
		return false
	var data = JSON.parse_string(txt)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("剧本不是合法 JSON: " + path)
		return false
	story = data
	var raw: Array = story.get("timeline", [])
	for i in raw.size():
		raw[i]["_seq"] = i
	raw.sort_custom(_event_less)
	events = raw
	var actors_cfg: Dictionary = story.get("actors", {})
	for id in actors_cfg:
		display_names[id] = str(actors_cfg[id].get("display", id))
	return true


## 按剧本 "actors" 配置创建演员：
##   "model" 指定 .vrm；缺省时尝试 res://models/<id>.vrm；再退回几何演员
##   "start" 初始位置 [x,y,z]；"color" 几何演员颜色
func build_actors(parent: Node) -> void:
	var cfg: Dictionary = story.get("actors", {})
	var idx := 0
	for id in cfg:
		var c: Dictionary = cfg[id]
		var actor: Node3D
		var model_path := str(c.get("model", ""))
		if model_path == "":
			var guess := MODELS_DIR.path_join(str(id) + ".vrm")
			if FileAccess.file_exists(guess):
				model_path = guess
		if model_path != "":
			var va = VrmActorScript.new()
			parent.add_child(va)
			if va.setup_model(_res_path(model_path), ACTIONS_DIR):
				actor = va
			else:
				va.queue_free()
				actor = null
		if actor == null:
			var col: Array = c.get("color", [0.3, 0.55, 0.95])
			var da = DemoActorScript.new(Color(float(col[0]), float(col[1]), float(col[2])))
			parent.add_child(da)
			actor = da
		actor.display_name = str(c.get("display", id))
		if c.has("start"):
			actor.position = _v3(c["start"])
		else:
			# 没给位置就先在后台一字排开候场
			actor.position = Vector3(-6.0 + idx * 2.0, 0, -8)
		actors[id] = actor
		idx += 1
	print("演员就位: ", actors.keys())


## 预解析剧本会用到的动作（避免演出中途卡顿）
func warm_up_all() -> void:
	for id in actors:
		var a = actors[id]
		if a is VrmActor:
			var names: Array = ["idle_loop", "avatar_walk", "avatar_talk"]
			for ev in events:
				if str(ev.get("type", "")) == "anim" and str(ev.get("actor", "")) == id:
					names.append(str(ev.get("anim", "")))
			a.warm_up(names)


func play() -> void:
	clock = 0.0
	event_index = 0
	playing = true
	# 调试跳转：++ start=秒数 → 快进到某秒（只保留镜头/环境/站位状态）
	var start_at := -1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("start="):
			start_at = float(a.substr(6))
	if start_at > 0.0:
		_fast_forward(start_at)


func _fast_forward(start_at: float) -> void:
	while event_index < events.size() and float(events[event_index].get("t", 0.0)) <= start_at:
		var ev: Dictionary = events[event_index]
		match str(ev.get("type", "")):
			"camera":
				_switch_camera(ev)
			"environment":
				_apply_environment(ev)
			"place":
				var a = _get_actor(ev)
				if a:
					a.global_position = _v3(ev.get("to", [0, 0, 0]))
			_:
				pass  # 其他事件快进时跳过
		event_index += 1
	clock = start_at
	print("快进到 T+", start_at, "s，已跳过 ", event_index, " 个事件")


func _process(delta: float) -> void:
	if get_tree().paused:
		return
	if playing:
		clock += delta
		while event_index < events.size() and float(events[event_index].get("t", 0.0)) <= clock:
			_run_event(events[event_index])
			event_index += 1
	if _subtitle_hide_at >= 0.0 and clock >= _subtitle_hide_at:
		subtitle_label.text = ""
		_subtitle_hide_at = -1.0
	_update_orbit()
	info_label.text = "%s   T+%.1fs\n[空格] 暂停    [R] 重播    [Esc] 退出" % [
		story.get("title", "无题"), clock]


func _event_less(a: Dictionary, b: Dictionary) -> bool:
	var ta := float(a.get("t", 0.0))
	var tb := float(b.get("t", 0.0))
	if absf(ta - tb) > 0.0001:
		return ta < tb
	return int(a.get("_seq", 0)) < int(b.get("_seq", 0))


func _run_event(ev: Dictionary) -> void:
	var type := str(ev.get("type", ""))
	match type:
		"camera":
			_switch_camera(ev)
		"orbit":
			_start_orbit(ev)
		"anim":
			var a = _get_actor(ev)
			if a:
				a.play_anim(str(ev.get("anim", "idle")), bool(ev.get("loop", false)))
		"move":
			var a = _get_actor(ev)
			if a:
				a.move_to(_v3(ev.get("to", [0, 0, 0])), float(ev.get("duration", 1.0)))
		"face":
			var a = _get_actor(ev)
			if a:
				a.face_towards(_v3(ev.get("to", [0, 0, 0])))
		"place":
			var a = _get_actor(ev)
			if a:
				a.global_position = _v3(ev.get("to", [0, 0, 0]))
		"voice":
			var a = _get_actor(ev)
			if a:
				a.play_voice(_res_path(str(ev.get("file", ""))))
			_show_subtitle(ev)
		"subtitle":
			_show_subtitle(ev)
		"environment":
			_apply_environment(ev)
		"bgm":
			_run_bgm(ev)
		"end":
			_finish()
		_:
			push_warning("未知事件类型: " + type)


func _get_actor(ev: Dictionary) -> Node:
	var id := str(ev.get("actor", ""))
	if not actors.has(id):
		push_warning("剧本里引用了不存在的演员: " + id)
		return null
	return actors[id]


# ---------- 镜头 ----------

func _switch_camera(ev: Dictionary) -> void:
	orbit = {}  # 新镜头事件取消环绕
	var target_xf: Transform3D
	var cameras: Dictionary = story.get("cameras", {})
	if ev.has("name") and cameras.has(ev["name"]):
		var c: Dictionary = cameras[ev["name"]]
		target_xf = _look_xf(_v3(c["pos"]), _v3(c["look"]))
	elif ev.has("pos") and ev.has("look"):
		target_xf = _look_xf(_v3(ev["pos"]), _v3(ev["look"]))
	else:
		push_warning("camera 事件需要 name 或 pos/look: " + str(ev))
		return
	if not cam.current:
		cam.current = true
	if ev.has("fov"):
		cam.fov = float(ev["fov"])
	if cam_tween and cam_tween.is_valid():
		cam_tween.kill()
	var trans := float(ev.get("transition", 0.0))
	if trans <= 0.01:
		cam.global_transform = target_xf
	else:
		cam_tween = create_tween()
		cam_tween.set_pause_mode(Tween.TWEEN_PAUSE_STOP)
		cam_tween.tween_property(cam, "global_transform", target_xf, trans) \
			.set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


## 环绕镜头：绕 look 点从 from_deg 转到 to_deg（顺时针，度）
func _start_orbit(ev: Dictionary) -> void:
	cam_tween = null
	orbit = {
		"look": _v3(ev.get("look", [0, 1, 0])),
		"radius": float(ev.get("radius", 8.0)),
		"height": float(ev.get("height", 3.0)),
		"from": float(ev.get("from_deg", 0.0)),
		"to": float(ev.get("to_deg", 360.0)),
		"duration": maxf(float(ev.get("duration", 8.0)), 0.1),
		"t0": clock,
	}


func _update_orbit() -> void:
	if orbit.is_empty():
		return
	var k: float = clampf((clock - float(orbit["t0"])) / float(orbit["duration"]), 0.0, 1.0)
	var deg: float = lerpf(float(orbit["from"]), float(orbit["to"]), k)
	var rad := deg_to_rad(deg)
	var look: Vector3 = orbit["look"]
	var radius: float = orbit["radius"]
	var height: float = orbit["height"]
	var pos := look + Vector3(sin(rad) * radius, height, cos(rad) * radius)
	cam.global_transform = _look_xf(pos, look)
	if k >= 1.0:
		orbit = {}


func _look_xf(pos: Vector3, look: Vector3) -> Transform3D:
	var xf := Transform3D()
	xf.origin = pos
	if pos.distance_to(look) < 0.01:
		return xf
	return xf.looking_at(look, Vector3.UP)


# ---------- 环境光照 ----------

func _apply_environment(ev: Dictionary) -> void:
	if _sun == null or _env == null or _sky_mat == null:
		return
	var preset := str(ev.get("preset", "day"))
	var sun_deg := Vector3(-50, -35, 0)
	var sun_color := Color(1, 1, 1)
	var sun_energy := 1.2
	var ambient := 1.0   # 环境光强度（夜晚调高，避免角色黑成一团）
	var top := Color(0.35, 0.55, 0.85)
	var horizon := Color(0.75, 0.82, 0.90)
	var fog := Color(-1, -1, -1)  # 负值 = 不开雾
	match preset:
		"day":
			pass
		"sunset":
			sun_deg = Vector3(-12, -60, 0)
			sun_color = Color(1.0, 0.55, 0.3)
			sun_energy = 1.1
			ambient = 1.15
			top = Color(0.25, 0.2, 0.45)
			horizon = Color(0.95, 0.55, 0.3)
			fog = Color(0.85, 0.5, 0.35)
		"night":
			sun_deg = Vector3(-40, 120, 0)
			sun_color = Color(0.55, 0.65, 1.0)
			sun_energy = 0.3
			ambient = 2.6
			top = Color(0.02, 0.03, 0.08)
			horizon = Color(0.07, 0.09, 0.18)
			fog = Color(0.05, 0.07, 0.14)
		"dawn":
			sun_deg = Vector3(-8, -100, 0)
			sun_color = Color(1.0, 0.72, 0.5)
			sun_energy = 0.9
			ambient = 1.4
			top = Color(0.3, 0.35, 0.6)
			horizon = Color(0.9, 0.7, 0.6)
			fog = Color(0.7, 0.65, 0.7)
		_:
			push_warning("未知环境预设: " + preset)
	# 剧本可以覆盖任何单项
	if ev.has("sun_deg"):
		var s := _v3(ev["sun_deg"])
		sun_deg = Vector3(s.x, s.y, 0)
	if ev.has("sun_color"):
		sun_color = _color(ev["sun_color"])
	if ev.has("sun_energy"):
		sun_energy = float(ev["sun_energy"])
	if ev.has("ambient"):
		ambient = float(ev["ambient"])
	if ev.has("sky_top"):
		top = _color(ev["sky_top"])
	if ev.has("sky_horizon"):
		horizon = _color(ev["sky_horizon"])
	_sun.rotation_degrees = sun_deg
	_sun.light_color = sun_color
	_sun.light_energy = sun_energy
	_env.ambient_light_energy = ambient
	_sky_mat.sky_top_color = top
	_sky_mat.sky_horizon_color = horizon
	_sky_mat.ground_bottom_color = horizon.darkened(0.6)
	_sky_mat.ground_horizon_color = horizon
	if fog.r >= 0.0:
		_env.fog_enabled = true
		_env.fog_light_color = fog
		_env.fog_density = float(ev.get("fog_density", 0.008))
	else:
		_env.fog_enabled = false


func _color(a) -> Color:
	return Color(float(a[0]), float(a[1]), float(a[2]))


# ---------- 背景音乐 ----------

func _run_bgm(ev: Dictionary) -> void:
	if bool(ev.get("stop", false)):
		if _bgm:
			_bgm.stop()
		return
	if _bgm == null:
		_bgm = AudioStreamPlayer.new()
		add_child(_bgm)
	var path := _res_path(str(ev.get("file", "audio/bgm.wav")))
	var stream := load(path)
	if stream == null:
		push_warning("找不到背景音乐: " + path)
		return
	if stream is AudioStreamWAV:
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	elif stream is AudioStreamOggVorbis:
		stream.loop = true
	_bgm.stream = stream
	_bgm.volume_db = float(ev.get("volume_db", -14.0))
	_bgm.play()


# ---------- 字幕 / 结束 / 输入 ----------

func _show_subtitle(ev: Dictionary) -> void:
	var text := str(ev.get("subtitle", ev.get("text", "")))
	if text.is_empty():
		return
	var id := str(ev.get("actor", ""))
	if id != "" and display_names.has(id):
		text = display_names[id] + "：" + text
	subtitle_label.text = text
	if ev.has("duration"):
		_subtitle_hide_at = clock + float(ev["duration"])
	else:
		_subtitle_hide_at = clock + 4.5


func _finish() -> void:
	playing = false
	subtitle_label.text = ""
	end_label.visible = true
	if is_movie_mode:
		# 渲染模式下：停留一秒让观众看到"剧终"，然后自动退出收尾
		await get_tree().create_timer(1.2).timeout
		get_tree().quit()
	elif story.get("loop", false):
		await get_tree().create_timer(2.0).timeout
		get_tree().reload_current_scene()


func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_SPACE:
				var p := not get_tree().paused
				get_tree().paused = p
				if cam_tween and cam_tween.is_valid():
					if p:
						cam_tween.pause()
					else:
						cam_tween.play()
			KEY_R:
				get_tree().paused = false
				get_tree().reload_current_scene()
			KEY_ESCAPE:
				get_tree().quit()


func _v3(a) -> Vector3:
	if a == null or a.size() < 3:
		return Vector3.ZERO
	return Vector3(float(a[0]), float(a[1]), float(a[2]))


func _res_path(p: String) -> String:
	if p.is_empty():
		return p
	if not p.begins_with("res://") and not p.is_absolute_path():
		p = "res://" + p
	return p


# ---------- 界面 ----------

func _build_ui() -> void:
	var font := _load_cjk_font()
	var layer := CanvasLayer.new()
	add_child(layer)

	subtitle_label = Label.new()
	subtitle_label.anchor_left = 0.0
	subtitle_label.anchor_right = 1.0
	subtitle_label.anchor_top = 1.0
	subtitle_label.anchor_bottom = 1.0
	subtitle_label.offset_left = 60
	subtitle_label.offset_right = -60
	subtitle_label.offset_top = -110
	subtitle_label.offset_bottom = -50
	subtitle_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle_label.add_theme_font_size_override("font_size", 28)
	subtitle_label.add_theme_color_override("font_outline_color", Color.BLACK)
	subtitle_label.add_theme_constant_override("outline_size", 10)
	if font:
		subtitle_label.add_theme_font_override("font", font)
	layer.add_child(subtitle_label)

	end_label = Label.new()
	end_label.anchor_left = 0.5
	end_label.anchor_right = 0.5
	end_label.anchor_top = 0.5
	end_label.anchor_bottom = 0.5
	end_label.offset_left = -300
	end_label.offset_right = 300
	end_label.offset_top = -50
	end_label.offset_bottom = 20
	end_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	end_label.text = "——  剧  终  ——"
	end_label.visible = false
	end_label.add_theme_font_size_override("font_size", 44)
	end_label.add_theme_color_override("font_outline_color", Color.BLACK)
	end_label.add_theme_constant_override("outline_size", 12)
	if font:
		end_label.add_theme_font_override("font", font)
	layer.add_child(end_label)

	info_label = Label.new()
	info_label.position = Vector2(16, 10)
	info_label.text = ""
	info_label.add_theme_font_size_override("font_size", 16)
	info_label.add_theme_color_override("font_outline_color", Color.BLACK)
	info_label.add_theme_constant_override("outline_size", 6)
	info_label.modulate = Color(1, 1, 1, 0.9)
	if font:
		info_label.add_theme_font_override("font", font)
	# 渲染成片时不要把调试信息拍进去
	info_label.visible = not is_movie_mode
	layer.add_child(info_label)


func _load_cjk_font() -> Font:
	# 借用 Windows 系统字体显示中文；找不到就用引擎默认字体
	for p in ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhl.ttc",
			"C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc"]:
		if FileAccess.file_exists(p):
			var f := FontFile.new()
			if f.load_dynamic_font(p) == OK:
				return f
	return null
