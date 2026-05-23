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
from sqlalchemy import func, or_

from database import get_db, init_db, Stock, Fundamentals, Valuation, News, PriceHistory

app = FastAPI(title="Stock Tracker")
init_db()

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_pipeline_status = {"running": False, "last_run": None, "last_result": None}


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

@app.post("/api/pipeline/run")
def run_pipeline(from_script: Optional[str] = None):
    if _pipeline_status["running"]:
        return JSONResponse(status_code=409, content={"error": "Pipeline already running"})

    def _run():
        _pipeline_status["running"] = True
        _pipeline_status["last_run"] = datetime.utcnow().isoformat()
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            cmd = [sys.executable, os.path.join(script_dir, "run.py")]
            if from_script:
                cmd += ["--from", from_script]
            env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
            result = subprocess.run(cmd, capture_output=True, text=True,
                                    cwd=script_dir, env=env)
            _pipeline_status["last_result"] = (
                "success" if result.returncode == 0
                else f"failed: {result.stderr[-500:]}"
            )
        except Exception as e:
            _pipeline_status["last_result"] = f"error: {e}"
        finally:
            _pipeline_status["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


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
