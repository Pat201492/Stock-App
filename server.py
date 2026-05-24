"""
server.py — FastAPI web server for Stock Tracker
Run: python server.py
Dashboard: http://localhost:8000
"""
import os, subprocess, sys, threading, time
from datetime import datetime
from typing import Optional
import yfinance as yf

from fastapi import FastAPI, Depends, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text

from database import get_db, init_db, Stock, Fundamentals, Valuation, News, PriceHistory, SessionLocal
from data_utils import score_stock

app = FastAPI(title="Stock Tracker")
init_db()

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_pipeline_status = {
    "running": False, "last_run": None, "last_result": None,
    "current_script": None, "script_index": 0, "script_total": 4,
    "pct_overall": 0, "log_tail": [],
}


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.get("/")
def dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/stock/{ticker}")
def stock_page(ticker: str):
    return FileResponse(os.path.join(STATIC_DIR, "stock.html"))


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    try:
        db = next(get_db())
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "db":     "ok" if db_ok else "error",
        "time":   datetime.utcnow().isoformat(),
    }


@app.get("/api/stats")
def stats(db: Session = Depends(get_db)):
    total_stocks   = db.query(func.count(Stock.ticker)).scalar() or 0
    total_with_val = db.query(func.count(Valuation.ticker)).scalar() or 0
    total_news     = db.query(func.count(News.id)).scalar() or 0
    last_updated   = db.query(func.max(Stock.last_updated)).scalar()
    return {
        "total_stocks":       total_stocks,
        "total_with_val":     total_with_val,
        "total_news":         total_news,
        "last_updated":       last_updated.isoformat() if last_updated else None,
        "pipeline":           _pipeline_status,
    }


# ── Filters ───────────────────────────────────────────────────────────────────

@app.get("/api/sectors")
def sectors(db: Session = Depends(get_db)):
    rows = db.query(Stock.sector).distinct().order_by(Stock.sector).all()
    return [r.sector for r in rows if r.sector and r.sector not in ("Unknown", None)]

@app.get("/api/cap_sizes")
def cap_sizes():
    return ["Mega Cap", "Large Cap", "Mid Cap", "Small Cap", "Micro Cap"]


# ── Stock list ────────────────────────────────────────────────────────────────

