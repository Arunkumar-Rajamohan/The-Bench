@echo off
cd /d "%~dp0"
node backup/backup.js %*
echo.
pause
