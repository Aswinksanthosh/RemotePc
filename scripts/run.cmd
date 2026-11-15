@echo off
rem Runs one of the tools in the bin folder with Node.js, even right after Node.js was installed
rem (Windows programs started from the Start menu may not know the new PATH yet).
rem Usage: run.cmd <tool.mjs> [arguments]
setlocal
rem Leave the program folder first: Windows will not rename a folder that a program is standing in (updates replace it).
cd /d "%USERPROFILE%"
set "NODE="
for %%N in (node.exe) do set "NODE=%%~$PATH:N"
if defined NODE goto found
if exist "%ProgramW6432%\nodejs\node.exe" set "NODE=%ProgramW6432%\nodejs\node.exe"
if defined NODE goto found
echo Node.js was not found on this PC. Double-click Install.cmd first.
exit /b 9009
:found
"%NODE%" "%~dp0..\bin\%~1" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
