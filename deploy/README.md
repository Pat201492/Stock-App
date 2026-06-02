# Deploy: build-local → push → VPS-serve

The heavy data pipeline runs on **your machine**; a cheap always-on VPS only
*serves* the finished SQLite DBs read-only. No yfinance/EDGAR ever runs on the
server, so hosting cost ≈ the VPS rent (~$4/mo) and nothing else.

```
LOCAL (build) ──scp ~57MB + ssh swap──▶ VPS (Caddy TLS → uvicorn, READ_ONLY)
```

## 1. One-time VPS setup (Hetzner / any Ubuntu box)
SSH in as root, then:
```bash
sudo DOMAIN=stocks.example.com bash <(curl -fsSL https://raw.githubusercontent.com/Pat201492/Stock-App/master/deploy/setup_vps.sh)
```
- Installs Python venv, the `stockapp` systemd service (with `READ_ONLY=1`),
  Caddy (auto-HTTPS), a firewall, and passwordless `systemctl restart stockapp`
  for the deploy user.
- **No domain yet?** Omit `DOMAIN=...` to serve plain HTTP on `:80`. For free TLS
  without buying a domain, point a [DuckDNS](https://www.duckdns.org) name (or use
  `<ip>.sslip.io`) at the server and re-run with `DOMAIN=...`.
- Add your local machine's SSH **public** key to `stockapp`'s
  `~/.ssh/authorized_keys` so unattended publishing works.

## 2. One-time local setup (Windows)
```powershell
copy publish.config.ps1.example publish.config.ps1
# edit publish.config.ps1: set $VPS_HOST, $VPS_USER, $SSH_KEY
.\publish.ps1                       # build data + push live
.\deploy\schedule_publish.ps1       # register the daily auto-publish task
```
Change the update cadence by editing the two lines at the top of
`deploy/schedule_publish.ps1` (Daily/Weekly + time) and re-running it.

## 3. Updating from any machine (self-installing one-liner)
The site serves a bootstrap updater. On a machine that may not have the app
installed, run:
```powershell
irm https://stocks.example.com/update.ps1 | iex     # Windows
```
```bash
curl -fsSL https://stocks.example.com/update.sh | bash   # macOS / Linux
```
It clones + builds the app if missing (or `git pull`s), refreshes the data, and
— if `publish.config.ps1` (Windows) or `STOCKAPP_VPS_HOST` (sh) is present —
pushes it live and swaps it in. Machines without the SSH key just build locally
(they can't push). The site's **Update data** page shows this command.

## Fed page (optional)
The `/fed` page (rates, inflation, unemployment, yield curve, FOMC calendar, Fed
news) needs a free **FRED API key** — get one at
<https://fred.stlouisfed.org/docs/api/api_key.html>, set `FRED_API_KEY` in
`deploy/stockapp.service` (or local env), and restart. Without it the page shows
a "configure key" notice instead of erroring.

## Account data & auth
Favorites + paper trading require an **email + password** account (rest of the
site is public). Passwords are PBKDF2-hashed; sessions are 30-day random tokens —
serve over HTTPS (Caddy) so tokens aren't exposed. Data lives in a **separate
`accounts.db`** (`ACCOUNTS_DB_PATH`); `publish.ps1` only swaps
`stocks.db`/`politicians.db`, so accounts persist across data pushes. Back it up.
- `APP_BASE_URL` — base for password-reset links.
- `SMTP_HOST/PORT/USER/PASS/FROM` — optional; if set, reset links are emailed,
  else the link is shown to the user (dev fallback).

## Notes
- `READ_ONLY=1` on the server disables `POST /api/pipeline/run` and
  `POST /api/pol/refresh` (returns 403) so no one can trigger heavy compute on
  the VPS. All GET/read endpoints work normally.
- Publishing is atomic: DBs land in `data/_incoming/`, then `mv` into place and
  the service restarts so SQLite reopens cleanly (no half-written reads).
- **Fly.io is retired** in favour of this VPS. `fly.toml` / `Dockerfile` remain
  in the repo for reference but are unused.
