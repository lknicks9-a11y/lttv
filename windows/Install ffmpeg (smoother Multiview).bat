@echo off
rem Installs ffmpeg (free) with Windows' own installer, winget. With it, LTTV on this computer plays raw TV
rem channels natively, which makes Multiview much smoother.
where winget >nul 2>nul || (echo winget isn't available on this computer. Get ffmpeg from https://www.gyan.dev/ffmpeg/builds/ instead. & pause & exit /b 1)
echo Installing ffmpeg...
winget install --id Gyan.FFmpeg -e --silent
echo.
echo Done. Close the LTTV window if it's open, then open LTTV again.
pause
