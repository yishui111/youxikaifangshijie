extends SceneTree
## VRM + VRMA 冒烟测试（无头运行）：
##   godot --headless --path . -s res://tools/test_vrm.gd

var actor


func _initialize() -> void:
	var S := load("res://scripts/vrm_actor.gd")
	actor = S.new()
	root.add_child(actor)
	var t0 := Time.get_ticks_msec()
	var ok: bool = actor.setup_model("res://models/角色1.vrm", "res://actions")
	print("setup ok=", ok, "  索引用时 ", Time.get_ticks_msec() - t0, " ms")
	actor.warm_up(["idle_loop", "avatar_hello", "avatar_walk", "avatar_talk"])

	var sk = actor._skeleton

	# 1) 挥手动作中段：手臂应该抬起来
	actor.play_anim("avatar_hello")
	for i in 15:
		actor._process(1.0 / 30.0)
	var clip = actor._actions.get("avatar_hello", {})
	print("hello 时长=", clip.get("duration"), " 链=", clip.get("chain", []).size(),
		" 当前=", actor.current_action, " t=", actor._action_time)
	for bn in ["RightUpperArm", "RightLowerArm", "Head"]:
		var i: int = sk.find_bone(bn)
		print(bn, " rest=", sk.get_bone_rest(i).basis.get_rotation_quaternion(),
			" pose=", sk.get_bone_pose_rotation(i))

	# 2) 走路动作中段：腿应该弯曲、髋部有起伏
	actor.play_anim("avatar_walk", true)
	for i in 20:
		actor._process(1.0 / 30.0)
	print("== walk 中段 ==")
	for bn in ["LeftUpperLeg", "RightUpperLeg", "LeftLowerArm"]:
		var i: int = sk.find_bone(bn)
		print(bn, " rest=", sk.get_bone_rest(i).basis.get_rotation_quaternion(),
			" pose=", sk.get_bone_pose_rotation(i))
	var hb: int = sk.find_bone("Hips")
	print("hips pos=", sk.get_bone_pose_position(hb), " rest_pos=", sk.get_bone_rest(hb).origin)
	quit()
