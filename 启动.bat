@echo off
rem ============================================================
rem  One-click START: server (detached) + open workbench page
rem ============================================================
cd /d "%~dp0"

rem -- already running? skip --
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8642/api/list' -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
    echo Server already running.
    goto open
)

rem -- start server as a detached hidden process, log to file --
set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=C:\Users\dapanji\AppData\Local\Programs\Tuanjie Cowork\cli\bin\win32-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

powershell -NoProfile -Command "Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'server.mjs','8642' -WorkingDirectory '%~dp0story-director\viewer' -WindowStyle Hidden -RedirectStandardOutput '%~dp0server.log' -RedirectStandardError '%~dp0server.err'"

rem -- wait until ready (max 15s) --
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8642/api/list' -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 goto open
set /a tries+=1
if %tries% lss 15 goto wait

echo [FAIL] server did not start. See server.err
pause
exit /b 1

:open
start "" "http://localhost:8642/viewer/workbench.html"
echo [OK] server running - workbench opened in browser.
timeout /t 2 >nul
