# Stock-App — Feature Sheet

Single-page map of the app for the next contributor. Equity research **screener** + **congressional/insider trade surveillance** + **news & sentiment**, served by FastAPI with two SQLite DBs, deployed on Fly.io.

## Run locally
```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
python -m textblob.download_corpora        # sentiment corpora
python server.py                           # http://localhost:8000 (auto-opens browser)
```
- **Windows gotcha:** set `PYTHONUTF8=1` before `run.py` / `pol_refresh.py`. Their logs print emoji (▶ ✅ 🎉); the default cp1252 console codec raises `UnicodeEncodeError` without UTF-8 mode.
- Port: `PORT` env (default 8000 local, 8080 in Docker/Fly). `IS_LOCAL` (PORT 8000 + no `FLY_APP_NAME`) auto-opens a browser.

## Pipelines — TWO separate runners
| Runner | Scripts | Scheduled? |
|--------|---------|-----------|
| `run.py` | universe → fundamentals → model → news | ✅ via `scheduler.py` (Fly cron 2am UTC) |
| `pol_refresh.py` | committees + congress + insider_mirror (default); `--edgar` slow backfill; `--full` | ❌ **NOT scheduled / NOT in run.py** |

> ⚠️ **Known gap:** `pol_refresh.py` is never invoked by `run.py` or `scheduler.py`, so congressional/insider tables stay empty until run by hand (`python pol_refresh.py`) or via `POST /api/pol/refresh`. **Recommend** adding a `pol_refresh.py` step to `scheduler.py` (or to `run.py`) to automate it.

`run.py` flags: `--skip-universe`, `--from <script>`. `pol_refresh.py` flags: `--full`, `--congress`, `--senate` (legacy), `--edgar` (slow, 2014→now Form 4), `--mirror`, `--committees`.

## Pipeline scripts
- **universe.py** → `stocks`. Discover ~2500 largest stocks (NASDAQ FTP + Wikipedia S&P + iShares ETF), enrich via yfinance. Writes `universe.json`.
- **fundamentals.py** → `fundamentals`. ~90 cols: income/CF/balance, ratios, CAGRs, Rule #1 checks, `data_quality`. Writes `fundamentals.json`.
- **model.py** → `valuations`. 3 models — DCF, Comps (peer medians), EPV/Graham — combined into `score_composite` (0–100) + `score_label`. Writes `model.json`.
- **news.py** → `news`, `price_history`. Latest yfinance articles + 1y prices per stock; TextBlob sentiment; stores article `summary`. Incremental (24h news / same-day price staleness gates).

## Ingest scripts (political/insider)
- **ingest_congress.py** → `congressional_trades` (+`politicians` stubs). House+Senate from Peez49/Informed-Trading CSV (~109k trades). Incremental by `trade_id`.
- **ingest_senate.py** → legacy Senate-only (timothycarambat JSON, frozen 2021). Only via `--senate`.
- **ingest_committees.py** → `committees`, `committee_memberships`, `politicians`. From unitedstates/congress-legislators YAML. Needs `pyyaml` (auto-installs).
- **ingest_edgar.py** → `insider_trades`. SEC EDGAR Form 4 full-index, 2014→now. Slow (one HTTP req/filing, 10 req/s). User-Agent required. Only via `--edgar`.
- **ingest_insider_mirror.py** → `insider_trades`. Recent ~12–30 days from nickhuangcyh/sec-insider-tracker daily JSON. Fast; default in `pol_refresh.py`.

## API routes (server.py)
**Pages (HTML):** `/` screener · `/stock/{ticker}` detail · `/static/news.html` news feed · `/distribution` · `/politicians` · `/politician/{bioguide_id}` · `/insiders` · `/audit` · `/debug`
**Health/stats:** `/api/health` · `/api/stats`
**Stocks:** `/api/stocks` (filter/sort/paginate) · `/api/stocks/{ticker}` · `/api/stocks/{ticker}/score` · `/api/sectors` · `/api/cap_sizes` · `/api/stats/distribution`
**Prices:** `/api/price/{ticker}` · `/api/live/price/{ticker}`
**News:** `/api/news` · `/api/news/{ticker}` · `/api/live/news/{ticker}` (Yahoo + Google RSS fallback). News dicts include `summary` (article body, used for the one-sentence "story" on the feed).
**Congressional:** `/api/pol/stats` · `/api/pol/trades` · `/api/pol/politician/{bioguide_id}` · `/api/pol/leaderboard` · `/api/pol/ticker/{ticker}` · `POST /api/pol/refresh` · `/api/pol/status`
**Insider:** `/api/insider/trades` · `/api/insider/ticker/{ticker}`
**Cross-tab:** `/api/trade_counts` (per-ticker pol/insider counts for the screener)
**Pipeline:** `GET /api/pipeline/status` · `POST /api/pipeline/run?from_script=` · `/api/pipeline/log`
**Audit/debug:** `/api/audit` · `/api/debug/health`

## Pages (static/)
`index.html` screener · `stock.html` detail (DCF/Comps/EPV, fundamentals, Chart.js price, news, trades) · `news.html` feed (sentiment word label + shortened title + one-sentence story; ticker/sentiment filters) · `politicians.html` + `politician_detail.html` · `insiders.html` · `distribution.html` · `audit.html` · `debug.html`

## Data model
**stocks.db** (`DB_PATH`, WAL): `stocks`, `fundamentals`, `valuations`, `news` (id, ticker, title, url, publisher, published_at, sentiment, **summary**), `price_history`.
**politicians.db** (`POL_DB_PATH`, WAL): `politicians`, `committees`, `committee_memberships`, `congressional_trades`, `insider_trades`, `pol_ticker_metadata`.
> `database.py::init_db()` runs `create_all()` + `_migrate()` (idempotent `ALTER TABLE` for columns added after a DB already exists, e.g. `news.summary`). Add future column adds there — `create_all()` will not alter existing tables.

## Data sources
yfinance (metadata/fundamentals/news/prices) · NASDAQ Trader FTP · Wikipedia S&P + iShares CSV · SEC EDGAR (Form 4) · Google News RSS · Peez49/Informed-Trading (congress) · unitedstates/congress-legislators (committees) · nickhuangcyh/sec-insider-tracker (recent insider).

## Config / deploy
- **Dockerfile:** python:3.12-slim, installs reqs, downloads TextBlob corpora, `EXPOSE 8080`, `CMD python server.py`.
- **fly.toml:** app `stock-app-pat`, region ewr, `/data` volume, env `PORT=8080 DB_PATH=/data/stocks.db POL_DB_PATH=/data/politicians.db`, health check `GET /api/health`, autostop/autostart.
- **requirements.txt:** yfinance, pandas, numpy, fastapi, uvicorn, sqlalchemy, textblob, httpx.
- **Env vars:** `PORT`, `DB_PATH`, `POL_DB_PATH`, `FLY_APP_NAME` (cloud detection).
- **JSON caches (gitignored-ish):** `universe.json`, `fundamentals.json` (+`_cache`), `model.json` (+`_cache`), `deepdive_tickers.json`.

## Known gaps / history
1. **pol_refresh not scheduled** — see warning above; run manually or wire into scheduler.
2. **Windows UTF-8** — `PYTHONUTF8=1` needed for pipeline scripts (emoji logging).
3. **yfinance news schema** — fields moved under `article["content"]` (title, `canonicalUrl.url`, `pubDate`, `summary`); `news.py::fetch_and_store_news` handles both new and legacy flat schema, and backfills `summary` onto pre-existing rows.
