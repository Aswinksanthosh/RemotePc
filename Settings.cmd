@echo off
chcp 65001 >nul
title Remote Start PC - Settings
call "%~dp0scripts\run.cmd" open-settings.mjs
exit /b
