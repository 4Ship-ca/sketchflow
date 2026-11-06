@echo off
rem ==================================================================================================
rem  SketchFlow 3D setup for Windows
rem  1st run: makes SF3d_setup.env from SF3d_setup.env.template and opens it in Notepad. Fill it in.
rem  2nd run: checks Node.js 20+ - offers to install it with winget - then runs scripts\setup.mjs,
rem           which installs, sets up your AI apps and Ollama, and publishes, as the settings say.
rem  Options are passed on: SF3d_setup.bat --dry-run   shows the uploads without doing them
rem                         SF3d_setup.bat --yes       answers yes to every question
rem ==================================================================================================
setlocal EnableExtensions
title SketchFlow 3D setup
cd /d "%~dp0"

if not exist "scripts\setup.mjs" goto :notrepo
if exist "SF3d_setup.env" goto :havesettings

copy /y "SF3d_setup.env.template" "SF3d_setup.env" >nul
echo.
echo  Made SF3d_setup.env - your settings.
echo  Notepad opens it now: fill it in, save it, close Notepad,
echo  then run SF3d_setup.bat again.
echo.
start "" notepad "SF3d_setup.env"
pause
exit /b 0

:havesettings
set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto :checkversion
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE=%ProgramFiles%\nodejs\node.exe"
  set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
  goto :checkversion
)
echo.
echo  Node.js 20 or newer is needed and is not installed.
where winget >nul 2>nul
if errorlevel 1 goto :nonode
choice /c YN /m " Install Node.js LTS now with winget"
if errorlevel 2 goto :nonode
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if not exist "%ProgramFiles%\nodejs\node.exe" goto :nonode
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

:checkversion
"%NODE%" -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"
if not errorlevel 1 goto :run
for /f "delims=" %%v in ('"%NODE%" --version') do set "NODEV=%%v"
echo.
echo  Node.js %NODEV% is too old - SketchFlow needs 20 or newer.
echo  Update it from https://nodejs.org or with: winget upgrade OpenJS.NodeJS.LTS
goto :fail

:run
"%NODE%" "scripts\setup.mjs" --env "SF3d_setup.env" %*
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo  Setup finished. The full log is SF3d_setup.log.
) else if "%CODE%"=="2" (
  echo  Fix SF3d_setup.env as shown above, save it, and run SF3d_setup.bat again.
  start "" notepad "SF3d_setup.env"
) else (
  echo  Setup stopped - see the messages above and SF3d_setup.log, then run SF3d_setup.bat again.
)
pause
exit /b %CODE%

:nonode
echo.
echo  Install Node.js 20 or newer from https://nodejs.org - the LTS version -
echo  then close this window and run SF3d_setup.bat again.
goto :fail

:notrepo
echo.
echo  Run SF3d_setup.bat from the SketchFlow folder - the one with scripts\setup.mjs in it.
goto :fail

:fail
echo.
pause
exit /b 1