@app.get("/api/stocks")
def list_stocks(
    sector:    Optional[str] = None,
    cap_size:  Optional[str] = None,
    search:    Optional[str] = None,
    sort:      str = "rank",
    order:     str = "asc",
    limit:     int = 100,
    offset:    int = 0,
    min_score: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = (
        db.query(Stock, Fundamentals, Valuation)
        .outerjoin(Fundamentals, Stock.ticker == Fundamentals.ticker)
        .outerjoin(Valuation,    Stock.ticker == Valuation.ticker)
    )
    if sector:    q = q.filter(Stock.sector == sector)
    if cap_size:  q = q.filter(Stock.cap_size == cap_size)
    if search:
        s = f"%{search}%"
        q = q.filter(or_(Stock.ticker.ilike(s), Stock.name.ilike(s)))
    if min_score is not None:
        q = q.filter(Valuation.score_composite >= min_score)

    sort_col = {
        "rank":    Stock.rank,
        "mkt_cap": Stock.mkt_cap,
        "price":   Stock.price,
        "name":    Stock.name,
        "score":   Valuation.score_composite,
        "upside":  Valuation.avg_upside,
        "pe":      Fundamentals.pe,
        "roic":    Fundamentals.roic,
    }.get(sort, Stock.rank)

    q = q.order_by(sort_col.desc() if order == "desc" else sort_col)

    total = q.count()
    rows  = q.offset(offset).limit(limit).all()

    result = []
    for stock, fund, val in rows:
        result.append({
            "ticker":      stock.ticker,
            "name":        stock.name,
            "sector":      stock.sector,
            "cap_size":    stock.cap_size,
            "mkt_cap":     stock.mkt_cap,
            "price":       stock.price,
            "rank":        stock.rank,
            "pe":          fund.pe          if fund else None,
            "roic":        fund.roic        if fund else None,
            "rev_cagr_5y": fund.rev_cagr_5y if fund else None,
            "score":       val.score_composite if val else None,
            "rec":         val.score_label     if val else None,
            "stars":       val.score_stars     if val else None,
            "upside":      val.avg_upside      if val else None,
        })
    return {"total": total, "stocks": result}


# ── Single stock ──────────────────────────────────────────────────────────────

@app.get("/api/stocks/{ticker}")
def get_stock(ticker: str, db: Session = Depends(get_db)):
    ticker = ticker.upper()
    stock = db.query(Stock).filter(Stock.ticker == ticker).first()
    if not stock:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    fund = db.query(Fundamentals).filter(Fundamentals.ticker == ticker).first()
    val  = db.query(Valuation).filter(Valuation.ticker == ticker).first()

    def _to_dict(obj):
        if obj is None:
            return {}
        d = {}
        for col in obj.__table__.columns:
            v = getattr(obj, col.name)
            d[col.name] = v.isoformat() if isinstance(v, datetime) else v
        return d

    return {
        "stock":        _to_dict(stock),
        "fundamentals": _to_dict(fund),
        "valuation":    _to_dict(val),
    }


# ── News ──────────────────────────────────────────────────────────────────────

def _news_dict(r):
    return {
        "id":           r.id,
        "ticker":       r.ticker,
        "title":        r.title,
        "url":          r.url,
        "publisher":    r.publisher,
        "published_at": r.published_at.isoformat() if r.published_at else None,
        "sentiment":    r.sentiment,
    }

@app.get("/api/news")
def recent_news(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.query(News).order_by(News.published_at.desc()).limit(limit).all()
    return [_news_dict(r) for r in rows]

@app.get("/api/news/{ticker}")
def ticker_news(ticker: str, limit: int = 20, db: Session = Depends(get_db)):
    rows = (
        db.query(News)
        .filter(News.ticker == ticker.upper())
        .order_by(News.published_at.desc())
        .limit(limit)
        .all()
    )
    return [_news_dict(r) for r in rows]


# ── Price history ─────────────────────────────────────────────────────────────

@app.get("/api/price/{ticker}")
def price_history(ticker: str, days: int = 365, db: Session = Depends(get_db)):
    rows = (
        db.query(PriceHistory)
        .filter(PriceHistory.ticker == ticker.upper())
        .order_by(PriceHistory.date)
        .all()
    )
    return [{"date": r.date, "close": r.close, "volume": r.volume} for r in rows[-days:]]


# ── Live data (fetched fresh from Yahoo Finance on every call) ────────────────

def _yf_info_with_retry(ticker, retries=2, delay=1.5):
    """Fetch yfinance info with retry on transient errors."""
    last_err = None
    for attempt in range(retries + 1):
        try:
            return yf.Ticker(ticker).info or {}
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(delay)
    raise last_err


@app.get("/api/live/price/{ticker}")
def live_price(ticker: str):
    """Current price, change, volume — fetched live from Yahoo Finance."""
    try:
        info    = _yf_info_with_retry(ticker.upper())
        price   = info.get("currentPrice") or info.get("regularMarketPrice")
        prev    = info.get("previousClose") or info.get("regularMarketPreviousClose")
        change  = round(price - prev, 2)              if price and prev else None
        chg_pct = round((price - prev) / prev * 100, 2) if price and prev else None
        return {
            "ticker":       ticker.upper(),
            "price":        price,
            "prev_close":   prev,
            "change":       change,
            "change_pct":   chg_pct,
            "volume":       info.get("volume") or info.get("regularMarketVolume"),
            "market_state": info.get("marketState", "CLOSED"),
            "name":         info.get("longName") or info.get("shortName"),
            "sector":       info.get("sector"),
            "fetched_at":   datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": f"Yahoo Finance unavailable: {e}"})


@app.get("/api/live/news/{ticker}")
def live_news(ticker: str, limit: int = 10):
    """Latest news fetched live from Yahoo Finance (not from DB)."""
    try:
        from news import sentiment_score
        t        = yf.Ticker(ticker.upper())
        articles = (t.news or [])[:limit]
        result   = []
        for a in articles:
            ts = a.get("providerPublishTime")
            result.append({
                "title":        a.get("title", ""),
                "url":          a.get("link") or a.get("url", ""),
                "publisher":    a.get("publisher", ""),
                "published_at": datetime.fromtimestamp(ts).isoformat() if ts else None,
                "sentiment":    sentiment_score(a.get("title", "")),
            })
        return result
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


# ── Pipeline ──────────────────────────────────────────────────────────────────

@app.get("/api/pipeline/status")
def pipeline_status():
    return _pipeline_status

_SCRIPTS_ALL = ["universe", "fundamentals", "model", "news"]

def _parse_progress(line: str, script_total: int, scripts_run: list):
    import re
    m = re.search(r"Starting (\w+)\.py", line)
    if m:
        name = m.group(1)
        if name in scripts_run:
            idx = scripts_run.index(name)
            _pipeline_status["current_script"] = f"{name}.py"
            _pipeline_status["script_index"]   = idx
            _pipeline_status["pct_overall"]    = int(idx / script_total * 100)
        return
    m = re.search(r"✅ (\w+)\.py completed", line)
    if m:
        name = m.group(1)
        if name in scripts_run:
            idx = scripts_run.index(name)
            _pipeline_status["pct_overall"] = int((idx + 1) / script_total * 100)


@app.post("/api/pipeline/run")
def run_pipeline(from_script: Optional[str] = None):
    if _pipeline_status["running"]:
        return JSONResponse(status_code=409, content={"error": "Pipeline already running"})

    scripts_run = (
        _SCRIPTS_ALL[_SCRIPTS_ALL.index(from_script):]
        if from_script and from_script in _SCRIPTS_ALL
        else list(_SCRIPTS_ALL)
    )
    script_total = len(scripts_run)

    def _run():
        _pipeline_status["running"]        = True
        _pipeline_status["last_run"]       = datetime.utcnow().isoformat()
        _pipeline_status["current_script"] = None
        _pipeline_status["script_index"]   = 0
        _pipeline_status["script_total"]   = script_total
        _pipeline_status["pct_overall"]    = 0
        _pipeline_status["log_tail"]       = []
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            cmd = [sys.executable, os.path.join(script_dir, "run.py")]
            if from_script:
                cmd += ["--from", from_script]
            env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                bufsize=1, cwd=script_dir, env=env,
            )
            for line in proc.stdout:
                line = line.rstrip()
                _pipeline_status["log_tail"] = (_pipeline_status["log_tail"] + [line])[-20:]
                _parse_progress(line, script_total, scripts_run)
            proc.wait()
            _pipeline_status["last_result"] = (
                "success" if proc.returncode == 0
                else f"failed (exit {proc.returncode})"
            )
        except Exception as e:
            _pipeline_status["last_result"] = f"error: {e}"
        finally:
            _pipeline_status["running"]        = False
            _pipeline_status["pct_overall"]    = 100 if _pipeline_status["last_result"] == "success" else _pipeline_status["pct_overall"]
            _pipeline_status["current_script"] = None

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


@app.get("/api/pipeline/log")
def pipeline_log():
    return {"lines": _pipeline_status["log_tail"]}


# ── Score breakdown ───────────────────────────────────────────────────────────

@app.get("/api/stocks/{ticker}/score")
def get_score_breakdown(ticker: str, db: Session = Depends(get_db)):
    ticker = ticker.upper()
    fund = db.query(Fundamentals).filter(Fundamentals.ticker == ticker).first()
    if not fund:
        return JSONResponse(status_code=404, content={"error": "No fundamentals data"})
    val = db.query(Valuation).filter(Valuation.ticker == ticker).first()

    stock_dict = {col.name: getattr(fund, col.name) for col in fund.__table__.columns
                  if not isinstance(getattr(fund, col.name), datetime)}
    dcf   = {"dcf_upside_pct": val.dcf_upside_pct, "dcf_mos_price": val.dcf_mos_price} if val else {}
    comps = {"comps_upside_pct": val.comps_upside_pct} if val else {}
    m3    = {"m3_upside_pct": val.m3_upside_pct} if val else {}

    result = score_stock(stock_dict, dcf=dcf, comps=comps, m3=m3)

    categories_out = []
    for cat_name, cat in result["categories"].items():
        categories_out.append({
            "name":   cat_name,
            "weight": cat["weight"],
            "score":  cat["score"],
            "items":  [{"label": it[0], "score": it[1], "max": it[2], "display": it[3]}
                       for it in cat["items"]],
        })

    return {
        "ticker":     ticker,
        "composite":  result["composite"],
        "label":      result["rec_label"],
        "avg_upside": result["avg_upside"],
        "categories": categories_out,
    }


# ── Score distribution ────────────────────────────────────────────────────────

@app.get("/api/stats/distribution")
def score_distribution(db: Session = Depends(get_db)):
    total = db.query(func.count(Valuation.ticker)).filter(
        Valuation.score_composite.isnot(None)).scalar() or 1

    # 10-point histogram buckets
    hist_rows = db.execute(text("""
        SELECT (score_composite / 10) * 10 AS bucket, COUNT(*) AS cnt
        FROM valuations WHERE score_composite IS NOT NULL
        GROUP BY bucket ORDER BY bucket
    """)).fetchall()
    bucket_map = {r[0]: r[1] for r in hist_rows}
    histogram = [{"range": f"{b}-{b+9}", "count": bucket_map.get(b, 0)} for b in range(0, 100, 10)]

    # P25 / P50 / P75 from histogram walk
    cumulative, p25, p50, p75 = 0, None, None, None
    for b in range(0, 100, 10):
        cumulative += bucket_map.get(b, 0)
        if p25 is None and cumulative >= total * 0.25: p25 = b + 5
        if p50 is None and cumulative >= total * 0.50: p50 = b + 5
        if p75 is None and cumulative >= total * 0.75: p75 = b + 5

    stats_row = db.execute(text("""
        SELECT ROUND(AVG(score_composite),1), MIN(score_composite), MAX(score_composite)
        FROM valuations WHERE score_composite IS NOT NULL
    """)).fetchone()

    # By label
    label_rows = db.execute(text("""
        SELECT score_label, COUNT(*) FROM valuations
        WHERE score_label IS NOT NULL GROUP BY score_label
    """)).fetchall()
    label_order = ["STRONG BUY", "BUY", "WATCHLIST", "HOLD", "CAUTION", "AVOID"]
    label_map = {r[0]: r[1] for r in label_rows}
    by_label = [{"label": lbl, "count": label_map.get(lbl, 0),
                 "pct": round(label_map.get(lbl, 0) / total * 100, 1)}
                for lbl in label_order]

    # By sector
    sector_rows = db.execute(text("""
        SELECT s.sector, COUNT(*) AS cnt,
               ROUND(AVG(v.score_composite), 1) AS avg_score,
               SUM(CASE WHEN v.score_composite >= 70 THEN 1 ELSE 0 END) AS buy_count
        FROM stocks s JOIN valuations v ON s.ticker = v.ticker
        WHERE s.sector IS NOT NULL AND s.sector NOT IN ('Unknown','')
          AND v.score_composite IS NOT NULL
        GROUP BY s.sector ORDER BY avg_score DESC
    """)).fetchall()
    by_sector = [{"sector": r[0], "count": r[1], "avg_score": r[2], "buy_count": r[3]}
                 for r in sector_rows]

    # Threshold pass rates
    threshold_pass = []
    for threshold, label in [(55, "WATCHLIST+"), (70, "BUY+"), (85, "STRONG BUY")]:
        cnt = db.query(func.count(Valuation.ticker)).filter(
            Valuation.score_composite >= threshold).scalar() or 0
        threshold_pass.append({"threshold": threshold, "label": label,
                                "count": cnt, "pct": round(cnt / total * 100, 1)})

    return {
        "histogram":      histogram,
        "by_label":       by_label,
        "by_sector":      by_sector,
        "threshold_pass": threshold_pass,
        "stats": {
            "mean":        stats_row[0],
            "min_score":   stats_row[1],
            "max_score":   stats_row[2],
            "p25":         p25,
            "p50":         p50,
            "p75":         p75,
            "total_scored": total,
        },
    }


# ── Debug / health check ──────────────────────────────────────────────────────

@app.get("/api/debug/health")
def debug_health():
    import concurrent.futures, urllib.request, urllib.error

    results = []

    def _check(name, fn):
        import time as _time
        t0 = _time.monotonic()
        try:
            status, detail = fn()
        except Exception as e:
            status, detail = "error", str(e)[:120]
        ms = round((_time.monotonic() - t0) * 1000)
        return {"name": name, "status": status, "detail": detail, "latency_ms": ms}

    def check_db():
        s = SessionLocal()
        try:
            count = s.execute(text("SELECT COUNT(*) FROM stocks")).scalar()
            return "ok", f"{count} stocks in DB"
        finally:
            s.close()

    def check_ftp_nasdaq():
        req = urllib.request.urlopen(
            "https://ftp.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", timeout=8)
        lines = req.read().decode("utf-8").splitlines()
        return ("ok" if len(lines) > 1000 else "warn"), f"{len(lines)} lines"

    def check_ftp_other():
        req = urllib.request.urlopen(
            "https://ftp.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", timeout=8)
        lines = req.read().decode("utf-8").splitlines()
        return ("ok" if len(lines) > 1000 else "warn"), f"{len(lines)} lines"

    def check_yfinance():
        import yfinance as _yf
        t = _yf.Ticker("AAPL")
        info = t.fast_info
        price = getattr(info, "last_price", None)
        return ("ok" if price else "error"), f"AAPL ${price:.2f}" if price else "no price"

    def check_news():
        s = SessionLocal()
        try:
            count = s.execute(text("SELECT COUNT(*) FROM news")).scalar()
            if count == 0:
                return "warn", "0 articles — run news pipeline"
            newest = s.execute(text("SELECT MAX(published_at) FROM news")).scalar()
            return "ok", f"{count} articles, newest {newest}"
        finally:
            s.close()

    def check_run_log():
        log_path = os.path.join(os.path.dirname(__file__), "run.log")
        if not os.path.exists(log_path):
            return "warn", "run.log not found"
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        last = next((l.strip() for l in reversed(lines) if l.strip()), "empty")
        return "ok", last[:100]

    checks = [
        ("Database", check_db),
        ("NASDAQ FTP — nasdaqlisted", check_ftp_nasdaq),
        ("NASDAQ FTP — otherlisted", check_ftp_other),
        ("yfinance AAPL spot", check_yfinance),
        ("News freshness", check_news),
        ("run.log", check_run_log),
    ]

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(_check, name, fn): name for name, fn in checks}
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())

    results.sort(key=lambda r: ["error", "warn", "ok"].index(r["status"]))
    return {"checks": results}


