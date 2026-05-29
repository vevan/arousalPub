#!/usr/bin/env sh
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
echo ""
echo "启动完成后打开 $(node scripts/print-dev-url.mjs) （须保持本终端运行；端口见 config.json）"
echo ""
npm run dev
