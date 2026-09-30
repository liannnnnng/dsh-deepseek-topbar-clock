@echo off
setlocal
chcp 65001 >nul
title Restart DSH Desktop (activate dsh-deepseek-topbar-clock)
set "EXE=D:\Program Files\DSH Desktop\DeepSeek Harness.exe"
set "PLUGIN=%~dp0"
set "LOG=%PLUGIN%last-verify.log"

echo ============================================================
echo  1/3  Stopping DSH Desktop ...
echo ============================================================
taskkill /IM "DeepSeek Harness.exe" /T /F >nul 2>&1
for /l %%i in (1,1,30) do (
  tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
  if errorlevel 1 goto stopped
  timeout /t 1 /nobreak >nul
)
:stopped
timeout /t 2 /nobreak >nul

echo ============================================================
echo  2/3  Starting DSH Desktop ...
echo ============================================================
start "" "%EXE%"
for /l %%i in (1,1,60) do (
  powershell -NoProfile -Command "try{Invoke-WebRequest -Uri http://127.0.0.1:19387/favicon.svg -TimeoutSec 2 -UseBasicParsing|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
  if not errorlevel 1 goto up
  timeout /t 1 /nobreak >nul
)
:up
timeout /t 2 /nobreak >nul

echo ============================================================
echo  3/3  Verifying plugin ...
echo ============================================================
call "%PLUGIN%tools\verify.bat" <nul > "%LOG%" 2>&1
type "%LOG%"
echo.
echo Full log: %LOG%
echo Switch back to the app window and press Ctrl+F5 to reload the page.
pause