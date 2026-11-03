@echo off
rem Starts LTTV on this computer and opens it in your browser.
rem The black window runs LTTV (it starts minimized). Close it to stop LTTV.
set "OPEN=--open"
if "%~1"=="background" set "OPEN="
if "%~2"=="background" set "OPEN="
if not "%~1"=="min" (
  start "LTTV" /min cmd /c ""%~f0" min %~1"
  exit /b
)
title LTTV - close this window to stop LTTV
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b 1)
rem Already running? Just open it.
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8787/api/caps) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  if defined OPEN start "" http://127.0.0.1:8787/
  exit /b
)
rem Get the latest version (skipped if git isn't installed or there's no internet).
where git >nul 2>nul && (
  git checkout -- dist >nul 2>nul
  git clean -fdq dist >nul 2>nul
  git pull -q >nul 2>nul
)
echo Building LTTV...
node scripts\build.mjs >nul 2>nul || (echo The build failed. Run "node scripts\build.mjs" in this folder to see why. & pause & exit /b 1)
echo LTTV is running at http://127.0.0.1:8787/  -  close this window to stop it.
node server\server.mjs %OPEN%
