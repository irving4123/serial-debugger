@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "C:\Users\Administrator\Desktop\SerialDebugger"
echo Installing electron-builder...
call npm install electron-builder --save-dev
echo Building EXE...
call npx --yes electron-builder --win --x64
echo Done!
pause
