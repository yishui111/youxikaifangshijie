@echo off
rem 把剧本渲染成视频文件 render\movie.avi（Movie Maker 离线渲染，非录屏）
"%~dp0godot\Godot_v4.7.2-stable_win64_console.exe" --path "%~dp0story-director" --fixed-fps 30 --write-movie "%~dp0story-director\render\movie.avi" ++ movie
pause
