@echo off
chcp 65001 >nul
title Remote Start PC - Pair a phone
call "%~dp0scripts\run.cmd" pair.mjs %*
echo.
pause
