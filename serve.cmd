@echo off
setlocal
cd /d "%~dp0"
set "PORT=4173"

echo Pomodoro Paper Workbench
echo Open http://localhost:%PORT%/index.html?fresh=20260624-daily-records
echo Press Ctrl+C to stop the server.
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server %PORT% --bind 127.0.0.1
) else (
  python -m http.server %PORT% --bind 127.0.0.1
)
