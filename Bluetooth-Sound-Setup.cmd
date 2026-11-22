@echo off
rem Needs administrator rights (to create two small Windows tasks). Asks Windows if it does not have them yet.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
chcp 65001 >nul
title Remote Start PC - Set up the Clear sound switch
call "%~dp0scripts\run.cmd" handsfree-setup.mjs
echo.
pause
