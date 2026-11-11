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
  if defined OPEN powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0open-app.ps1"
  exit /b
)
rem Get the latest version (skipped if git isn't installed or there's no internet).
where git >nul 2>nul && (
  git checkout -- dist >nul 2>nul
  git clean -fdq dist >nul 2>nul
  git pull -q >nul 2>nul
)
rem A ready-to-run copy (no git, already built): just start it.
if not exist ".git" if exist "dist\index.html" goto run
rem First run (or after an update that needs it): install the build tools.
if not exist "node_modules\esbuild" (
  echo Installing what LTTV needs to build ^(one time, about a minute^)...
  call npm install --no-audit --no-fund
)
echo Building LTTV...
node scripts\build.mjs >"%TEMP%\lttv-build.log" 2>&1
if errorlevel 1 (
  echo Installing missing build tools and trying again...
  call npm install --no-audit --no-fund
  node scripts\build.mjs >"%TEMP%\lttv-build.log" 2>&1
)
if errorlevel 1 (
  echo The build failed:
  type "%TEMP%\lttv-build.log"
  echo.
  echo Take a photo of this window and send it to Claude.
  pause
  exit /b 1
)
goto run
:run
rem ffmpeg makes raw channels (and Multiview) play smoothly; use it even if winget hasn't put it on PATH yet.
for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0find-ffmpeg.ps1"`) do set "FFMPEG=%%F"
if defined FFMPEG echo ffmpeg found: raw channels and Multiview play smoothly.
if not defined FFMPEG echo ffmpeg not found. For smoother Multiview run "Install ffmpeg (smoother Multiview).bat" in the windows folder.
echo LTTV is running at http://127.0.0.1:8787/  -  close this window to stop it.
rem Open LTTV in its own app window (Edge / Chrome) as soon as it is up.
if defined OPEN start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0open-app.ps1"
node server\server.mjs
