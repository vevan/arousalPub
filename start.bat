@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo.
echo 启动完成后在浏览器打开 http://localhost:3366/ （须保持本窗口运行）
echo.
call npm run dev
pause
