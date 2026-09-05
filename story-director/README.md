# 故事导演 StoryDirector

用"写剧本"的方式生成游戏内电影：剧本（story.json）→ 导演按时间轴调度
**镜头 / 环绕运镜 / 动作 / 移动 / 语音 / 字幕 / 环境光照 / 背景音乐** →
离线渲染成视频（或直接录屏）。

这就是《原神》式"引擎内过场"的开源实现，基于 Godot 4.7（MIT 协议）。
二次元角色走开放格式 **VRM**，动作走开放格式 **VRMA**。

## 目录结构

```
story-director/
├── project.godot          Godot 项目配置
├── story.json             ★ 示例剧本（60 秒《初遇》）
├── story_10min.json       ★ 10 分钟长剧《帕米尔的黎明》（生成器产出）
├── scenes/main.tscn       主场景（内容由脚本程序化搭建）
├── scripts/
│   ├── story_director.gd  ★ 故事导演：时间轴调度器
│   ├── vrm_actor.gd       VRM 演员：实例化模型 + VRMA 动作重定向播放
│   ├── vrma_loader.gd     .vrma 解析器（glTF 二进制 + 人形骨骼映射）
│   ├── demo_actor.gd      几何演示演员（无模型时的兜底）
│   └── main.gd            搭建拍摄棚（地面/天空/阳光/道具/机位）
├── models/                ★ 角色模型文件夹——把 .vrm 丢进来就能用
├── actions/               ★ 动作库文件夹——把 .vrma 丢进来就能用（现有 527 个）
├── voice/                 台词音频（wav/ogg）
├── audio/                 背景音乐
├── tools/                 剧本生成器 / 测试脚本
└── render/                渲染输出的视频
```

## 快速开始

| 想做什么 | 操作 |
|---|---|
| 试播示例剧本 | 双击 `运行故事.bat` |
| 试播 10 分钟长剧 | 双击 `运行10分钟.bat` |
| 渲染长剧成视频 | 双击 `渲染10分钟.bat` → `render/movie_10min.avi` |
| 渲染示例剧本 | 双击 `渲染成片.bat` → `render/movie.avi` |
| 改故事 | 编辑剧本 json，播放中按 R 重播 |

试播快捷键：`空格` 暂停 / `R` 重播 / `Esc` 退出。

## 如何加入自己的模型和动作（约定）

**模型**：把 `.vrm` 文件丢进 `story-director/models/`，然后在剧本的
`actors` 里引用（`"model": "models/你的模型.vrm"`）。若文件名与角色 id
相同（如 `feng.vrm` + 角色 id `feng`），连 model 字段都可以省略。
没有模型的角色会自动退化成几何演示小人，剧本照样能跑。

**动作**：把 `.vrma` 文件丢进 `story-director/actions/`，剧本里直接写
文件名（不含扩展名）：`{"type":"anim", "actor":"feng", "anim":"动作名"}`。
动作库是懒加载的：启动只建索引，用到的动作才解析，所以放几百个也不影响
启动速度。动作播完自动回到待机（idle_loop）。

