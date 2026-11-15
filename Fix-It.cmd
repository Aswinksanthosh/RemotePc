@echo off
chcp 65001 >nul
title Remote Start PC - Fix-It
call "%~dp0scripts\run.cmd" doctor.mjs
echo.
pause
