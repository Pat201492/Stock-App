#!/usr/bin/env bash
# Stock-App self-installing updater (macOS / Linux)
# -------------------------------------------------
# One-liner:  curl -fsSL https://<your-host>/update.sh | bash
#
#   1. Install (git clone + venv + pip) if missing, else git pull
#   2. Refresh data (run.py + pol_refresh.py)
#   3. Publish live if VPS env vars are set, else build only.
#
# Config via env (export before running, or set in ~/.stockapp.env):
#   STOCKAPP_DIR           install dir (default: ~/stock-app)
#   STOCKAPP_VPS_HOST      e.g. 1.2.3.4 or stocks.example.com   (enables publish)
#   STOCKAPP_VPS_USER      default: stockapp
#   STOCKAPP_VPS_DATA      default: /opt/stockapp/data
#   STOCKAPP_VPS_SERVICE   default: stockapp
set -euo pipefail

REPO_URL="https://github.com/Pat201492/Stock-App.git"
DIR="${STOCKAPP_DIR:-$HOME/stock-app}"
[ -f "$HOME/.stockapp.env" ] && . "$HOME/.stockapp.env"

command -v git    >/dev/null || { echo "git not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }

if [ ! -d "$DIR/.git" ]; then
  echo "[update] Installing Stock-App to $DIR ..."
  git clone "$REPO_URL" "$DIR"
else
  echo "[update] Updating code in $DIR ..."
  git -C "$DIR" pull --ff-only
fi
cd "$DIR"

PY="$DIR/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "[update] Creating venv + installing dependencies ..."
  python3 -m venv .venv
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r requirements.txt
  "$PY" -m textblob.download_corpora 2>/dev/null || true
fi

echo "[update] Refreshing data ..."
PYTHONUTF8=1 "$PY" run.py
PYTHONUTF8=1 "$PY" pol_refresh.py

if [ -n "${STOCKAPP_VPS_HOST:-}" ]; then
  USER="${STOCKAPP_VPS_USER:-stockapp}"
  DATA="${STOCKAPP_VPS_DATA:-/opt/stockapp/data}"
  SVC="${STOCKAPP_VPS_SERVICE:-stockapp}"
  TARGET="$USER@$STOCKAPP_VPS_HOST"
  echo "[update] Publishing live to $TARGET ..."
  ssh "$TARGET" "mkdir -p $DATA/_incoming"
  scp stocks.db politicians.db "$TARGET:$DATA/_incoming/"
  ssh "$TARGET" "mv $DATA/_incoming/*.db $DATA/ && sudo systemctl restart $SVC"
  echo "[update] Live data updated."
else
  echo "[update] No STOCKAPP_VPS_HOST set - built locally only (no push)."
fi
echo "[update] Complete."
