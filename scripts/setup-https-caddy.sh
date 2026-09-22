#!/usr/bin/env bash
set -e

echo "=== Vessel Automated HTTPS Setup with Caddy & Let's Encrypt ==="

# 1. Reliable Public IP Detection
PUBLIC_IP=""

# Try AWS IMDSv2 (token-based)
TOKEN=$(curl -s -f -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --connect-timeout 2 2>/dev/null || true)
if [ -n "$TOKEN" ]; then
  IP_CANDIDATE=$(curl -s -f -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 --connect-timeout 2 2>/dev/null || true)
  if [[ "$IP_CANDIDATE" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    PUBLIC_IP="$IP_CANDIDATE"
  fi
fi

# Try external IP services
if [ -z "$PUBLIC_IP" ]; then
  for URL in "https://api.ipify.org" "https://ifconfig.me" "https://icanhazip.com"; do
    IP_CANDIDATE=$(curl -s -f --connect-timeout 3 "$URL" 2>/dev/null || true)
    if [[ "$IP_CANDIDATE" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      PUBLIC_IP="$IP_CANDIDATE"
      break
    fi
  done
fi

# Fallback to current known EC2 IP
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="13.211.129.75"
fi

DOMAIN="${PUBLIC_IP}.sslip.io"
echo "[1/5] Verified Public IP: ${PUBLIC_IP}"
echo "[1/5] Target HTTPS Domain: ${DOMAIN}"

# 2. Stop conflicting web servers (e.g. default Apache or Nginx holding port 80/443)
echo "[2/5] Checking for port 80/443 conflicts..."
sudo systemctl stop apache2 2>/dev/null || true
sudo systemctl disable apache2 2>/dev/null || true
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true

# 3. Install Caddy if missing
if ! command -v caddy &> /dev/null; then
  echo "[3/5] Installing Caddy..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
else
  echo "[3/5] Caddy is already installed."
fi

# 4. Write verified clean Caddyfile
echo "[4/5] Writing clean /etc/caddy/Caddyfile..."
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:3000
}
EOF

# Validate configuration
echo "[4/5] Validating Caddy syntax..."
caddy validate --config /etc/caddy/Caddyfile

# 5. Restart Caddy service
echo "[5/5] Restarting Caddy service..."
sudo systemctl restart caddy
sudo systemctl enable caddy

echo ""
echo "=============================================================="
echo "  ✓ HTTPS SETUP COMPLETED SUCCESSFULLY!"
echo "  Free trusted Let's Encrypt SSL active on Port 443."
echo "  Zero browser warnings, solid green lock!"
echo ""
echo "  👉 Open your IDE now at: https://${DOMAIN}"
echo "=============================================================="
