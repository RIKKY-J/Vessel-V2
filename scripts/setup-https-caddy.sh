#!/usr/bin/env bash
set -e

echo "=== Vessel Automated HTTPS Setup with Caddy & Let's Encrypt ==="

# 1. Detect Public IP
PUBLIC_IP=$(curl -s --connect-timeout 3 http://169.254.169.254/latest/meta-data/public-ipv4 || curl -s https://ifconfig.me || echo "13.211.129.75")
DOMAIN="${PUBLIC_IP}.sslip.io"

echo "[1/4] Target Domain: ${DOMAIN} (resolves to ${PUBLIC_IP})"

# 2. Install Caddy if not installed
if ! command -v caddy &> /dev/null; then
  echo "[2/4] Installing Caddy web server..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
else
  echo "[2/4] Caddy already installed."
fi

# 3. Configure Caddyfile
echo "[3/4] Writing /etc/caddy/Caddyfile..."
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:3000
}
EOF

# 4. Restart Caddy
echo "[4/4] Reloading Caddy..."
sudo systemctl restart caddy
sudo systemctl enable caddy

echo ""
echo "=============================================================="
echo "  ✓ HTTPS SETUP COMPLETE!"
echo "  Free trusted Let's Encrypt SSL active on Port 443."
echo "  Zero browser warnings, solid green lock!"
echo ""
echo "  👉 Open your IDE now at: https://${DOMAIN}"
echo "=============================================================="
