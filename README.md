# 游戏开放世界(story-director)

Godot + VRM 角色的 AI 故事导演工作台:文字剧本 → 镜头/动作 → 渲染成片。

## 环境要求(需手动准备的大件,不入库)

| 依赖 | 放置位置 | 下载 |
|---|---|---|
| Godot 4.x | `godot\Godot_v4.7.2-stable_win64.exe` | https://godotengine.org/download |
| Blender 4.x | `blender\blender-4.5.9-windows-x64\` | https://www.blender.org/download |
| 角色模型 | `story-director\models\角色1.vrm / 角色2.vrm / 角色3.vrm` | 自备 VRM(模型不入库) |
| Node.js ≥ 18 | 系统安装 | viewer 预览用 |

> 根目录的 `godot.zip / blender.zip / *.vrm` 在老机器上还有,直接拷贝对应目录最快。

## 首次运行

1. 打开 `story-director\project.godot`(Godot 会自动导入资源,`.godot\` 缓存自动生成);
2. 动作库:动作数据烘焙在 `story-director\actions_baked\`,重烘焙用 `story-director\tools\three_bake\`;
3. 双击 `运行故事.bat`(启动 viewer,默认 http://127.0.0.1:8642),`运行10分钟.bat` 生成一段故事;
4. 渲染:`渲染10分钟.bat` / `渲染成片.bat`(输出到 `story-director\render\`,不入库)。

## 端口

viewer 固定 8642(全局唯一,见仓库根各项目端口表)。
