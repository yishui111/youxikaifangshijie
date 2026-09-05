# -*- coding: utf-8 -*-
"""
10 分钟剧本生成器：帕米尔的黎明
三个 VRM 旅人（风/雪/夜）的一天。

输出：
  story_10min.json          剧本
  tools/lines_manifest.json 台词清单（供 TTS 配音用）

配音时长：若 tools/line_durations.json 存在（由 make_voices.py 生成），
则用真实语音时长排布字幕节奏；否则用字数估算。

用法：
  python gen_long_story.py          # 第一次：估算时长
  python make_voices.py            # 合成配音 + 测量时长
  python gen_long_story.py          # 第二次：用真实时长精修节奏
"""

import json
import os

T = 0.0          # 时间游标（秒）
EV = []          # 事件列表
LINES = []       # 台词清单
_seq = 0
_line_no = 0

# 真实语音时长表（make_voices.py 产出）
DUR_FILE = os.path.join(os.path.dirname(__file__), "line_durations.json")
DURATIONS = {}
if os.path.exists(DUR_FILE):
    DURATIONS = json.load(open(DUR_FILE, encoding="utf-8"))

VOICE_FMT = "voice/tts_{}.wav"


def at(t, **ev):
    global _seq
    ev["t"] = round(t, 2)
    ev["_seq"] = _seq
    _seq += 1
    EV.append(ev)


def say(actor, text, gap=0.4, dur=None):
    """在当前游标处说一句台词：登记台词清单 + 排布语音/字幕事件"""
    global T, _line_no
    lid = "L{:03d}".format(_line_no)
    _line_no += 1
    LINES.append({"id": lid, "actor": actor, "text": text})
    at(T, type="voice", actor=actor, file=VOICE_FMT.format(lid), subtitle=text,
       duration=(DURATIONS.get(lid, 3.0) + 0.6))
    T += (DURATIONS.get(lid, 3.0 + len(text) * 0.16)) + gap


def narrate(text, gap=0.3):
    global T
    at(T, type="subtitle", text=text)
    T += 2.6 + len(text) * 0.14 + gap


def wait(d):
    global T
    T += d


