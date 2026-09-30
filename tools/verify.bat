@echo off
setlocal
title Verify dsh-deepseek-topbar-clock
set "PLUGIN=%~dp0.."
call "%PLUGIN%\tools\node.cmd" "%PLUGIN%\tools\verify.mjs" %*
echo.
pause