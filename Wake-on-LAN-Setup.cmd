@echo off
rem Needs administrator rights (to change the network card settings). Asks Windows if it does not have them yet.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
chcp 65001 >nul
title Remote Start PC - Get this PC ready to be started over the network
call "%~dp0scripts\run.cmd" wake-setup.mjs
echo.
pause
