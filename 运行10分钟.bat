@echo off
rem 试播 10 分钟长剧《帕米尔的黎明》
"%~dp0godot\Godot_v4.7.2-stable_win64.exe" --path "%~dp0story-director" "++" "story=res://story_10min.json"
pause
