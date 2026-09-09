@echo off
cd /d "%~dp0story-director\viewer"
start "server" /min "C:\Users\dapanji\AppData\Local\Programs\Tuanjie Cowork\cli\bin\win32-x64\node.EXE" server.mjs 8642
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:8642/viewer/workbench.html"
