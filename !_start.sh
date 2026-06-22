#!/usr/bin/env sh
cd "$(dirname "$0")"
echo ""
echo "Countdown before start: config.yaml startCountdownSeconds (B=rebuild, Space=skip)"
echo "Open in browser after start:"
node scripts/print-prod-url.mjs
echo "(Keep this terminal running; port in config.yaml serverPort)"
echo "For development use: npm run dev"
echo ""
npm start
