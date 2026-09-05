# -*- coding: utf-8 -*-
"""
TTS 配音合成：读取 gen_long_story.py 产出的 lines_manifest.json，
用 Windows 自带的中文语音（Microsoft Huihui）合成每个角色的台词，
并测量真实时长写入 line_durations.json（供剧本生成器第二轮使用）。

三个角色用不同语速区分声线：
  风 rate=+2（活泼）  雪 rate=0（平稳）  夜 rate=-2（低沉缓慢）

用法：python make_voices.py
"""

import json
import os
import subprocess
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.abspath(os.path.join(HERE, ".."))
VOICE_DIR = os.path.join(PROJ, "voice")
PS1 = os.path.join(HERE, "make_voices.ps1")

RATES = {"feng": 2, "xue": 0, "ye": -2}
VOICE_NAME = "Microsoft Huihui Desktop"

# 示例短剧《初遇》的台词（story.json 引用 tts_DEMO*.wav）
DEMO_LINES = [
    {"id": "DEMO1", "actor": "feng", "text": "你们好！我叫小风，是第一次来到帕米尔大陆。"},
    {"id": "DEMO2", "actor": "xue", "text": "欢迎你，小风。我叫雪，这位是夜，我们在这里等你很久了。"},
    {"id": "DEMO3", "actor": "ye", "text": "你好。旅途才刚刚开始，请多指教。"},
]


def build_ps1(lines):
    out = ["Add-Type -AssemblyName System.Speech",
           "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
           f"$s.SelectVoice('{VOICE_NAME}')",
           "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050,"
           " [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,"
           " [System.Speech.AudioFormat.AudioChannel]::Mono)"]
    for ln in lines:
        rate = RATES.get(ln["actor"], 0)
        wav = os.path.join(VOICE_DIR, f"tts_{ln['id']}.wav")
        text = ln["text"].replace("'", "''")
        out.append(f"$s.Rate = {rate}")
        out.append(f"$s.SetOutputToWaveFile('{wav}', $fmt)")
        out.append(f"$s.Speak('{text}')")
    out.append("$s.SetOutputToWaveFile($null)")
    out.append("$s.Dispose()")
    out.append("Write-Output 'TTS-DONE'")
    return "\n".join(out)


def wav_duration(path):
    try:
        with wave.open(path, "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return None


def main():
    with open(os.path.join(HERE, "lines_manifest.json"), encoding="utf-8") as f:
        lines = json.load(f)
    all_lines = lines + DEMO_LINES
    os.makedirs(VOICE_DIR, exist_ok=True)

    # 写 PS1（UTF-8 BOM，保证 PowerShell 5.1 正确读中文）
    with open(PS1, "w", encoding="utf-8-sig") as f:
        f.write(build_ps1(all_lines))

    print(f"合成 {len(all_lines)} 句台词（Huihui 中文语音）...")
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                        "-File", PS1], capture_output=True, timeout=600)
    out = (r.stdout or b"").decode("gbk", errors="replace") + (r.stderr or b"").decode("gbk", errors="replace")
    if "TTS-DONE" not in out:
        print("STDOUT:", out[-500:])
        raise SystemExit("TTS 合成失败")

    durations = {}
    ok = 0
    for ln in all_lines:
        wav = os.path.join(VOICE_DIR, f"tts_{ln['id']}.wav")
        d = wav_duration(wav)
        if d:
            durations[ln["id"]] = round(d, 2)
            ok += 1
    with open(os.path.join(HERE, "line_durations.json"), "w", encoding="utf-8") as f:
        json.dump(durations, f, ensure_ascii=False, indent=1)
    total = sum(durations.values())
    print(f"完成: {ok}/{len(all_lines)} 句, 总语音时长 {total:.0f} 秒")


if __name__ == "__main__":
    main()
