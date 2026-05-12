#!/usr/bin/env sh
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
echo ""
echo "启动完成后打开 http://localhost:3366/ （须保持本终端运行）"
echo ""
npm run dev
