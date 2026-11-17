@echo off
chcp 65001 >nul
title Remote Start PC - PIN
call "%~dp0scripts\run.cmd" pin.mjs %*
echo.
pause
