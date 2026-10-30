@echo off
rem Builds the app from the current sources. Pass -run to start it afterwards.
rem   build.cmd          build only
rem   build.cmd -run     build, then launch the fresh exe
setlocal
cd /d "%~dp0"

set RUN=0
:args
if "%~1"=="" goto argsdone
if /i "%~1"=="-run" (set RUN=1) else if /i "%~1"=="--run" (set RUN=1) else if /i "%~1"=="/run" (set RUN=1) else if /i "%~1"=="run" (set RUN=1) else (
  echo Unknown argument: %~1 ^(usage: build.cmd [-run]^) 1>&2
  exit /b 2
)
shift
goto args
:argsdone

if not exist node_modules (
  echo ==^> Installing dependencies
  call npm ci || exit /b 1
)

rem A running instance locks the exe and the link step fails.
taskkill /im jira-auto-logger.exe /f >nul 2>&1

rem --no-bundle: just the release exe. Installers need the updater signing
rem key and are built by the release workflow.
echo ==^> Building
call npm run build -- --no-bundle || exit /b 1

set BIN=src-tauri\target\release\jira-auto-logger.exe
echo ==^> Built %BIN%

if "%RUN%"=="1" (
  echo ==^> Starting
  start "" "%BIN%"
)
endlocal
