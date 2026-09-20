@echo off
chcp 936 >nul
cd /d "%~dp0story-director\viewer"

rem ---- 找 Node：系统 PATH → 常见安装目录 → 本机 Tuanjie（兜底） ----
set "NODE="
for %%i in (node.exe) do if not defined NODE set "NODE=%%~$PATH:i"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\Tuanjie Cowork\cli\bin\win32-x64\node.EXE" set "NODE=%LocalAppData%\Programs\Tuanjie Cowork\cli\bin\win32-x64\node.EXE"
if not defined NODE (
    echo [错误] 没找到 node.exe。请安装 Node.js 18+ 后重试。
    pause
    exit /b 1
)

start "server" /min "%NODE%" server.mjs 8642
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:8642/viewer/workbench.html"
