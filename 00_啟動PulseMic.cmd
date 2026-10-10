@echo off
setlocal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules;%ProgramFiles%\WindowsPowerShell\Modules"
chcp 65001 >nul
title PulseMic 本機語音監聽
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %*
if errorlevel 1 (
  echo.
  echo PulseMic 啟動失敗，請檢查上方訊息。
  pause
)
