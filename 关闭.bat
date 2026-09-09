@echo off
rem ============================================================
rem  One-click STOP: kill the story-director server (port 8642)
rem  Only this server is stopped. Other programs are not touched.
rem ============================================================
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8642" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%p >nul 2>nul
    set FOUND=1
)
if %FOUND%==1 (
    echo [OK] server stopped.
) else (
    echo server was not running.
)
ping -n 3 127.0.0.1 >nul
