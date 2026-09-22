#!/usr/bin/env bash
set -e

echo "=== Switching to Option B: Direct HTTPS on Port 3000 ==="

# 1. Stop and disable Caddy (Option A cleanup)
echo "[1/3] Stopping and disabling Caddy service..."
sudo systemctl stop caddy 2>/dev/null || true
sudo systemctl disable caddy 2>/dev/null || true

# 2. Generate SSL certificates for Port 3000
echo "[2/3] Generating SSL Certificates..."
cd "$(dirname "$0")/../frontend"
PUBLIC_IP="13.211.129.75" node scripts/setup-ssl.js

# 3. Restart PM2 or Node server
echo "[3/3] Restarting Vessel with native HTTPS on port 3000..."
if command -v pm2 &> /dev/null; then
  pm2 restart all || pm2 start server.js --name vessel
  pm2 save
else
  echo "pm2 not found. You can start the server with: npm start"
fi

echo ""
echo "======================================================"
echo "  ✓ OPTION B DIRECT HTTPS IS ACTIVE ON PORT 3000!"
echo ""
echo "  👉 Access your IDE now at: https://13.211.129.75:3000"
echo "======================================================"
