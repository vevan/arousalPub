@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo.
echo 启动前倒计时见 config.json 的 startCountdownSeconds（按 R 可重新 build）
echo 启动完成后在浏览器打开:
node scripts/print-prod-url.mjs
echo （须保持本窗口运行；端口见 config.json serverPort）
echo 开发模式请使用: npm run dev
echo.
call npm start
pause
