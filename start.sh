#!/usr/bin/env sh
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
echo ""
echo "Countdown before start: config.json startCountdownSeconds (B=rebuild, Space=skip)"
echo "Open in browser after start:"
node scripts/print-prod-url.mjs
echo "(Keep this terminal running; port in config.json serverPort)"
echo "For development use: npm run dev"
echo ""
npm start
