#!/usr/bin/env bash
set -e

echo "=== Vessel Direct Node.js HTTPS Setup (Port 3000) ==="

cd "$(dirname "$0")/../frontend"

# Generate certificates
node scripts/setup-ssl.js

echo "Restarting Vessel server with HTTPS..."
if command -v pm2 &> /dev/null; then
  pm2 restart all || pm2 start server.js --name vessel
else
  echo "Please start your server: npm start"
fi

echo "✓ Vessel running on HTTPS!"