VRM 模型来源：[VRoid Studio](https://vroid.com/studio) 免费捏制导出。
VRMA 动作来源：任意支持 VRM Animation 导出的软件/动作库。

## 动作系统是怎么工作的（three-vrm 官方重定向 + 烘焙）

模型和动作的"结合"用的是 **pixiv 官方开源的 three-vrm 重定向器**
（VRM 规范制定者的参考实现，`tools/three_bake/`）：

1. **离线烘焙**（`tools/three_bake/bake.mjs`，Node.js）：
   加载你的 VRM 模型和 .vrma 动作，调用 three-vrm 的
   `createVRMAnimationClip` 把动作**精确重定向**到模型骨骼上，
   按 30fps 采样并导出 JSON，存放在 `actions_baked/<模型名>/`。
2. **Godot 运行时**：`vrm_actor.gd` 优先加载烘焙 JSON，把换算好的
   旋转直接写进模型骨架（含"静止姿态差"修正，因为 godot-vrm 导入时
   改写过骨骼静止朝向）。没有烘焙数据的动作走 .vrma 近似重定向回退。
3. **根运动防护**：动捕绝对坐标的髋部轨迹自动丢弃水平漂移，只保留
   垂直起伏。
4. 说话时自动切 `avatar_talk` 比划，走路自动切 `avatar_walk` 并按
   位移速度调节播放倍速。

**烘焙新动作**：把 .vrma 丢进 `actions/` 后运行：

```
cd tools/three_bake
node bake.mjs "stripped/角色1.vrm" "../../actions" "baked" actions_list.txt
cp -r baked/* ../../actions_baked/
```

（每个模型跑一次；`actions_list.txt` 里是想烘焙的动作名列表。）
不加烘焙也能播——运行时会退回内置的近似重定向。

## 配音管线（TTS）

Windows 自带的中文语音（Microsoft Huihui）负责台词，三个角色用不同语速
区分声线（风=快、雪=平、夜=慢）：

```
python tools/gen_long_story.py   # 第一次：生成剧本 + 台词清单（估算时长）
python tools/make_voices.py      # 合成 voice/tts_*.wav + 真实时长表
python tools/gen_long_story.py   # 第二次：按真实语音时长精排节奏
```

- 嘴型同步：说话时驱动 VRM 的 `fcl_mth_a`（张嘴）morph 模拟音节开合
- 字幕停留时间自动等于语音真实时长 + 0.6 秒
- 想换成真人/AI 配音：把 `voice/tts_*.wav` 替换为同名文件即可；文件名
  变了就同步改剧本里的 `file` 字段

## 剧本格式（story.json）

```jsonc
{
  "title": "剧名",
  "loop": false,
  "actors": {
    "feng": { "display": "风", "model": "models/角色1.vrm",
              "start": [-7, 0, -6] }
  },
  "cameras": {                       // 预设机位，可复用
    "wide": { "pos": [0, 4, 2], "look": [0, 1.2, -5.5] }
  },
  "timeline": [
    { "t": 0.0, "type": "environment", "preset": "day" },
    { "t": 0.0, "type": "bgm", "volume_db": -16 },
    { "t": 0.0, "type": "orbit", "look": [0, 1.1, -3], "radius": 8,
      "height": 2, "from_deg": -30, "to_deg": 90, "duration": 18 },
    { "t": 7.2, "type": "anim", "actor": "feng", "anim": "avatar_hello" },
    { "t": 7.6, "type": "voice", "actor": "feng",
      "file": "voice/line_0_0.wav", "subtitle": "你们好呀！" },
    { "t": 16.0, "type": "end" }
  ]
}
```

### 事件类型

| type | 作用 | 专有参数 |
|---|---|---|
| `camera` | 切镜头 | `name`（预设机位）或 `pos`+`look`；`transition` 过渡秒数；`fov` |
| `orbit` | 环绕运镜 | `look` 圆心、`radius` 半径、`height` 高度、`from_deg`/`to_deg` 起止角、`duration` |
| `anim` | 动作 | `actor`、`anim`（.vrma 文件名）、`loop` 强制循环 |
| `move` | 移动 | `actor`、`to` [x,y,z]、`duration` 秒（自动面向+走路动作） |
| `face` / `place` | 转身 / 瞬移 | `actor`、`to` |
| `voice` | 语音+字幕 | `actor`、`file`、`subtitle`、`duration`（默认 4.5s） |
| `subtitle` | 旁白字幕 | `text`、`duration` |
| `environment` | 环境光照 | `preset`: day/sunset/night/dawn；可覆盖 `sun_deg`/`sun_color`/`sun_energy`/`ambient`/`sky_top`/`sky_horizon`/`fog_density` |
| `bgm` | 背景音乐 | `file`（默认 audio/bgm.wav）、`volume_db`、`stop: true` 停止 |
| `end` | 剧终 | 渲染模式下停留 1.2s 后自动退出收尾 |

所有事件都支持 `t`（触发时间，秒）。时间轴是绝对时间，谁在几秒做什么
直接写数字。

## 出片

`渲染10分钟.bat` 等价于：

```
Godot_..._win64_console.exe --path story-director --fixed-fps 30 ^
    --write-movie render\movie_10min.avi ++ story=res://story_10min.json movie
```

- Movie Maker 是**离线逐帧渲染**，不掉帧不卡顿，机器性能只影响渲染耗时
  （本片约 560 秒，渲染约 25~40 分钟，产出约 800MB 的 720p/30fps AVI）
- `++` 后面是给剧本的用户参数：`movie` = 渲染模式（隐藏调试 HUD、剧终
  自动退出）；`story=...` 指定剧本文件；`start=秒数` 从中间某秒开始播
  （调试用，如 `start=208` 直接看黄昏之舞）
- 要 PNG 序列帧做后期合成：把 `--write-movie` 的输出改成 `xxx.png`

## 长剧本生成器

`tools/gen_long_story.py` 用"时间游标 + say/narrate/wait"的方式生成
10 分钟剧本。改台词、加章节都在这个文件里，改完运行：

```
python tools/gen_long_story.py
```

## 已知边界

- 配音是 Windows TTS 机械音；想要更自然的语音，替换 `voice/tts_*.wav` 同名文件即可
- 走路步频已与位移速度匹配，但转身仍是瞬间转向
- 口型是程序模拟的音节开合（驱动 fcl_mth_a morph），非音频幅度驱动
- `--headless` 无头模式不能配合 `--write-movie` 渲染（无真实纹理）
- VRM 插件兼容 Godot 4.x；升级引擎大版本后如遇导入报错，重跑一次导入