# ── Data audit ────────────────────────────────────────────────────────────────

@app.get("/api/audit")
def data_audit(db: Session = Depends(get_db)):
    total = db.execute(text("SELECT COUNT(*) FROM stocks")).scalar() or 1

    # Data quality distribution
    dq_rows = db.execute(text("""
        SELECT CAST(data_quality / 10 AS INTEGER) * 10 AS bucket, COUNT(*) AS cnt
        FROM fundamentals WHERE data_quality IS NOT NULL
        GROUP BY bucket ORDER BY bucket
    """)).fetchall()
    dq_map = {r[0]: r[1] for r in dq_rows}
    dq_dist = [{"range": f"{b}-{b+9}", "count": dq_map.get(b, 0)} for b in range(0, 100, 10)]

    # Stale counts (> 7 days old)
    stale = db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM stocks       WHERE last_updated < datetime('now','-7 days')) AS stocks_stale,
          (SELECT COUNT(*) FROM fundamentals WHERE last_updated < datetime('now','-7 days')) AS fund_stale,
          (SELECT COUNT(*) FROM valuations   WHERE last_updated < datetime('now','-7 days')) AS val_stale,
          (SELECT COUNT(*) FROM news         WHERE published_at < datetime('now','-2 days')) AS news_stale
    """)).fetchone()

    # Null fields
    null_fields = {}
    for field in ["roic", "fcf", "eps_cagr_5y", "rev_cagr_5y", "d_to_e",
                  "int_cov", "gross_margin", "pe", "ev_ebitda"]:
        cnt = db.execute(text(
            f"SELECT COUNT(*) FROM fundamentals WHERE {field} IS NULL"
        )).scalar()
        null_fields[field] = {"null_count": cnt, "pct": round(cnt / total * 100, 1)}

    # Script last run (proxy: max last_updated per table)
    script_last = db.execute(text("""
        SELECT
          (SELECT MAX(last_updated) FROM stocks)       AS universe,
          (SELECT MAX(last_updated) FROM fundamentals) AS fundamentals,
          (SELECT MAX(last_updated) FROM valuations)   AS model,
          (SELECT MAX(last_updated) FROM news)         AS news
    """)).fetchone()

    # Outliers
    outliers = db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM fundamentals WHERE pe > 1000)        AS pe_above_1000,
          (SELECT COUNT(*) FROM fundamentals WHERE d_to_e > 10)      AS d_to_e_above_10,
          (SELECT COUNT(*) FROM fundamentals WHERE roic > 100)       AS roic_above_100,
          (SELECT COUNT(*) FROM fundamentals WHERE equity < 0)       AS negative_equity
    """)).fetchone()

    # Score completeness
    completeness = db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM stocks s WHERE NOT EXISTS
            (SELECT 1 FROM valuations v WHERE v.ticker = s.ticker)) AS no_valuation,
          (SELECT COUNT(*) FROM stocks s WHERE NOT EXISTS
            (SELECT 1 FROM fundamentals f WHERE f.ticker = s.ticker)) AS no_fundamentals,
          (SELECT COUNT(*) FROM valuations WHERE score_composite IS NULL) AS score_null
    """)).fetchone()

    return {
        "data_quality": {"distribution": dq_dist},
        "stale_counts": {
            "stocks_stale_7d":      stale[0],
            "fundamentals_stale_7d": stale[1],
            "valuations_stale_7d":  stale[2],
            "news_stale_2d":        stale[3],
        },
        "null_fields": null_fields,
        "script_last_run": {
            "universe":     script_last[0],
            "fundamentals": script_last[1],
            "model":        script_last[2],
            "news":         script_last[3],
        },
        "outliers": {
            "pe_above_1000":   outliers[0],
            "d_to_e_above_10": outliers[1],
            "roic_above_100":  outliers[2],
            "negative_equity": outliers[3],
        },
        "score_completeness": {
            "no_valuation":    completeness[0],
            "no_fundamentals": completeness[1],
            "score_null":      completeness[2],
        },
        "total_stocks": total,
    }


# ── Extra page routes ─────────────────────────────────────────────────────────

@app.get("/distribution")
def distribution_page():
    return FileResponse(os.path.join(STATIC_DIR, "distribution.html"))

@app.get("/debug")
def debug_page():
    return FileResponse(os.path.join(STATIC_DIR, "debug.html"))

@app.get("/audit")
def audit_page():
    return FileResponse(os.path.join(STATIC_DIR, "audit.html"))


if __name__ == "__main__":
    import uvicorn, webbrowser

    PORT     = int(os.environ.get("PORT", 8000))
    IS_LOCAL = PORT == 8000 and not os.environ.get("FLY_APP_NAME")

    if IS_LOCAL:
        def _open_browser():
            time.sleep(1.5)
            webbrowser.open(f"http://localhost:{PORT}")
        threading.Thread(target=_open_browser, daemon=True).start()

    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
