@echo off
setlocal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules;%ProgramFiles%\WindowsPowerShell\Modules"
chcp 65001 >nul
title PulseMic 本機語音監聽
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" -PrepareOnly %*
set "micPrepareResult=%errorlevel%"
if "%micPrepareResult%"=="3" goto running
if not "%micPrepareResult%"=="0" goto failed
if /i "%~1"=="-CheckOnly" goto done
if not defined PULSEMIC_PORT set "PULSEMIC_PORT=3210"
start "" "http://localhost:%PULSEMIC_PORT%/console"
echo PulseMic CMD backend. Keep this window open. Ctrl+C stops the service.
node dist/server/server/index.js
if errorlevel 1 goto failed
goto done
:running
if not defined PULSEMIC_PORT set "PULSEMIC_PORT=3210"
start "" "http://localhost:%PULSEMIC_PORT%/console"
echo The existing backend remains in its original console.
goto done
:failed
echo PulseMic startup failed. Check the messages above.
pause
popd
exit /b 1
:done
popd
exit /b 0
