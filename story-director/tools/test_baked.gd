extends SceneTree

const VrmaLoaderScript = preload("res://scripts/vrma_loader.gd")

var actor


func _initialize() -> void:
	var S := load("res://scripts/vrm_actor.gd")
	actor = S.new()
	root.add_child(actor)
	actor.setup_model("res://models/角色1.vrm", "res://actions")
	actor.warm_up(["avatar_hello"])
	var clip = actor._actions["avatar_hello"]
	var tr = clip["b_tracks"][0]
	print("第0轨 node=", tr["node"], " 采样@0.5=", VrmaLoaderScript.sample_quat(tr["anim"], 0.5), " rest_l=", tr["rest_l"])
	for tr2 in clip["b_tracks"]:
		if tr2["node"] == "RightUpperArm":
			print("RightUpperArm 采样@0.5=", VrmaLoaderScript.sample_quat(tr2["anim"], 0.5), " rest_l=", tr2["rest_l"])
	actor.play_anim("avatar_hello")
	for i in 15:
		actor._process(1.0 / 30.0)
	var sk = actor._skeleton
	var i: int = sk.find_bone("RightUpperArm")
	print("运行后 pose=", sk.get_bone_pose_rotation(i))
	quit()
