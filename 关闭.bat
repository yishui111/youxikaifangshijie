@echo off
rem ============================================================
rem  One-click STOP: kill the story-director server only
rem  (matches by port 8642, does not touch other node apps)
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
timeout /t 2 >nul
