@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   1. Install the LTS version from https://nodejs.org ^(opening it now^)
  echo   2. Then double-click start-windows.bat again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo   Using Node.js %%v
node server.js
echo.
echo   Server stopped.
pause
