@echo off
title Remote Start PC - Install
echo.
echo  Remote Start PC - installer
echo  Windows will ask you one question. Please answer Yes.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