def main():
    story = {
        "title": "帕米尔的黎明 · Dawn of Palmir",
        "loop": False,
        "actors": {
            "feng": {"display": "风", "model": "models/角色1.vrm", "start": [-7, 0, -6]},
            "xue":  {"display": "雪", "model": "models/角色2.vrm", "start": [7, 0, -6]},
            "ye":   {"display": "夜", "model": "models/角色3.vrm", "start": [0, 0, -7]},
        },
        "cameras": {
            "wide":       {"pos": [0, 4, 2],     "look": [0, 1.2, -5.5]},
            "three_shot": {"pos": [0, 1.8, 1],   "look": [0, 1.2, -5.5]},
            "feng_close": {"pos": [-1.4, 1.4, -2.6], "look": [-2.2, 1.25, -5.5]},
            "xue_close":  {"pos": [1.4, 1.4, -2.6],  "look": [2.2, 1.25, -5.5]},
            "ye_close":   {"pos": [0.6, 1.4, -3.4],  "look": [0.2, 1.25, -6.2]},
            "far":        {"pos": [0, 10, 12],   "look": [0, 0, -6]},
        },
        "timeline": EV,
    }

    # ============ 第一章 开场（白天） ============
    at(T, type="environment", preset="day")
    at(T, type="bgm", volume_db=-16)
    at(T, type="orbit", look=[0, 1.1, -3], radius=8, height=2.0, from_deg=-30, to_deg=90, duration=18)
    wait(1.0)
    narrate("帕米尔大陆，风与草海的低语之地。")
    narrate("商道横穿草海，连接着王国与北方的港口。千百年来，旅人们在这里相遇，又在这里道别。")
    wait(2.0)
    narrate("这一天，十字路口，三位素未谋面的旅人，相遇了。")
    wait(1.5)
    at(T, type="camera", name="wide", transition=1.0)
    at(T, type="move", actor="feng", to=[-2.6, 0, -5], duration=4.0)
    at(T, type="move", actor="xue", to=[2.6, 0, -5], duration=4.0)
    at(T, type="move", actor="ye", to=[0, 0, -3.8], duration=4.0)
    wait(4.6)
    at(T, type="camera", name="feng_close", transition=0.7)
    at(T, type="anim", actor="feng", anim="avatar_hello")
    say("feng", "你们好呀！我叫阿风，第一次走这条商道，差点在草海里迷路。")
    at(T, type="camera", name="xue_close", transition=0.7)
    at(T, type="anim", actor="xue", anim="avatar_bow")
    say("xue", "欢迎，阿风。我叫雪，受商会之托，要前往北方的望风塔。")
    at(T, type="camera", name="ye_close", transition=0.7)
    at(T, type="anim", actor="ye", anim="avatar_salute")
    say("ye", "护卫，夜。前面的路不太平，人多有个照应。")
    at(T, type="anim", actor="feng", anim="avatar_point_you")
    say("feng", "诶？夜先生看起来好严肃，是不是不爱说话呀？", dur=3.0)
    at(T, type="anim", actor="ye", anim="avatar_no_head")
    say("ye", "……话不多，但算数。")
    at(T, type="camera", name="three_shot", transition=0.8)
    at(T, type="anim", actor="feng", anim="avatar_fist_pump")
    say("feng", "那就说定了，一起走吧！目的地，望风塔！")
    narrate("就这样，三个人的旅途开始了。")
    wait(2.0)

    # ============ 第二章 启程（白天行路） ============
    at(T, type="camera", pos=[0, 5, 10], look=[0, 1, -4], transition=1.2)
    at(T, type="move", actor="feng", to=[-3, 0, -5], duration=6.0)
    at(T, type="move", actor="xue", to=[0, 0, -6], duration=6.0)
    at(T, type="move", actor="ye", to=[3, 0, -5], duration=6.0)
    wait(2.0)
    narrate("草海的风带着初夏的味道。路还很长，说说笑笑，倒也不闷。")
    wait(4.5)
    at(T, type="camera", name="three_shot", transition=0.6)
    say("xue", "说起来，阿风为什么一个人旅行？家里不担心吗？")
    at(T, type="anim", actor="feng", anim="avatar_point_me")
    say("feng", "因为我想写一本《帕米尔见闻录》！把大陆每个角落都走一遍！")
    say("ye", "……志向不小。前面那段路，前几日刚有商队遇袭。")
    at(T, type="anim", actor="xue", anim="avatar_express_worry")
    say("xue", "所以，还是跟夜先生搭伴比较稳妥。")
    wait(1.0)
    at(T, type="camera", pos=[6, 2, 2], look=[0, 1.2, -5], transition=1.0)
    at(T, type="move", actor="feng", to=[-2, 0, -8], duration=6.0)
    at(T, type="move", actor="xue", to=[0.5, 0, -9], duration=6.0)
    at(T, type="move", actor="ye", to=[3, 0, -8], duration=6.0)
    wait(6.4)
    narrate("走过缓坡，草海深处传来风铃声——那是挂在旧路标上的护身符。")
    wait(2.0)
    at(T, type="camera", name="feng_close", transition=0.8)
    at(T, type="anim", actor="feng", anim="avatar_express_surprise")
    say("feng", "你们听！风铃的声音！老话说是旅人的守护灵在打招呼！")
    at(T, type="camera", name="three_shot", transition=0.8)
    say("xue", "但愿这位守护灵，也能保佑我们的货物。")
    say("ye", "守护灵不管强盗。管强盗的是我。")
    at(T, type="anim", actor="feng", anim="avatar_express_laugh")
    say("feng", "噗——夜先生偶尔说话，还挺好笑的。")
    wait(1.0)
    at(T, type="camera", pos=[-6, 2, 2], look=[0, 1.2, -8], transition=1.0)
    at(T, type="move", actor="feng", to=[-1, 0, -11], duration=6.0)
    at(T, type="move", actor="xue", to=[1, 0, -12], duration=6.0)
    at(T, type="move", actor="ye", to=[3, 0, -11], duration=6.0)
    wait(6.4)
    narrate("草海一望无际，走过的路很快就被风抹平了痕迹。")
    wait(1.5)
    at(T, type="camera", name="wide", transition=0.9)
    say("ye", "翻过前面那道坡，就是旧王国的地界。")
    say("feng", "旧王国……见闻录里写过！一千年前的商路，就是从那里开始的！")
    at(T, type="camera", name="far", transition=1.0)
    narrate("远处的地平线上，断裂的石柱静静立在夕阳里。那便是旧王国的废墟。")
    wait(2.5)
    at(T, type="anim", actor="xue", anim="avatar_point_you")
    say("xue", "看，废墟到了。今晚就在那里过夜。")
    wait(1.5)

    # ============ 第三章 废墟之舞（黄昏） ============
    at(T, type="environment", preset="sunset")
    at(T, type="camera", pos=[0, 2.5, 2], look=[0, 1.2, -6], transition=1.4)
    narrate("抵达废墟时，正值黄昏。金色的光染遍了每一块残石。")
    wait(2.0)
    say("ye", "就在这里扎营。石墙背风，天黑前把火生起来。")
    at(T, type="move", actor="feng", to=[-1.5, 0, -6], duration=2.5)
    at(T, type="move", actor="xue", to=[1.5, 0, -6], duration=2.5)
    at(T, type="move", actor="ye", to=[0, 0, -7], duration=2.5)
    wait(2.7)
    say("xue", "趁着天还没黑……要不要跳支舞？小时候跟商队的艺人学过。")
    at(T, type="camera", name="xue_close", transition=0.8)
    at(T, type="anim", actor="xue", anim="avatar_dance1")
    at(T, type="orbit", look=[1.5, 1.0, -6], radius=3.5, height=1.5, from_deg=0, to_deg=360, duration=14)
    wait(14.5)
    at(T, type="anim", actor="feng", anim="avatar_clap", loop=True)
    at(T, type="anim", actor="ye", anim="avatar_clap", loop=True)
    at(T, type="camera", name="three_shot", transition=0.8)
    say("feng", "雪你也太厉害了吧！转圈的时候裙摆都发光了！", dur=3.2)
    at(T, type="anim", actor="xue", anim="avatar_express_laugh")
    say("xue", "哈哈，都是很久之前的事啦，手法都生疏了。")
    say("ye", "（鼓掌）很少见到这么轻快的舞步。")
    at(T, type="camera", name="feng_close", transition=0.8)
    at(T, type="anim", actor="feng", anim="avatar_musclebeach")
    say("feng", "看好了，接下来是阿风的绝活！肌肉才是浪漫！", dur=3.0)
    at(T, type="orbit", look=[-1.5, 1.0, -6], radius=3.0, height=1.4, from_deg=180, to_deg=300, duration=8)
    wait(8.5)
    at(T, type="camera", name="three_shot", transition=0.8)
    at(T, type="anim", actor="xue", anim="avatar_express_wink")
    say("xue", "噗——阿风，你这算哪门子舞蹈呀。")
    at(T, type="camera", name="ye_close", transition=0.8)
    at(T, type="anim", actor="ye", anim="avatar_dance3")
    say("ye", "……那么，看好了。护卫的舞，只有一套。", dur=4.0)
    at(T, type="orbit", look=[0, 1.0, -6.2], radius=3.2, height=1.4, from_deg=30, to_deg=150, duration=10)
    wait(10.5)
    at(T, type="anim", actor="feng", anim="avatar_jumpforjoy")
    say("feng", "哇——夜先生深藏不露啊！！", dur=2.6)
    narrate("笑声惊起了栖息在石柱上的飞鸟。暮色四合，篝火升起来了。")
    wait(2.5)

    # ============ 第四章 暮色对谈（深黄昏） ============
    at(T, type="environment", preset="sunset",
       sun_deg=[-6, -80, 0], sun_energy=0.7, fog_density=0.012)
    at(T, type="camera", pos=[0, 1.8, 4.5], look=[0, 1.1, -6], transition=1.2)
    narrate("三个人围坐在篝火旁，分享着干粮和各自的故事。")
    at(T, type="move", actor="feng", to=[-1.2, 0, -5.2], duration=2.0)
    at(T, type="move", actor="ye", to=[1.2, 0, -5.2], duration=2.0)
    wait(2.4)
    at(T, type="camera", name="ye_close", transition=0.8)
    at(T, type="anim", actor="ye", anim="avatar_cross_arms")
    say("ye", "雪小姐是商会的人，为什么会亲自跑这么远的路？")
    at(T, type="camera", name="xue_close", transition=0.8)
    say("xue", "这批货里，有一封要紧的信。要亲手交给望风塔的塔主。")
    say("xue", "信里写了什么，我也不知道。只知道，很多人都在等着它。")
    at(T, type="camera", name="feng_close", transition=0.8)
    at(T, type="anim", actor="feng", anim="avatar_nyanya")
    say("feng", "神秘！我最喜欢神秘的东西了！写书的时候一定用它当开头！")
    at(T, type="camera", name="three_shot", transition=0.8)
    at(T, type="anim", actor="ye", anim="avatar_no_head")
    say("ye", "……你的『最喜欢』，多半会让我们绕远路。")
    at(T, type="anim", actor="feng", anim="avatar_express_embarrased")
    say("feng", "哎呀，上次绕远路那只是意外啦！")
    at(T, type="camera", name="xue_close", transition=0.8)
    say("xue", "我的家乡在海边。出发前，母亲替我缝了这件衣服的领口。")
    at(T, type="anim", actor="xue", anim="avatar_express_afraid")
    say("xue", "她说，路上的风大。其实我知道，她是舍不得。")
    wait(1.0)
    at(T, type="camera", name="three_shot", transition=0.9)
    narrate("火光映在三张年轻的脸上。夜色，一点点落了下来。")
    wait(2.5)

    # ============ 第五章 夜话（夜晚） ============
    at(T, type="environment", preset="night")
    at(T, type="camera", pos=[0, 2.2, 5], look=[0, 1.1, -5.5], transition=1.5)
    narrate("夜风微凉，星空低垂。今夜的第一班岗，交给夜。")
    wait(2.5)
    at(T, type="camera", name="ye_close", transition=0.9)
    say("ye", "都睡吧。前半夜我来守。")
    wait(1.2)
    at(T, type="camera", name="xue_close", transition=1.0)
    say("xue", "夜先生……谢了。对了，你为什么做护卫这一行？")
    wait(0.8)
    at(T, type="camera", name="ye_close", transition=1.0)
    at(T, type="anim", actor="ye", anim="avatar_away")
    say("ye", "走过的地方多了，就会发现——有人等着你回去，是一件奢侈的事。")
    wait(0.6)
    say("ye", "护卫这行，护的其实不是货。是『归途』。")
    wait(1.2)
    at(T, type="camera", name="wide", transition=1.2)
    narrate("篝火渐渐矮了下去。远处的石柱在星空下，像沉默的巨人。")
    wait(3.0)
    at(T, type="camera", name="three_shot", transition=1.0)
    at(T, type="anim", actor="xue", anim="avatar_sit_ground", loop=True)
    wait(1.0)
    say("xue", "等这趟货送完……我想回家看看。")
    at(T, type="anim", actor="ye", anim="avatar_yes_head")
    say("ye", "嗯。到时候，顺路。")
    wait(1.5)
    at(T, type="camera", pos=[4, 2.5, 0], look=[0, 1.0, -5.5], transition=1.2)
    narrate("另一边，阿风抱着写了一半的见闻录，睡得口水都要流出来了。")
    wait(3.0)
    at(T, type="anim", actor="feng", anim="avatar_sleep")
    narrate("梦里，他的书已经印好了，扉页上写着：献给草海的风。")
    wait(3.0)

    # ============ 第六章 黎明告别（清晨） ============
    at(T, type="environment", preset="dawn")
    at(T, type="camera", pos=[0, 2.5, 2], look=[0, 1.2, -5.5], transition=1.5)
    narrate("东方泛起蟹壳青，新的一天来了。")
    wait(2.5)
    at(T, type="camera", name="feng_close", transition=0.8)
    at(T, type="anim", actor="feng", anim="avatar_stretch")
    say("feng", "唔啊——睡得真好！今天就能到望风塔了吧！")
    at(T, type="camera", name="three_shot", transition=0.8)
    at(T, type="anim", actor="ye", anim="avatar_salute")
    say("ye", "收拾一下，出发。趁露水没干，路好走。")
    at(T, type="anim", actor="xue", anim="avatar_bow")
    say("xue", "这一路，多谢两位照顾。信送到之后，我想请你们喝一杯热茶。")
    say("feng", "热茶就算了，要喝就喝庆功酒！", dur=2.8)
    say("ye", "……庆功酒，可以。")
    narrate("三人收拾行装，踏上了最后一段路。晨光把影子拉得很长。")
    at(T, type="camera", name="far", transition=1.2)
    at(T, type="move", actor="xue", to=[1, 0, -13], duration=7.0)
    at(T, type="move", actor="ye", to=[-1, 0, -13], duration=7.0)
    wait(7.4)
    at(T, type="move", actor="feng", to=[0, 0, -11], duration=6.0)
    wait(2.0)
    at(T, type="anim", actor="feng", anim="avatar_hello")
    wait(2.6)
    narrate("阿风小跑几步，追上了前面的两个人。")
    wait(2.5)
    at(T, type="orbit", look=[0, 1.0, -8], radius=10, height=3.0, from_deg=0, to_deg=210, duration=24)
    narrate("帕米尔的黎明，和昨天一样明亮。")
    narrate("风还在吹，路还在脚下。而他们的故事，才刚刚开始。")
    wait(12.0)
    at(T, type="camera", pos=[0, 14, 20], look=[0, 0, -10], transition=3.0)
    wait(6.0)
    at(T, type="end")

    # 按 (时间, 原始顺序) 排序输出
    EV.sort(key=lambda e: (e["t"], e["_seq"]))
    for e in EV:
        e.pop("_seq")
    here = os.path.dirname(__file__)
    with open(os.path.join(here, "..", "story_10min.json"), "w", encoding="utf-8") as f:
        json.dump(story, f, ensure_ascii=False, indent=1)
    with open(os.path.join(here, "lines_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(LINES, f, ensure_ascii=False, indent=1)
    src = "真实语音时长" if DURATIONS else "字数估算"
    print(f"剧本生成完成: {len(EV)} 个事件 / {len(LINES)} 句台词, 总时长约 {T:.0f} 秒 ({T/60:.1f} 分钟) [{src}]")


if __name__ == "__main__":
    main()
