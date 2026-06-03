@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo.
echo Countdown before start: config.json startCountdownSeconds (B=rebuild, Space=skip)
echo Open in browser after start:
node scripts/print-prod-url.mjs
echo (Keep this window running; port in config.json serverPort)
echo For development use: npm run dev
echo.
call npm start
pause
