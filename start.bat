@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo.
for /f "delims=" %%u in ('node scripts/print-dev-url.mjs') do set DEV_URL=%%u
echo 启动完成后在浏览器打开 %DEV_URL% （须保持本窗口运行；端口见 config.json）
echo.
call npm run dev
pause
