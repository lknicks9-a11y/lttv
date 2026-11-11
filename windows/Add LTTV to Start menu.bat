@echo off
rem Puts LTTV in the Start menu, so you can open it by typing "LTTV" in Windows search.
rem Optionally starts LTTV when you sign in to Windows, so http://127.0.0.1:8787 always works in your browser.
cd /d "%~dp0"
set "TARGET=%~dp0Start LTTV.bat"
set "ICON=%~dp0lttv.ico"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Programs')+'\LTTV.lnk'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%ICON%'; $s.WindowStyle=7; $s.Description='LTTV'; $s.Save()"
echo.
echo Done. Press the Windows key, type LTTV and press Enter to open it.
echo.
choice /c YN /m "Also start LTTV every time you sign in to Windows"
if errorlevel 2 goto end
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\LTTV.lnk'); $s.TargetPath='%TARGET%'; $s.Arguments='background'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%ICON%'; $s.WindowStyle=7; $s.Save()"
echo LTTV will start when you sign in. Then just go to http://127.0.0.1:8787 in your browser.
:end
echo.
where ffmpeg >nul 2>nul && goto done
choice /c YN /m "Install ffmpeg too (free; makes Multiview much smoother)"
if errorlevel 2 goto done
winget install --id Gyan.FFmpeg -e --silent
:done
echo.
pause
