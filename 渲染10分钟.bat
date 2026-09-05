@echo off
rem 把 10 分钟长剧渲染成视频 render\movie_10min.avi
"%~dp0godot\Godot_v4.7.2-stable_win64_console.exe" --path "%~dp0story-director" --fixed-fps 30 --write-movie "%~dp0story-directorender\movie_10min.avi" "++" "story=res://story_10min.json" "movie"
pause
