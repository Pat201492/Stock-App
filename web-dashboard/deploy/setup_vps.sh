#!/usr/bin/env bash
# setup_vps.sh - one-time provisioning for a fresh Ubuntu/Debian VPS (e.g. Hetzner).
# Run as root:  curl -fsSL https://raw.githubusercontent.com/Pat201492/Stock-App/master/deploy/setup_vps.sh | DOMAIN=stocks.example.com bash
# or:           sudo DOMAIN=stocks.example.com bash deploy/setup_vps.sh
#
# Idempotent: safe to re-run. Sets up Python venv, systemd service, Caddy TLS,
# firewall, and a passwordless `systemctl restart stockapp` for the deploy user
# so the local publish step can swap data + restart over SSH.
set -euo pipefail

REPO_URL="https://github.com/Pat201492/Stock-App.git"
APP_DIR="/opt/stockapp"
APP_USER="stockapp"
DOMAIN="${DOMAIN:-}"

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3-venv python3-pip git ufw debian-keyring debian-archive-keyring apt-transport-https curl

# Caddy (official repo)
if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating $APP_USER user + $APP_DIR"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR/data/_incoming"

echo "==> Cloning / updating repo"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only || true
fi

echo "==> Python venv + dependencies"
if [ ! -x "$APP_DIR/.venv/bin/python" ]; then
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
"$APP_DIR/.venv/bin/python" -m pip install --quiet -r "$APP_DIR/requirements.txt"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Installing systemd service"
install -m 644 "$APP_DIR/deploy/stockapp.service" /etc/systemd/system/stockapp.service

echo "==> Allowing passwordless service restart for $APP_USER"
echo "$APP_USER ALL=(root) NOPASSWD: /bin/systemctl restart stockapp" > /etc/sudoers.d/stockapp
chmod 440 /etc/sudoers.d/stockapp

echo "==> Configuring Caddy"
if [ -n "$DOMAIN" ]; then
  sed "s/{\$DOMAIN}/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
else
  echo ":80 {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}" > /etc/caddy/Caddyfile
  echo "    (no DOMAIN set - serving HTTP only on :80; set DOMAIN and re-run for TLS)"
fi

echo "==> Firewall"
ufw allow 22/tcp  >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable   >/dev/null 2>&1 || true

echo "==> Starting services"
systemctl daemon-reload
systemctl enable --now stockapp
systemctl restart caddy

echo ""
echo "==> Done. Now push data from your local machine:  .\\publish.ps1"
echo "    Health check:  curl -s http://127.0.0.1:8080/api/health"
[ -n "$DOMAIN" ] && echo "    Public URL:    https://$DOMAIN"
