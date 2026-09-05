extends Node3D
## 主场景：程序化搭建"拍摄棚"（地面、天空、阳光、道具、主摄像机），
## 然后由故事导演读 story.json 创建演员并开拍。
##
## 演员不再写死在这里——见 story.json 的 "actors" 配置：
##   指定 "model": "models/xxx.vrm" → 二次元 VRM 角色
##   不指定模型                     → 几何演示小人（按 color 上色）

const StoryDirectorScript := preload("res://scripts/story_director.gd")


func _ready() -> void:
	# 舞台灯光与天空（保留引用，供剧本的 environment 事件调节）
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.35, 0.55, 0.85)
	sky_mat.sky_horizon_color = Color(0.75, 0.82, 0.90)
	sky_mat.ground_bottom_color = Color(0.30, 0.30, 0.32)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -35, 0)
	sun.light_energy = 1.2
	sun.shadow_enabled = true
	add_child(sun)

	# 地面
	var ground := MeshInstance3D.new()
	var gm := PlaneMesh.new()
	gm.size = Vector2(60, 60)
	ground.mesh = gm
	var gmat := StandardMaterial3D.new()
	gmat.albedo_color = Color(0.40, 0.55, 0.35)
	ground.material_override = gmat
	add_child(ground)

	# 道具石头：[位置, 尺寸, 颜色]
	for cfg in [
		[Vector3(-6, 0.6, -5), Vector3(2, 1.2, 2), Color(0.55, 0.50, 0.45)],
		[Vector3(7, 0.9, -3), Vector3(1.4, 1.8, 1.4), Color(0.50, 0.45, 0.42)],
		[Vector3(-8, 0.5, 4), Vector3(1.8, 1.0, 1.8), Color(0.60, 0.55, 0.50)],
		[Vector3(6, 0.4, 7), Vector3(1.2, 0.8, 1.2), Color(0.52, 0.48, 0.44)],
	]:
		var box := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = cfg[1]
		box.mesh = bm
		var m := StandardMaterial3D.new()
		m.albedo_color = cfg[2]
		box.material_override = m
		box.position = cfg[0]
		add_child(box)

	# 主摄像机（初始全景机位）
	var cam := Camera3D.new()
	cam.position = Vector3(0, 6, 13)
	add_child(cam)
	cam.current = true

	# 开拍（剧本文件默认 story.json，可用 ++ story=res://xxx.json 覆盖）
	var story_path := "res://story.json"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("story="):
			story_path = a.substr(6)
	var director = StoryDirectorScript.new()
	add_child(director)
	director.setup_stage(sun, env, sky_mat)
	director.cam = cam
	if director.load_story(story_path):
		director.build_actors(self)
		director.warm_up_all()
		director.play()
