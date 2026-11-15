@echo off
chcp 65001 >nul
title Remote Start PC - Update
call "%~dp0scripts\run.cmd" update.mjs %*
echo.
pause
