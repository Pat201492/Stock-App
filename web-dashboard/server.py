"""
server.py — FastAPI web server for Stock Tracker
Run: python server.py
Dashboard: http://localhost:8000
"""
import os, re, subprocess, sys, threading, time
from datetime import datetime
from typing import Optional
import yfinance as yf

from fastapi import FastAPI, Depends, Query, Body, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.datastructures import MutableHeaders
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text

from database import get_db, init_db, Stock, Fundamentals, Valuation, News, PriceHistory, ETF, ETFHolding, SessionLocal
from data_utils import score_stock
from politicians_database import (
    get_pol_db, init_pol_db,
    Politician, Committee, CommitteeMembership,
    CongressionalTrade, InsiderTrade, PolTickerMetadata, MemberPosition,
    SessionLocal as PolSessionLocal,
)
from accounts_database import (
    get_acct_db, init_accounts_db, Favorite, PaperTrade,
    User, Session as AuthSession, ResetToken, DeviceToken, Holding,
    SessionLocal as AcctSessionLocal,
)
import auth as _auth
import news_trust as _news_trust
import price_live as _price_live
import org_scope as _org_scope

app = FastAPI(title="Stock Tracker")
init_db()
init_pol_db()
init_accounts_db()

# Read-only host flag. When set (e.g. on the public VPS that only serves
# locally-built DBs), the heavy/mutating endpoints are disabled so nobody can
# trigger a yfinance/EDGAR pipeline run on the serving box.
READ_ONLY = os.environ.get("READ_ONLY") == "1"

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class CacheHeaderMiddleware:
    """Set explicit caching rules.

    Nothing sent a Cache-Control header before, so browsers fell back to
    heuristic caching and could sit on a stale page indefinitely — a deploy goes
    out, the server serves the new files, and the browser keeps running the old
    ones, so a shipped fix looks like it never landed.

    HTML must always revalidate: it carries the ?v= references that point at
    everything else, so if it's fresh the rest follows. The ETag turns that into
    a 304 with no body. Versioned assets are immutable, because the version is
    part of the cache key and bumping it fetches a new URL. Unversioned assets
    revalidate, having nothing to bust them.

    Written as raw ASGI on purpose. The first version used @app.middleware,
    which wraps Starlette's BaseHTTPMiddleware — that reads the entire response
    body into memory before passing it on. On a 908MB box with no swap, holding
    a second copy of every large JSON response was enough to get the service
    OOM-killed. This only rewrites the header frame; the body still streams.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path  = scope.get("path", "")
        query = scope.get("query_string", b"").decode("latin-1", "replace")

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                if path.startswith("/static/"):
                    headers["cache-control"] = (
                        "public, max-age=31536000, immutable"
                        if query.startswith("v=") else "no-cache")
                elif "text/html" in headers.get("content-type", ""):
                    headers["cache-control"] = "no-cache"
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(CacheHeaderMiddleware)

# Curated political-relationship overlay (exec-branch / business ties). Cached,
# reloaded on file change, tolerant of a missing/broken file (-> empty overlay).
_REL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "political_relationships.json")
_rel_cache = {"mtime": None, "data": None}

def _load_relationships():
    import json
    try:
        mtime = os.path.getmtime(_REL_PATH)
    except OSError:
        return {"external_nodes": [], "edges": []}
    if _rel_cache["mtime"] != mtime or _rel_cache["data"] is None:
        try:
            with open(_REL_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            _rel_cache["data"] = {
                "external_nodes": raw.get("external_nodes", []),
                "edges":          raw.get("edges", []),
            }
            _rel_cache["mtime"] = mtime
        except (OSError, ValueError):
            return _rel_cache["data"] or {"external_nodes": [], "edges": []}
    return _rel_cache["data"]

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

@app.get("/etf")
def etf_screener_page():
    return FileResponse(os.path.join(STATIC_DIR, "etf.html"))

@app.get("/etf/{ticker}")
def etf_detail_page(ticker: str):
    return FileResponse(os.path.join(STATIC_DIR, "etf_detail.html"))

@app.get("/fed")
def fed_page():
    return FileResponse(os.path.join(STATIC_DIR, "fed.html"))

@app.get("/account")
def account_page():
    return FileResponse(os.path.join(STATIC_DIR, "account.html"))

@app.get("/methodology")
def methodology_page():
    return FileResponse(os.path.join(STATIC_DIR, "methodology.html"))


# ── Self-installing updater bootstrap ───────────────────────────────────────────
# Served so any machine can run a one-liner that installs the app if missing,
# refreshes the data, then publishes it live. Returned as text/plain so
# `irm https://host/update.ps1 | iex` (or `curl host/update.sh | bash`) works.
_BOOTSTRAP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bootstrap")

@app.get("/update.ps1")
def bootstrap_ps1():
    return FileResponse(os.path.join(_BOOTSTRAP_DIR, "update.ps1"), media_type="text/plain")

@app.get("/update.sh")
def bootstrap_sh():
    return FileResponse(os.path.join(_BOOTSTRAP_DIR, "update.sh"), media_type="text/plain")


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
    max_score: Optional[int] = None,
    conflicts_only: bool = False,
    db: Session = Depends(get_db),
):
    q = (
        db.query(Stock, Fundamentals, Valuation)
        .outerjoin(Fundamentals, Stock.ticker == Fundamentals.ticker)
        .outerjoin(Valuation,    Stock.ticker == Valuation.ticker)
    )
    if conflicts_only:
        # Restrict to stocks with a political conflict-of-interest trade.
        conflicted = list(_conflicted_tickers().keys())
        q = q.filter(Stock.ticker.in_(conflicted or ["\0"]))
    if sector:    q = q.filter(Stock.sector == sector)
    if cap_size:  q = q.filter(Stock.cap_size == cap_size)
    if search:
        s = f"%{search}%"
        q = q.filter(or_(Stock.ticker.ilike(s), Stock.name.ilike(s)))
    if min_score is not None:
        q = q.filter(Valuation.score_composite >= min_score)
    if max_score is not None:
        q = q.filter(Valuation.score_composite <= max_score)

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


# ── ETFs ────────────────────────────────────────────────────────────────────────

def _etf_dict(e):
    return {
        "ticker": e.ticker, "name": e.name, "category": e.category,
        "asset_class": e.asset_class, "aum": e.aum, "expense_ratio": e.expense_ratio,
        "yield_pct": e.yield_pct, "ytd_return": e.ytd_return, "price": e.price,
        "weighted_score": e.weighted_score, "covered_weight": e.covered_weight,
        "holdings_count": e.holdings_count,
    }

@app.get("/api/etfs")
def list_etfs(
    search:   Optional[str] = None,
    category: Optional[str] = None,
    sort:     str = "aum",
    order:    str = "desc",
    limit:    int = 100,
    offset:   int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(ETF)
    if search:
        s = f"%{search}%"
        q = q.filter(or_(ETF.ticker.ilike(s), ETF.name.ilike(s)))
    if category:
        q = q.filter(ETF.category == category)
    sort_col = {
        "ticker": ETF.ticker, "name": ETF.name, "aum": ETF.aum,
        "expense": ETF.expense_ratio, "yield": ETF.yield_pct,
        "ytd": ETF.ytd_return, "score": ETF.weighted_score,
    }.get(sort, ETF.aum)
    # NULLs last for numeric sorts
    q = q.order_by(sort_col.is_(None), sort_col.desc() if order == "desc" else sort_col)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()

    # top-3 holdings preview per ETF on the page
    tickers = [e.ticker for e in rows]
    preview = {}
    if tickers:
        for h in (db.query(ETFHolding)
                    .filter(ETFHolding.etf_ticker.in_(tickers))
                    .order_by(ETFHolding.weight.desc()).all()):
            preview.setdefault(h.etf_ticker, [])
            if len(preview[h.etf_ticker]) < 3:
                preview[h.etf_ticker].append(h.holding_ticker)

    out = []
    for e in rows:
        d = _etf_dict(e)
        d["top_holdings"] = preview.get(e.ticker, [])
        out.append(d)
    return {"total": total, "etfs": out}

@app.get("/api/etf_categories")
def etf_categories(db: Session = Depends(get_db)):
    rows = db.query(ETF.category).filter(ETF.category != "").distinct().all()
    return sorted({r[0] for r in rows if r[0]})

@app.get("/api/etf/{ticker}")
def etf_detail(ticker: str, db: Session = Depends(get_db)):
    e = db.query(ETF).filter(ETF.ticker == ticker.upper()).first()
    if not e:
        return JSONResponse(status_code=404, content={"error": "ETF not found"})
    holdings = (db.query(ETFHolding)
                  .filter(ETFHolding.etf_ticker == ticker.upper())
                  .order_by(ETFHolding.weight.desc()).all())
    htickers = [h.holding_ticker for h in holdings]

    # join our scores + sectors from stocks.db for the holdings
    score_map, sector_map = {}, {}
    if htickers:
        for t, sc in db.query(Valuation.ticker, Valuation.score_composite).filter(
                Valuation.ticker.in_(htickers)).all():
            score_map[t] = sc
        for t, sec in db.query(Stock.ticker, Stock.sector).filter(
                Stock.ticker.in_(htickers)).all():
            sector_map[t] = sec

    holding_rows, sector_w = [], {}
    for h in holdings:
        sc = score_map.get(h.holding_ticker)
        sec = sector_map.get(h.holding_ticker)
        holding_rows.append({
            "ticker": h.holding_ticker, "name": h.holding_name,
            "weight": h.weight, "score": sc, "sector": sec,
            "in_universe": h.holding_ticker in score_map,
        })
        if sec:
            sector_w[sec] = sector_w.get(sec, 0) + (h.weight or 0)

    return {
        "etf": _etf_dict(e),
        "holdings": holding_rows,
        "sector_weights": sorted(
            [{"sector": k, "weight": v} for k, v in sector_w.items()],
            key=lambda x: -x["weight"]),
    }

@app.get("/api/etf/{ticker}/prices")
def etf_prices(ticker: str, period: str = "1y"):
    """Live price history from yfinance (ETFs aren't in price_history)."""
    try:
        hist = yf.Ticker(ticker.upper()).history(period=period)
        return [
            {"date": d.strftime("%Y-%m-%d"), "close": round(float(r["Close"]), 4)}
            for d, r in hist.iterrows()
        ]
    except Exception:
        return []


# ── Fed / economic-health ───────────────────────────────────────────────────────

# Published FOMC meeting dates (decision day). Update when the Fed releases new years.
FOMC_DATES = [
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30",
    "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29",
    "2026-09-16", "2026-11-04", "2026-12-16",
]

# series_id -> (label, plain-English context, yoy?)
_FED_SERIES = [
    ("DFF",      "Fed Funds Rate",     "The Fed's overnight policy rate.",                 False, "%"),
    ("CPIAUCSL", "Inflation (CPI YoY)", "Consumer prices vs a year ago; Fed targets ~2%.", True,  "%"),
    ("UNRATE",   "Unemployment",       "Share of the labor force out of work.",            False, "%"),
    ("GDPC1",    "Real GDP YoY",       "Inflation-adjusted output vs a year ago.",         True,  "%"),
    ("DGS10",    "10-Yr Treasury",     "Benchmark long-term interest rate.",               False, "%"),
    ("DGS2",     "2-Yr Treasury",      "Short-term rate; reacts to Fed policy.",           False, "%"),
    ("T10Y2Y",   "Yield Curve (10y-2y)", "Negative = inversion, a classic recession signal.", False, "pp"),
]

@app.get("/api/fed/summary")
def fed_summary():
    import fred
    if not fred.configured():
        return {"configured": False,
                "message": "Set the FRED_API_KEY env var (free key at fredstlouisfed.org) to enable Fed data."}
    out = []
    for sid, label, ctx, yoy, unit in _FED_SERIES:
        try:
            d = fred.latest_with_change(sid, yoy=yoy)
            if d:
                out.append({"id": sid, "label": label, "context": ctx, "unit": unit, **d})
        except Exception as e:
            out.append({"id": sid, "label": label, "context": ctx, "unit": unit, "error": str(e)[:80]})
    return {"configured": True, "series": out}

@app.get("/api/fed/calendar")
def fed_calendar():
    from datetime import date as _d
    today = _d.today().isoformat()
    upcoming = [d for d in FOMC_DATES if d >= today][:4]
    def days_until(d):
        return (_d.fromisoformat(d) - _d.today()).days
    return {"upcoming": [{"date": d, "days_until": days_until(d)} for d in upcoming]}

@app.get("/api/fed/history")
def fed_history():
    """Past ~year of FOMC decisions, derived from the fed-funds target range
    (FRED DFEDTARU/DFEDTARL): hold / cut / hike + bps + resulting range."""
    import fred
    from datetime import date as _d, timedelta as _td
    if not fred.configured():
        return {"configured": False}
    try:
        up = fred.fetch_series("DFEDTARU", limit=500)
        lo = fred.fetch_series("DFEDTARL", limit=500)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)[:100]})

    def asof(obs, day):  # last value with date <= day (ISO str)
        v = None
        for o in obs:
            if o["date"] <= day:
                v = o["value"]
            else:
                break
        return v

    today = _d.today()
    window = (today - _td(days=400)).isoformat()
    past = [d for d in FOMC_DATES if window <= d <= today.isoformat()]
    out = []
    for d in past:
        before_day = (_d.fromisoformat(d) - _td(days=1)).isoformat()
        after_day  = (_d.fromisoformat(d) + _td(days=6)).isoformat()
        bu, au = asof(up, before_day), asof(up, after_day)
        al = asof(lo, after_day)
        if au is None or bu is None:
            continue
        delta = round((au - bu) * 100)  # bps
        action = "Hike" if delta > 0 else "Cut" if delta < 0 else "Hold"
        out.append({
            "date": d, "action": action, "change_bps": delta,
            "range": (f"{al:.2f}–{au:.2f}%" if al is not None else f"{au:.2f}%"),
        })
    out.reverse()  # newest first
    return {"configured": True, "decisions": out}

@app.get("/api/fed/news")
def fed_news(limit: int = 12):
    terms = ["Federal Reserve", "FOMC", "interest rates", "inflation"]
    seen, out = set(), []
    for term in terms:
        for a in _fetch_google_news_rss(term, limit=6):
            if a["url"] not in seen:
                seen.add(a["url"]); out.append(a)
    out.sort(key=lambda a: a.get("published_at") or "", reverse=True)
    return out[:limit]

@app.get("/api/fed/series/{series_id}")
def fed_series(series_id: str, limit: int = 180):
    """Longer history for one indicator, for the click-through chart."""
    import fred
    meta = next((m for m in _FED_SERIES if m[0] == series_id.upper()), None)
    if not meta:
        return JSONResponse(status_code=404, content={"error": "unknown series"})
    _id, label, ctx, yoy, unit = meta
    if not fred.configured():
        return {"configured": False}
    try:
        obs = fred.fetch_series(_id, limit=limit + (12 if yoy else 0))
        if yoy and len(obs) > 12:
            pts = [{"date": obs[i]["date"],
                    "value": round((obs[i]["value"] / obs[i - 12]["value"] - 1) * 100, 2)}
                   for i in range(12, len(obs)) if obs[i - 12]["value"]]
        else:
            pts = obs
        return {"configured": True, "id": _id, "label": label, "unit": unit, "points": pts[-limit:]}
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)[:100]})


# ── Auth: email + password, session tokens, SMTP password reset ─────────────────
import re as _re
_EMAIL_RE = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/")

def _make_session(db, user_id):
    from datetime import datetime as _dt, timedelta as _td
    tok = _auth.new_token()
    db.add(AuthSession(token=tok, user_id=user_id, expires_at=_dt.utcnow() + _td(days=30)))
    db.commit()
    return tok

@app.post("/api/auth/signup")
def auth_signup(payload: dict = Body(...), db: Session = Depends(get_acct_db)):
    email = (payload.get("email") or "").strip().lower()
    pw    = payload.get("password") or ""
    name  = (payload.get("display_name") or "").strip()
    if not _EMAIL_RE.match(email):
        return JSONResponse(status_code=400, content={"error": "Enter a valid email."})
    if len(pw) < 8:
        return JSONResponse(status_code=400, content={"error": "Password must be at least 8 characters."})
    if db.query(User).filter(User.email == email).first():
        return JSONResponse(status_code=409, content={"error": "That email is already registered."})
    h, salt = _auth.hash_password(pw)
    u = User(email=email, password_hash=h, salt=salt, display_name=name)
    db.add(u); db.commit()
    return {"token": _make_session(db, u.id), "email": email, "display_name": name}

@app.post("/api/auth/login")
def auth_login(payload: dict = Body(...), db: Session = Depends(get_acct_db)):
    email = (payload.get("email") or "").strip().lower()
    pw    = payload.get("password") or ""
    u = db.query(User).filter(User.email == email).first()
    if not u or not _auth.verify_password(pw, u.salt, u.password_hash):
        return JSONResponse(status_code=401, content={"error": "Wrong email or password."})
    return {"token": _make_session(db, u.id), "email": u.email, "display_name": u.display_name or ""}

@app.post("/api/auth/logout")
def auth_logout(payload: dict = Body(...), db: Session = Depends(get_acct_db)):
    tok = payload.get("token") or ""
    db.query(AuthSession).filter(AuthSession.token == tok).delete()
    db.commit()
    return {"ok": True}

@app.get("/api/auth/me")
def auth_me(token: str = "", authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email:
        return JSONResponse(status_code=401, content={"error": "not signed in"})
    u = db.query(User).filter(User.email == email).first()
    return {"email": email, "display_name": (u.display_name or "") if u else ""}

@app.post("/api/auth/request_reset")
def auth_request_reset(payload: dict = Body(...), db: Session = Depends(get_acct_db)):
    from datetime import datetime as _dt, timedelta as _td
    email = (payload.get("email") or "").strip().lower()
    u = db.query(User).filter(User.email == email).first()
    out = {"ok": True}  # generic — don't reveal whether the email exists
    if u:
        tok = _auth.new_token()
        db.add(ResetToken(token=tok, user_id=u.id, expires_at=_dt.utcnow() + _td(hours=1)))
        db.commit()
        link = f"{APP_BASE_URL}/account?reset={tok}"
        if not _auth.send_reset_email(email, link):
            out["link"] = link  # no SMTP configured → surface the link (dev)
    return out

@app.post("/api/auth/reset")
def auth_reset(payload: dict = Body(...), db: Session = Depends(get_acct_db)):
    from datetime import datetime as _dt
    tok = payload.get("token") or ""
    pw  = payload.get("password") or ""
    if len(pw) < 8:
        return JSONResponse(status_code=400, content={"error": "Password must be at least 8 characters."})
    rt = db.query(ResetToken).filter(ResetToken.token == tok).first()
    if not rt or rt.used or (rt.expires_at and rt.expires_at < _dt.utcnow()):
        return JSONResponse(status_code=400, content={"error": "Reset link is invalid or expired."})
    u = db.query(User).filter(User.id == rt.user_id).first()
    if not u:
        return JSONResponse(status_code=400, content={"error": "Account not found."})
    u.password_hash, u.salt = _auth.hash_password(pw)
    rt.used = 1
    db.query(AuthSession).filter(AuthSession.user_id == u.id).delete()  # log out everywhere
    db.commit()
    return {"ok": True}


# ── Push-notification device-token registration ───────────────────────────────

@app.post("/api/push/register")
def push_register(
    payload: dict = Body(...),
    token: str = "",
    authorization: str = Header(None),
    db: Session = Depends(get_acct_db),
):
    email = _email_from_token(token, authorization)
    if not email:
        return _UNAUTH
    fcm_token = (payload.get("fcm_token") or "").strip()
    if not fcm_token:
        return JSONResponse(status_code=422, content={"error": "fcm_token required"})
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return _UNAUTH
    exists = db.query(DeviceToken).filter(
        DeviceToken.user_id == user.id,
        DeviceToken.fcm_token == fcm_token,
    ).first()
    if not exists:
        db.add(DeviceToken(user_id=user.id, fcm_token=fcm_token))
        db.commit()
    return {"ok": True}


# ── Account layer: favorites + paper trades (auth-gated by session token) ───────
# Account data lives in accounts.db (not touched by the data push), so these
# writes are intentionally allowed even when READ_ONLY is set.

def _last_price(ticker):
    t = (ticker or "").upper()
    sdb = SessionLocal()
    try:
        r = sdb.query(Stock.price).filter(Stock.ticker == t).first()
        if r and r[0]:
            return float(r[0])
        e = sdb.query(ETF.price).filter(ETF.ticker == t).first()
        if e and e[0]:
            return float(e[0])
    finally:
        sdb.close()
    return None

def _email_from_token(token, authorization):
    """Resolve a session token (query param or 'Authorization: Bearer') to the
    user's email, or None if missing/expired."""
    from datetime import datetime as _dt
    tok = token or ""
    if not tok and authorization and authorization.lower().startswith("bearer "):
        tok = authorization[7:]
    if not tok:
        return None
    adb = AcctSessionLocal()
    try:
        s = adb.query(AuthSession).filter(AuthSession.token == tok).first()
        if not s or (s.expires_at and s.expires_at < _dt.utcnow()):
            return None
        u = adb.query(User).filter(User.id == s.user_id).first()
        return u.email if u else None
    finally:
        adb.close()

_UNAUTH = JSONResponse(status_code=401, content={"error": "sign in required"})

@app.get("/api/account/favorites")
def acct_favorites(token: str = "", authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email: return _UNAUTH
    rows = db.query(Favorite).filter(Favorite.username == email).all()
    return {"favorites": [
        {"ticker": f.ticker, "kind": f.kind, "last_price": _last_price(f.ticker)} for f in rows
    ]}

@app.post("/api/account/favorite")
def acct_favorite_toggle(token: str = "", ticker: str = "", kind: str = "stock",
                         authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email: return _UNAUTH
    t = ticker.strip().upper()
    if not t:
        return JSONResponse(status_code=400, content={"error": "ticker required"})
    existing = db.query(Favorite).filter(Favorite.username == email, Favorite.ticker == t).first()
    if existing:
        db.delete(existing); db.commit()
        return {"ticker": t, "favorited": False}
    db.add(Favorite(username=email, ticker=t, kind=kind)); db.commit()
    return {"ticker": t, "favorited": True}

@app.get("/api/account/trades")
def acct_trades(token: str = "", authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email: return _UNAUTH
    rows = (db.query(PaperTrade).filter(PaperTrade.username == email)
              .order_by(PaperTrade.traded_on.desc(), PaperTrade.id.desc()).all())
    return {"trades": [{
        "id": r.id, "ticker": r.ticker, "kind": r.kind, "side": r.side,
        "shares": r.shares, "price": r.price,
        "date": r.traded_on.isoformat() if r.traded_on else None, "note": r.note,
    } for r in rows]}

@app.post("/api/account/trade")
def acct_trade_add(token: str = "", ticker: str = "", kind: str = "stock", side: str = "buy",
                   shares: float = 0, price: float = 0, date: Optional[str] = None,
                   note: str = "", authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email: return _UNAUTH
    from datetime import date as _d
    t = ticker.strip().upper()
    if not t or shares <= 0 or price < 0 or side not in ("buy", "sell"):
        return JSONResponse(status_code=400, content={"error": "invalid trade"})
    try:
        td = _d.fromisoformat(date) if date else _d.today()
    except ValueError:
        td = _d.today()
    db.add(PaperTrade(username=email, ticker=t, kind=kind, side=side,
                      shares=shares, price=price, traded_on=td, note=note.strip()))
    db.commit()
    return {"ok": True}

@app.delete("/api/account/trade/{trade_id}")
def acct_trade_delete(trade_id: int, token: str = "", authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email: return _UNAUTH
    row = db.query(PaperTrade).filter(PaperTrade.id == trade_id,
                                      PaperTrade.username == email).first()
    if row:
        db.delete(row); db.commit()
    return {"ok": True}

@app.get("/api/account/portfolio")
def acct_portfolio(token: str = "", authorization: str = Header(None), db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email: return _UNAUTH
    trades = (db.query(PaperTrade).filter(PaperTrade.username == email)
                .order_by(PaperTrade.traded_on.asc(), PaperTrade.id.asc()).all())
    # average-cost method
    pos = {}  # ticker -> {shares, cost, kind}
    realized = 0.0
    for tr in trades:
        p = pos.setdefault(tr.ticker, {"shares": 0.0, "cost": 0.0, "kind": tr.kind})
        if tr.side == "buy":
            p["shares"] += tr.shares
            p["cost"]   += tr.shares * tr.price
        else:  # sell
            if p["shares"] > 1e-9:
                avg  = p["cost"] / p["shares"]
                sold = min(tr.shares, p["shares"])
                realized += (tr.price - avg) * sold
                p["cost"]   -= avg * sold
                p["shares"] -= sold
    positions = []
    total_mv = total_upl = total_cost = 0.0
    for tk, p in pos.items():
        if p["shares"] <= 1e-9:
            continue
        avg  = p["cost"] / p["shares"]
        last = _last_price(tk)
        mv   = (last or 0) * p["shares"]
        upl  = (last - avg) * p["shares"] if last is not None else None
        positions.append({
            "ticker": tk, "kind": p["kind"], "shares": round(p["shares"], 4),
            "avg_cost": round(avg, 4), "last_price": last,
            "market_value": round(mv, 2),
            "unrealized_pl": round(upl, 2) if upl is not None else None,
            "unrealized_pct": round((last/avg - 1) * 100, 2) if (last is not None and avg) else None,
        })
        total_mv += mv; total_cost += p["cost"]
        if upl is not None: total_upl += upl
    positions.sort(key=lambda x: -(x["market_value"] or 0))
    return {
        "positions": positions,
        "realized_pl": round(realized, 2),
        "totals": {
            "market_value": round(total_mv, 2),
            "cost_basis": round(total_cost, 2),
            "unrealized_pl": round(total_upl, 2),
        },
    }


# ── Imported holdings (CSV upload) ─────────────────────────────────────────────

def _num(s):
    """Parse a money/quantity cell -> float. Handles $, commas, (parens)=negative."""
    if s is None:
        return None
    s = str(s).strip().replace("$", "").replace(",", "").replace("%", "")
    if not s or s in ("-", "--", "N/A", "n/a"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
        return -v if neg else v
    except ValueError:
        return None


def _parse_holdings_csv(text):
    """Flexible CSV -> [{ticker, shares, cost_basis}]. Auto-detects columns by
    header keywords so common broker exports (Fidelity/Schwab/Robinhood) work."""
    import csv as _csv, io as _io
    try:
        rows = list(_csv.DictReader(_io.StringIO(text)))
    except Exception:
        return []
    if not rows:
        return []
    headers = {(h or "").lower().strip(): h for h in rows[0].keys() if h}

    def find(*needles):
        for n in needles:
            for hl, h in headers.items():
                if n in hl:
                    return h
        return None

    tcol = find("ticker", "symbol", "sym")
    qcol = find("quantity", "shares", "qty", "units")
    avgcol = find("average cost", "avg cost", "cost per share", "cost/share",
                  "unit cost", "price paid", "purchase price")
    totcol = find("cost basis total", "total cost", "cost basis")
    out, seen = [], set()
    for r in rows:
        tk = (r.get(tcol) or "").strip().upper() if tcol else ""
        tk = _re.sub(r"[^A-Z.\-]", "", tk)
        if not tk or len(tk) > 6 or tk in seen:
            continue
        sh = _num(r.get(qcol)) if qcol else None
        if not sh or sh <= 0:
            continue
        cost = _num(r.get(avgcol)) if avgcol else None
        if cost is None and totcol:
            tot = _num(r.get(totcol))
            if tot is not None and sh:
                cost = round(tot / sh, 4)
        seen.add(tk)
        out.append({"ticker": tk, "shares": sh, "cost_basis": cost})
    return out


@app.post("/api/account/holdings/upload")
def acct_holdings_upload(payload: dict = Body(...), token: str = "",
                         authorization: str = Header(None),
                         db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email:
        return _UNAUTH
    text = payload.get("csv") or ""
    parsed = _parse_holdings_csv(text)
    if not parsed:
        return JSONResponse(status_code=400, content={
            "error": "No holdings found. CSV needs a ticker/symbol column and a "
                     "shares/quantity column."})
    # an upload replaces the user's prior holdings snapshot
    db.query(Holding).filter(Holding.username == email).delete()
    for h in parsed:
        db.add(Holding(username=email, ticker=h["ticker"],
                       shares=h["shares"], cost_basis=h["cost_basis"]))
    db.commit()
    return {"ok": True, "count": len(parsed),
            "tickers": [h["ticker"] for h in parsed]}


@app.get("/api/account/holdings")
def acct_holdings(token: str = "", authorization: str = Header(None),
                  db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email:
        return _UNAUTH
    rows = db.query(Holding).filter(Holding.username == email).all()
    sdb = SessionLocal()
    try:
        positions, tmv, tcost, tupl = [], 0.0, 0.0, 0.0
        for h in rows:
            last = _last_price(h.ticker)
            sc = sdb.query(Valuation.score_composite).filter(
                Valuation.ticker == h.ticker).first()
            score = sc[0] if sc else None
            mv = (last or 0) * (h.shares or 0)
            cost_tot = (h.cost_basis or 0) * (h.shares or 0) if h.cost_basis else None
            upl = (mv - cost_tot) if cost_tot is not None and last is not None else None
            positions.append({
                "ticker": h.ticker, "shares": round(h.shares or 0, 4),
                "cost_basis": h.cost_basis, "last_price": last,
                "market_value": round(mv, 2) if last is not None else None,
                "cost_total": round(cost_tot, 2) if cost_tot is not None else None,
                "unrealized_pl": round(upl, 2) if upl is not None else None,
                "unrealized_pct": round((upl / cost_tot) * 100, 2)
                                  if (upl is not None and cost_tot) else None,
                "score": round(score, 1) if score is not None else None,
            })
            if last is not None:
                tmv += mv
            if cost_tot is not None:
                tcost += cost_tot
            if upl is not None:
                tupl += upl
    finally:
        sdb.close()
    positions.sort(key=lambda x: -(x["market_value"] or 0))
    return {"positions": positions, "totals": {
        "market_value": round(tmv, 2), "cost_basis": round(tcost, 2),
        "unrealized_pl": round(tupl, 2)}}


@app.delete("/api/account/holdings")
def acct_holdings_clear(token: str = "", authorization: str = Header(None),
                        db: Session = Depends(get_acct_db)):
    email = _email_from_token(token, authorization)
    if not email:
        return _UNAUTH
    db.query(Holding).filter(Holding.username == email).delete()
    db.commit()
    return {"ok": True}


# ── News ──────────────────────────────────────────────────────────────────────

def _news_dict(r):
    import news_trust as _nt
    return {
        "id":           r.id,
        "ticker":       r.ticker,
        "title":        r.title,
        "url":          r.url,
        "publisher":    r.publisher,
        "published_at": r.published_at.isoformat() if r.published_at else None,
        "sentiment":    r.sentiment,
        "source_trust": _nt.trust_for(r.publisher),
        "summary":      r.summary,
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

@app.get("/api/price-live/stats")
def price_live_stats():
    """Which tickers needed the on-demand fallback. See price_live.py."""
    return _price_live.stats()


# Symbols we're willing to spend an upstream request on. `allow_live` is a
# public unauthenticated switch, so without this any caller could point
# /api/price at arbitrary strings and turn the box into an outbound fetcher —
# every unknown symbol misses the cache and costs a request, and enough of them
# evict the real entries too. Built once per process; the DBs only change when
# publish.ps1 swaps them, which restarts the service.
MAX_TICKER_LEN = 12
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_known_tickers = None
_known_lock = threading.Lock()


def known_tickers():
    global _known_tickers
    if _known_tickers is not None:
        return _known_tickers
    with _known_lock:
        if _known_tickers is None:
            found = set()
            db = SessionLocal()
            try:
                found.update(t for (t,) in db.query(Stock.ticker).all() if t)
            finally:
                db.close()
            pdb = PolSessionLocal()
            try:
                found.update(t for (t,) in
                             pdb.query(CongressionalTrade.ticker).distinct().all() if t)
            finally:
                pdb.close()
            _known_tickers = found
    return _known_tickers


@app.get("/api/price/{ticker}")
def price_history(ticker: str, days: int = 365, since: Optional[str] = None,
                  allow_live: int = 0, db: Session = Depends(get_db)):
    """Price history from the shipped DB.

    Without `since` this is the original behaviour: the last `days` rows.

    With `since` (YYYY-MM-DD) the caller declares how far back it needs — the
    trade-timing chart passes the oldest congressional trade it's plotting. If
    the DB snapshot doesn't reach that far and `allow_live=1`, the missing deep
    tail is fetched on demand and prepended. `days` is ignored in that mode;
    the window is [since, now].

    The on-demand path only runs for symbols we already know about — see
    known_tickers().
    """
    # Dates are compared as strings throughout, so a malformed `since` wouldn't
    # error — it would just filter oddly and look like missing data. An empty
    # `?since=` stays equivalent to omitting it rather than becoming an error.
    since = since or None
    if since is not None and not _ISO_DATE.match(since):
        raise HTTPException(status_code=422, detail="since must be YYYY-MM-DD")

    tk = ticker.upper()
    rows = (
        db.query(PriceHistory)
        .filter(PriceHistory.ticker == tk)
        .order_by(PriceHistory.date)
        .all()
    )
    out = [{"date": r.date, "close": r.close, "volume": r.volume} for r in rows]
    if not since:
        return out[-days:]

    # The snapshot covers the request when its earliest row is at or before
    # `since`. Otherwise everything before out[0] is the gap we can fill.
    if (not out or out[0]["date"] > since) and allow_live:
        if len(tk) <= MAX_TICKER_LEN and tk in known_tickers():
            deep = _price_live.get_prices(tk, since=since)
            if deep:
                # Prefer the DB in the overlap: it's daily, the fallback weekly.
                floor = out[0]["date"] if out else None
                out = [r for r in deep if floor is None or r["date"] < floor] + out
        else:
            _price_live.note_refused(tk)

    return [r for r in out if r["date"] >= since]


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


def _fetch_google_news_rss(ticker: str, limit: int = 10):
    """Free Google News RSS fallback — no API key, no auth."""
    import urllib.request, urllib.parse
    from xml.etree import ElementTree as _ET
    from email.utils import parsedate_to_datetime
    from news import sentiment_score

    q = urllib.parse.quote(f"{ticker} stock")
    url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        body = urllib.request.urlopen(req, timeout=8).read()
        root = _ET.fromstring(body)
    except Exception:
        return []

    out = []
    for item in root.iter("item"):
        title  = (item.findtext("title") or "").strip()
        link   = (item.findtext("link")  or "").strip()
        pub    = item.findtext("pubDate")
        source = item.find("{*}source") or item.find("source")
        publisher = source.text if source is not None and source.text else "Google News"
        pub_iso = None
        if pub:
            try:
                pub_iso = parsedate_to_datetime(pub).isoformat()
            except Exception:
                pub_iso = pub
        if title and link:
            out.append({
                "title":        title,
                "url":          link,
                "publisher":    publisher,
                "published_at": pub_iso,
                "sentiment":    sentiment_score(title),
                "source_trust": _news_trust.trust_for(publisher),
                "source":       "google",
            })
        if len(out) >= limit:
            break
    return out


_CIK_MAP = None
def _cik_for(ticker):
    """ticker -> SEC CIK (int), via the public company_tickers.json (cached)."""
    global _CIK_MAP
    if _CIK_MAP is None:
        _CIK_MAP = {}
        try:
            import json as _json
            from urllib.request import Request as _R, urlopen as _U
            req = _R("https://www.sec.gov/files/company_tickers.json",
                     headers={"User-Agent": "StockTracker contact@example.com"})
            data = _json.loads(_U(req, timeout=20).read().decode("utf-8"))
            _CIK_MAP = {v["ticker"].upper(): v["cik_str"] for v in data.values()}
        except Exception:
            _CIK_MAP = {}
    return _CIK_MAP.get(ticker.upper())


@app.get("/api/live/profile/{ticker}")
def live_profile(ticker: str):
    """Company business summary, C-suite roster, and recent SEC filings."""
    t = ticker.upper()
    out = {
        "ticker": t, "summary": None, "officers": [], "website": None,
        "sec_url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker={t}&type=&dateb=&owner=include&count=40",
        "filings": [],
    }
    try:
        info = yf.Ticker(t).info or {}
        out["summary"] = info.get("longBusinessSummary")
        out["website"] = info.get("website")
        out["officers"] = [
            {"name": o.get("name"), "title": o.get("title"),
             "age": o.get("age"), "pay": o.get("totalPay")}
            for o in (info.get("companyOfficers") or [])
        ][:8]
    except Exception:
        pass
    cik = _cik_for(t)
    if cik:
        out["cik"] = cik
        try:
            import json as _json
            from urllib.request import Request as _R, urlopen as _U
            padded = str(cik).zfill(10)
            req = _R(f"https://data.sec.gov/submissions/CIK{padded}.json",
                     headers={"User-Agent": "StockTracker contact@example.com"})
            rec = _json.loads(_U(req, timeout=15).read().decode("utf-8")).get("filings", {}).get("recent", {})
            forms, dates = rec.get("form", []), rec.get("filingDate", [])
            accs, docs = rec.get("accessionNumber", []), rec.get("primaryDocument", [])
            # Skip the ownership-form flood (3/4/5) so material corporate filings
            # (10-K, 10-Q, 8-K, DEF 14A, S-1, etc.) actually surface.
            SKIP = {"3", "4", "5", "3/A", "4/A", "5/A", "144", "144/A"}
            for i in range(len(forms)):
                if forms[i] in SKIP:
                    continue
                acc = accs[i].replace("-", "")
                out["filings"].append({
                    "form": forms[i], "date": dates[i],
                    "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{docs[i]}",
                })
                if len(out["filings"]) >= 20:
                    break
        except Exception:
            pass
    return out


_BIO_CACHE = {}
@app.get("/api/live/exec_bio")
def exec_bio(name: str):
    """Short bio for an executive via the Wikipedia REST summary (cached)."""
    key = name.strip().lower()
    if key in _BIO_CACHE:
        return _BIO_CACHE[key]
    out = {"name": name, "bio": None, "url": None}
    try:
        import json as _json
        from urllib.request import Request as _R, urlopen as _U
        from urllib.parse import quote as _q
        slug = _q(name.strip().replace(" ", "_"))
        req = _R(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
                 headers={"User-Agent": "StockTracker/1.0"})
        d = _json.loads(_U(req, timeout=10).read().decode("utf-8"))
        # Only accept a real article (skip disambiguation / missing pages).
        if d.get("type") == "standard" and d.get("extract"):
            out["bio"] = d["extract"]
            out["url"] = d.get("content_urls", {}).get("desktop", {}).get("page")
    except Exception:
        pass
    _BIO_CACHE[key] = out
    return out


@app.get("/api/live/news/{ticker}")
def live_news(ticker: str, limit: int = 10):
    """Latest news fetched live from Yahoo Finance + Google News RSS fallback."""
    try:
        from news import sentiment_score
        t        = yf.Ticker(ticker.upper())
        articles = (t.news or [])[:limit]
        result   = []
        for a in articles:
            # New yfinance schema nests fields under "content"
            c = a.get("content") if isinstance(a.get("content"), dict) else a
            title     = c.get("title", "") or ""
            publisher = ""
            prov = c.get("provider")
            if isinstance(prov, dict):
                publisher = prov.get("displayName", "")
            else:
                publisher = a.get("publisher", "")
            url = ""
            for key in ("canonicalUrl", "clickThroughUrl"):
                v = c.get(key)
                if isinstance(v, dict) and v.get("url"):
                    url = v["url"]; break
            if not url:
                url = a.get("link") or a.get("url", "")
            # pubDate is ISO string in new schema; providerPublishTime is unix ts in old
            pub_iso = None
            pub_date = c.get("pubDate") or c.get("displayTime")
            if pub_date:
                pub_iso = str(pub_date)
            else:
                ts = a.get("providerPublishTime")
                if ts:
                    pub_iso = datetime.fromtimestamp(ts).isoformat()
            result.append({
                "title":        title,
                "url":          url,
                "publisher":    publisher,
                "published_at": pub_iso,
                "sentiment":    sentiment_score(title),
                "source_trust": _news_trust.trust_for(publisher),
                "source":       "yahoo",
            })

        # Supplement with Google News RSS so we always have web-search results
        seen_urls = {a["url"] for a in result if a.get("url")}
        google = _fetch_google_news_rss(ticker, limit=limit)
        for g in google:
            if g["url"] in seen_urls:
                continue
            result.append(g)

        # Sort newest first
        result.sort(key=lambda a: a.get("published_at") or "", reverse=True)
        return result[: limit * 2]
    except Exception as e:
        # Even on yfinance failure, try Google News
        try:
            return _fetch_google_news_rss(ticker, limit=limit)
        except Exception:
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
    if READ_ONLY:
        return JSONResponse(status_code=403, content={"error": "read-only host"})
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

    # NASDAQ FTP is only a fallback (the NASDAQ screener API is primary), and it
    # frequently times out from cloud/datacenter IPs — so a failure is a warning,
    # not a hard error.
    def check_ftp_nasdaq():
        try:
            req = urllib.request.urlopen(
                "https://ftp.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", timeout=8)
            lines = req.read().decode("utf-8").splitlines()
            return ("ok" if len(lines) > 1000 else "warn"), f"{len(lines)} lines"
        except Exception as e:
            return "warn", f"FTP fallback unavailable (API is primary): {str(e)[:60]}"

    def check_ftp_other():
        try:
            req = urllib.request.urlopen(
                "https://ftp.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", timeout=8)
            lines = req.read().decode("utf-8").splitlines()
            return ("ok" if len(lines) > 1000 else "warn"), f"{len(lines)} lines"
        except Exception as e:
            return "warn", f"FTP fallback unavailable (API is primary): {str(e)[:60]}"

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


# ── Political data refresh trigger ───────────────────────────────────────────

_pol_status = {"running": False, "last_run": None, "last_result": None}

@app.get("/api/pol/status")
def pol_status():
    return _pol_status

@app.post("/api/pol/refresh")
def pol_refresh(step: Optional[str] = None):
    if READ_ONLY:
        return JSONResponse(status_code=403, content={"error": "read-only host"})
    if _pol_status["running"]:
        return JSONResponse(status_code=409, content={"error": "Already running"})

    def _run():
        _pol_status["running"]  = True
        _pol_status["last_run"] = datetime.utcnow().isoformat()
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            cmd = [sys.executable, os.path.join(script_dir, "pol_refresh.py")]
            if step:
                cmd.append(f"--{step}")
            env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                bufsize=1, cwd=script_dir, env=env,
            )
            for line in proc.stdout:
                pass
            proc.wait()
            _pol_status["last_result"] = (
                "success" if proc.returncode == 0 else f"failed (exit {proc.returncode})"
            )
        except Exception as e:
            _pol_status["last_result"] = f"error: {e}"
        finally:
            _pol_status["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


# ── Trade-activity counts for screener join ──────────────────────────────────

@app.get("/api/trade_counts")
def stocks_trade_counts(days: int = 30, db: Session = Depends(get_pol_db)):
    """Returns {ticker: {pol_count, insider_count}} for cross-tab screener join."""
    from datetime import date as _d, timedelta as _td
    since = _d.today() - _td(days=days)

    pol_rows = db.execute(text("""
        SELECT ticker, COUNT(*) FROM congressional_trades
        WHERE transaction_date >= :since AND ticker IS NOT NULL
        GROUP BY ticker
    """), {"since": since}).fetchall()
    ins_rows = db.execute(text("""
        SELECT ticker, COUNT(*) FROM insider_trades
        WHERE transaction_date >= :since AND ticker IS NOT NULL
        GROUP BY ticker
    """), {"since": since}).fetchall()

    def _blank():
        return {"pol_count": 0, "insider_count": 0, "conflict": False, "conflict_count": 0}

    out = {}
    for ticker, cnt in pol_rows:
        out.setdefault(ticker, _blank())["pol_count"] = cnt
    for ticker, cnt in ins_rows:
        out.setdefault(ticker, _blank())["insider_count"] = cnt

    for ticker, cnt in _conflicted_tickers(days).items():
        e = out.setdefault(ticker, _blank())
        e["conflict"] = True
        e["conflict_count"] = cnt
    return {"days": days, "counts": out}


@app.get("/api/integrity")
def integrity():
    """Read-only data-integrity report (duplicates, orphans, outliers)."""
    try:
        import validate
        findings, _ = validate.report(fix=False)
        return findings
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── Political API ─────────────────────────────────────────────────────────────

def _sane_insider(q):
    """Drop filer typos from an InsiderTrade query.

    A Form 4 reports a transaction that already happened, so it can never
    post-date its own filing. A handful of rows break that — mostly year slips
    like 2023 keyed as 2033 — and because every listing sorts by
    transaction_date desc, those land at the very top of the page. The
    congressional side already guards its own dates in pol_stats; this is the
    same idea, expressed against filed_date so it also catches typos that land
    in the past (2023-12-31 filed 2023-01-03) rather than only future ones.

    Rows with no filed_date are kept — there's nothing to check them against.
    """
    return q.filter(or_(InsiderTrade.filed_date.is_(None),
                        InsiderTrade.transaction_date <= InsiderTrade.filed_date))


@app.get("/api/pol/stats")
def pol_stats(db: Session = Depends(get_pol_db)):
    from datetime import date as _date
    # most recent disclosed trade (ignore filer-typo'd future dates)
    latest = db.query(func.max(CongressionalTrade.transaction_date)).filter(
        CongressionalTrade.transaction_date <= _date.today()).scalar()
    return {
        "total_politicians":   db.query(func.count(Politician.bioguide_id)).scalar() or 0,
        "total_congressional": db.query(func.count(CongressionalTrade.trade_id)).scalar() or 0,
        "total_insider":       _sane_insider(
            db.query(func.count(InsiderTrade.filing_id))).scalar() or 0,
        "total_committees":    db.query(func.count(Committee.committee_id)).scalar() or 0,
        "latest_trade_date":   latest.isoformat() if latest else None,
    }


# ── Committee jurisdiction → market sectors (conflict-of-interest heuristic) ──
# Sector strings must match stocks.db Stock.sector (yfinance taxonomy).
# Keyword-matched against the committee name so it covers House+Senate variants.
COMMITTEE_SECTOR_RULES = [
    # Finance / banking / tax / capital markets / housing finance
    (("financial services", "banking", "finance", "ways and means",
      "capital markets", "monetary", "financial institutions", "digital assets",
      "securities", "insurance", "pensions"),
        {"Financial Services", "Real Estate"}),
    # Housing & urban
    (("housing", "urban", "real estate"),
        {"Real Estate", "Financial Services"}),
    # Energy / environment / climate / water
    (("energy", "natural resources", "environment", "climate", "water"),
        {"Energy", "Utilities", "Basic Materials"}),
    # Defense
    (("armed services", "defense", "seapower", "tactical", "strategic forces",
      "military"),
        {"Industrials"}),
    # Broad commerce / science / transportation / telecom / innovation
    (("commerce", "science", "transportation", "infrastructure",
      "aviation", "highways", "railroads", "maritime", "coast guard",
      "telecommunication", "communications", "technology", "innovation",
      "space"),
        {"Industrials", "Technology", "Communication Services"}),
    # Health / pharma
    (("health", "aging", "pharmaceutical", "public health"),
        {"Healthcare"}),
    # Agriculture / food
    (("agriculture", "nutrition", "forestry", "food"),
        {"Consumer Defensive", "Basic Materials"}),
    # Consumer protection / trade
    (("consumer protection", "consumer affairs"),
        {"Consumer Cyclical", "Consumer Defensive"}),
    # Cyber / tech-leaning oversight
    (("judiciary", "cybersecurity", "antitrust", "intellectual property"),
        {"Technology", "Communication Services"}),
    (("homeland security", "border"),
        {"Industrials", "Technology"}),
    (("foreign affairs", "foreign relations", "intelligence"),
        {"Energy", "Industrials"}),
    # Veterans
    (("veterans",),
        {"Healthcare"}),
    # Small business
    (("small business",),
        {"Financial Services", "Industrials"}),
    # Indian affairs / interior land & mineral
    (("indian affairs", "mineral", "mining", "public lands"),
        {"Basic Materials", "Energy"}),
]


def _committee_sectors(name):
    """Sectors a committee's jurisdiction plausibly touches (may be empty)."""
    n = (name or "").lower()
    sectors = set()
    for keywords, secs in COMMITTEE_SECTOR_RULES:
        if any(k in n for k in keywords):
            sectors |= secs
    return sectors


def _ticker_sectors(tickers):
    """ticker -> sector from stocks.db (only universe stocks are known)."""
    tickers = [t for t in set(tickers) if t]
    if not tickers:
        return {}
    sdb = SessionLocal()
    try:
        rows = sdb.query(Stock.ticker, Stock.sector).filter(Stock.ticker.in_(tickers)).all()
        return {t: s for t, s in rows}
    finally:
        sdb.close()


def _tickers_in_sectors(sectors):
    """All universe tickers whose sector is in the given set."""
    if not sectors:
        return []
    sdb = SessionLocal()
    try:
        rows = sdb.query(Stock.ticker).filter(Stock.sector.in_(list(sectors))).all()
        return [r[0] for r in rows]
    finally:
        sdb.close()


def _conflicted_tickers(days=365):
    """{ticker: conflict_trade_count} — congressional trades (within `days`) where the
    trading politician sits on a committee whose jurisdiction sectors include the
    traded ticker's sector. Powers the screener conflict badge + filter."""
    from datetime import date as _d, timedelta as _td
    since = _d.today() - _td(days=days)
    pdb = PolSessionLocal()
    try:
        mem = pdb.execute(text("""
            SELECT m.bioguide_id, c.name
            FROM committee_memberships m JOIN committees c ON c.committee_id = m.committee_id
        """)).fetchall()
        bio_sectors = {}
        for bio, cname in mem:
            s = _committee_sectors(cname)
            if s:
                bio_sectors.setdefault(bio, set()).update(s)
        if not bio_sectors:
            return {}
        trades = pdb.execute(text("""
            SELECT bioguide_id, ticker FROM congressional_trades
            WHERE transaction_date >= :since AND ticker IS NOT NULL
        """), {"since": since}).fetchall()
    finally:
        pdb.close()

    tsec = _ticker_sectors({t for _, t in trades})  # ticker -> sector (stocks.db)
    counts = {}
    for bio, ticker in trades:
        sec = tsec.get(ticker)
        if sec and sec in bio_sectors.get(bio, ()):
            counts[ticker] = counts.get(ticker, 0) + 1
    return counts


@app.get("/api/pol/committees")
def pol_committees(db: Session = Depends(get_pol_db)):
    """Committees that have at least one member, for the trade-feed filter.
    Includes a trade count (trades by members) and jurisdiction sectors."""
    member_ids = db.query(CommitteeMembership.committee_id).distinct().subquery()
    rows = (
        db.query(Committee)
        .filter(Committee.committee_id.in_(db.query(member_ids.c.committee_id)))
        .order_by(Committee.chamber, Committee.name)
        .all()
    )
    counts = dict(db.execute(text("""
        SELECT m.committee_id, COUNT(*) AS cnt
        FROM committee_memberships m
        JOIN congressional_trades t ON t.bioguide_id = m.bioguide_id
        GROUP BY m.committee_id
    """)).fetchall())
    return {"committees": [
        {
            "committee_id": c.committee_id,
            "name":         c.name,
            "chamber":      c.chamber,
            "trade_count":  counts.get(c.committee_id, 0),
            "sectors":      sorted(_committee_sectors(c.name)),
        }
        for c in rows
    ]}


@app.get("/api/pol/trades")
def pol_trades(
    ticker:    Optional[str] = None,
    bioguide:  Optional[str] = None,
    chamber:   Optional[str] = None,
    txn_type:  Optional[str] = None,
    committee: Optional[str] = None,
    conflicts_only: bool = False,
    days:      Optional[int] = None,
    sort:     str = "transaction_date",
    order:    str = "desc",
    limit:    int = 100,
    offset:   int = 0,
    db: Session = Depends(get_pol_db),
):
    q = db.query(CongressionalTrade, Politician).outerjoin(
        Politician, CongressionalTrade.bioguide_id == Politician.bioguide_id
    )
    if ticker:   q = q.filter(CongressionalTrade.ticker == ticker.upper())
    if bioguide: q = q.filter(CongressionalTrade.bioguide_id == bioguide)
    if chamber:  q = q.filter(Politician.chamber == chamber)
    if txn_type: q = q.filter(CongressionalTrade.transaction_type == txn_type)

    # Committee context drives both the membership filter and conflict flagging.
    jurisdiction = set()
    if committee:
        # Restrict to trades by members of the selected committee.
        member_ids = db.query(CommitteeMembership.bioguide_id).filter(
            CommitteeMembership.committee_id == committee
        )
        q = q.filter(CongressionalTrade.bioguide_id.in_(member_ids))

        cmt = db.query(Committee).filter(Committee.committee_id == committee).first()
        jurisdiction = _committee_sectors(cmt.name) if cmt else set()

    if conflicts_only:
        # Conflict = trade in a ticker whose sector overlaps committee jurisdiction.
        # No committee / no mapped jurisdiction => no conflicts (empty result).
        conflict_tickers = _tickers_in_sectors(jurisdiction)
        q = q.filter(CongressionalTrade.ticker.in_(conflict_tickers or ["\0"]))
    if days:
        from datetime import date as _d, timedelta as _td
        q = q.filter(CongressionalTrade.transaction_date >= _d.today() - _td(days=days))

    sort_col = {
        "transaction_date": CongressionalTrade.transaction_date,
        "disclosure_date":  CongressionalTrade.disclosure_date,
        "amount":           CongressionalTrade.amount_max,
        "ticker":           CongressionalTrade.ticker,
    }.get(sort, CongressionalTrade.transaction_date)
    q = q.order_by(sort_col.desc() if order == "desc" else sort_col)

    total = q.count()
    rows  = q.offset(offset).limit(limit).all()

    # Look up sectors for this page's tickers (stocks.db); flag jurisdiction overlap.
    sector_map = _ticker_sectors([t.ticker for t, _ in rows])

    result = []
    for trade, pol in rows:
        sector = sector_map.get(trade.ticker)
        result.append({
            "trade_id":         trade.trade_id,
            "ticker":           trade.ticker,
            "asset_description":trade.asset_description,
            "transaction_date": trade.transaction_date.isoformat() if trade.transaction_date else None,
            "disclosure_date":  trade.disclosure_date.isoformat()  if trade.disclosure_date  else None,
            "transaction_type": trade.transaction_type,
            "amount_min":       trade.amount_min,
            "amount_max":       trade.amount_max,
            "owner":            trade.owner,
            "bioguide_id":      trade.bioguide_id,
            "politician_name":  f"{pol.first_name} {pol.last_name}" if pol else trade.bioguide_id,
            "chamber":          pol.chamber if pol else None,
            "party":            pol.party   if pol else None,
            "state":            pol.state   if pol else None,
            "sector":           sector,
            "conflict":         bool(sector and sector in jurisdiction),
        })
    return {
        "total": total,
        "trades": result,
        "jurisdiction": sorted(jurisdiction),
    }


@app.get("/api/pol/politician/{bioguide_id}")
def pol_politician(bioguide_id: str, asset: str = "", db: Session = Depends(get_pol_db)):
    pol = db.query(Politician).filter(Politician.bioguide_id == bioguide_id).first()
    if not pol:
        return JSONResponse(status_code=404, content={"error": "Not found"})

    committees = db.query(Committee, CommitteeMembership).join(
        CommitteeMembership, Committee.committee_id == CommitteeMembership.committee_id
    ).filter(CommitteeMembership.bioguide_id == bioguide_id).all()

    # optional asset filter — 'treasury' restricts to direct Treasury/T-Bill rows
    treasury_only = asset == "treasury"
    trades_q = db.query(CongressionalTrade).filter(
        CongressionalTrade.bioguide_id == bioguide_id)
    if treasury_only:
        _a = func.lower(CongressionalTrade.asset_description)
        trades_q = trades_q.filter(
            (CongressionalTrade.ticker == "TREAS") | _a.like("%treasury%"))
    trades_q = trades_q.order_by(CongressionalTrade.transaction_date.desc())
    total_trades = trades_q.count()
    recent = trades_q.limit(50).all()

    # Top tickers traded (same asset filter)
    tt_clause = ("AND (ticker = 'TREAS' OR LOWER(asset_description) LIKE '%treasury%')"
                 if treasury_only else "")
    top_tickers = db.execute(
        text(f"""
            SELECT ticker, COUNT(*) as cnt,
                   SUM((amount_min + amount_max) / 2) as total_vol
            FROM congressional_trades
            WHERE bioguide_id = :bio {tt_clause}
            GROUP BY ticker ORDER BY cnt DESC LIMIT 10
        """), {"bio": bioguide_id}
    ).fetchall()

    return {
        "politician": {
            "bioguide_id": pol.bioguide_id,
            "first_name":  pol.first_name,
            "last_name":   pol.last_name,
            "chamber":     pol.chamber,
            "party":       pol.party,
            "state":       pol.state,
            "district":    pol.district,
            "active":      pol.active,
        },
        "committees": [
            {"committee_id": c.committee_id, "name": c.name, "role": m.role}
            for c, m in committees
        ],
        "total_trades": total_trades,
        "asset_filter": asset or None,
        "top_tickers":  [{"ticker": r[0], "count": r[1], "volume": r[2]} for r in top_tickers],
        "recent_trades": [
            {
                "trade_id":         t.trade_id,
                "ticker":           t.ticker,
                "asset":            t.asset_description,
                "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
                "transaction_type": t.transaction_type,
                "amount_min":       t.amount_min,
                "amount_max":       t.amount_max,
            } for t in recent
        ],
    }


@app.get("/api/pol/leaderboard")
def pol_leaderboard(
    metric: str = "ticker_count",   # 'ticker_count' | 'politician_volume' | 'sector_volume'
    days:   int = 30,
    limit:  int = 20,
    db: Session = Depends(get_pol_db),
):
    from datetime import date as _d, timedelta as _td
    since = _d.today() - _td(days=days)

    if metric == "ticker_count":
        rows = db.execute(text("""
            SELECT ticker, COUNT(*) AS cnt,
                   SUM((amount_min + amount_max) / 2) AS vol
            FROM congressional_trades
            WHERE transaction_date >= :since
            GROUP BY ticker ORDER BY cnt DESC LIMIT :lim
        """), {"since": since, "lim": limit}).fetchall()
        return {"items": [{"ticker": r[0], "trade_count": r[1], "volume": r[2]} for r in rows]}

    if metric == "politician_volume":
        rows = db.execute(text("""
            SELECT t.bioguide_id, COUNT(*) AS cnt,
                   SUM((t.amount_min + t.amount_max) / 2) AS vol
            FROM congressional_trades t
            WHERE t.transaction_date >= :since
            GROUP BY t.bioguide_id ORDER BY vol DESC LIMIT :lim
        """), {"since": since, "lim": limit}).fetchall()
        items = []
        for r in rows:
            pol = db.query(Politician).filter(Politician.bioguide_id == r[0]).first()
            items.append({
                "bioguide_id": r[0],
                "name":   f"{pol.first_name} {pol.last_name}" if pol else r[0],
                "party":  pol.party  if pol else None,
                "state":  pol.state  if pol else None,
                "chamber":pol.chamber if pol else None,
                "trade_count": r[1],
                "volume":      r[2],
            })
        return {"items": items}

    return JSONResponse(status_code=400, content={"error": f"Unknown metric: {metric}"})


@app.get("/api/pol/relationships")
def pol_relationships(
    party: str = "republican",
    limit: int = 30,
    min_shared_stocks: int = 3,
    min_shared_committees: int = 2,
    min_shared_sectors: int = 3,
    cotrade_days: int = 14,
    min_cotrades: int = 1,
    db: Session = Depends(get_pol_db),
):
    """Radial relationship web for one party.

    Main ring  = top `limit` active members of `party` by trade volume, plus any
                 member of that party named in a curated edge.
    Outer rings = figures (other-party members, executive branch, businesses)
                 reachable from the main ring through the curated overlay.
    Edges       = curated overlay (business deals, appointments, exec-branch ties)
                 merged with DB-derived edges among the bounded node set:
                   • shared_stock         — both ever traded the same tickers
                   • co_trade             — both traded the SAME ticker within
                                            `cotrade_days` of each other
                   • shared_sector        — overlap in heavily-traded market sectors
                   • shared_committee     — both sit on the same committees
                   • committee_leadership — both hold Chair/Ranking on a committee
                   • same_state           — same state delegation
    """
    from collections import defaultdict
    limit = max(1, min(limit, 100))   # bound main-ring size (avoid oversized graphs)
    party_norm = "Democrat" if party.lower().startswith("d") else "Republican"
    hub_id = "HUB_DEM" if party_norm == "Democrat" else "HUB_REP"

    overlay  = _load_relationships()
    ext_by_id = {n["id"]: n for n in overlay["external_nodes"]}

    # 1) Main set: top active members of this party by trade volume …
    vol_rows = db.execute(text("""
        SELECT p.bioguide_id
        FROM politicians p
        JOIN congressional_trades t ON t.bioguide_id = p.bioguide_id
        WHERE p.party = :party AND p.active = 1
        GROUP BY p.bioguide_id
        ORDER BY SUM((t.amount_min + t.amount_max) / 2) DESC
        LIMIT :lim
    """), {"party": party_norm, "lim": limit}).fetchall()
    main_ids = {r[0] for r in vol_rows}

    # … plus any member of this party explicitly named in a curated edge (so a
    #    cabinet pick's former seat shows even if the member is now inactive).
    curated_member_ids = {
        e for edge in overlay["edges"] for e in (edge["source"], edge["target"])
        if e not in ext_by_id
    }
    if curated_member_ids:
        main_ids |= {
            p.bioguide_id for p in db.query(Politician).filter(
                Politician.bioguide_id.in_(curated_member_ids),
                Politician.party == party_norm,
            ).all()
        }

    if not main_ids:
        return {"party": party_norm, "hub": hub_id, "nodes": [], "edges": [], "counts": {}}

    # 2) Curated-adjacency closure from the main set — pulls in the connected
    #    cluster (e.g. member -> cabinet pick -> President). Bounded to 3 hops.
    adj = defaultdict(list)
    for edge in overlay["edges"]:
        adj[edge["source"]].append(edge["target"])
        adj[edge["target"]].append(edge["source"])
    depth = {bio: 1 for bio in main_ids}     # main ring = depth 1
    frontier = set(main_ids)
    for _ in range(3):
        nxt = set()
        for node in frontier:
            for nb in adj.get(node, []):
                if nb not in depth:
                    depth[nb] = depth[node] + 1
                    nxt.add(nb)
        frontier = nxt
        if not frontier:
            break
    included = set(depth)

    edges = []

    # 3) Curated edges fully inside the included set.
    for edge in overlay["edges"]:
        s, t = edge["source"], edge["target"]
        if s in included and t in included:
            edges.append({
                "from": s, "to": t,
                "kind":  edge.get("kind", "other"),
                "label": edge.get("label", ""),
                "weight": edge.get("weight", 1),
                "illustrative": bool(edge.get("illustrative", False)),
                "source_url": edge.get("source_url"),
            })

    # 4) Derived edges over the bounded congress set (>=1 endpoint in main ring).
    congress_ids = [n for n in included if n not in ext_by_id]
    if congress_ids:
        SECTOR_HEAVY = 3   # min trades in a sector for it to count as "heavy" exposure
        tickers_by_pol = defaultdict(set)                 # shared_stock
        dates_by_pol_ticker = defaultdict(list)           # co_trade: (bio,ticker) -> [dates]
        sector_trades = defaultdict(lambda: defaultdict(int))  # bio -> sector -> trade count
        trade_rows = (db.query(CongressionalTrade.bioguide_id, CongressionalTrade.ticker,
                               CongressionalTrade.transaction_date)
                        .filter(CongressionalTrade.bioguide_id.in_(congress_ids),
                                CongressionalTrade.ticker.isnot(None),
                                CongressionalTrade.ticker != "")
                        .all())
        tk_sector = _ticker_sectors({tk for _, tk, _ in trade_rows})   # ticker -> sector (stocks.db)
        for bio, tk, dt in trade_rows:
            tickers_by_pol[bio].add(tk)
            if dt is not None:
                dates_by_pol_ticker[(bio, tk)].append(dt)
            sec = tk_sector.get(tk)
            if sec:
                sector_trades[bio][sec] += 1
        heavy_sectors = {bio: {s for s, c in secs.items() if c >= SECTOR_HEAVY}
                         for bio, secs in sector_trades.items()}

        comms_by_pol = defaultdict(set)
        lead_by_pol  = defaultdict(set)   # committees where the member holds a leadership role
        for bio, cm, role in (db.query(CommitteeMembership.bioguide_id,
                                       CommitteeMembership.committee_id,
                                       CommitteeMembership.role)
                                .filter(CommitteeMembership.bioguide_id.in_(congress_ids))
                                .distinct().all()):
            comms_by_pol[bio].add(cm)
            if role and ("Chair" in role or "Ranking" in role):
                lead_by_pol[bio].add(cm)
        state_by_pol = dict(db.query(Politician.bioguide_id, Politician.state)
                              .filter(Politician.bioguide_id.in_(congress_ids)).all())

        def _co_timed(da, dbb, win):
            """True if any date in `da` is within `win` days of any date in `dbb`."""
            da, dbb = sorted(da), sorted(dbb)
            i = j = 0
            while i < len(da) and j < len(dbb):
                if abs((da[i] - dbb[j]).days) <= win:
                    return True
                if da[i] < dbb[j]: i += 1
                else:              j += 1
            return False

        ids_sorted = sorted(congress_ids)
        for i in range(len(ids_sorted)):
            for j in range(i + 1, len(ids_sorted)):
                a, b = ids_sorted[i], ids_sorted[j]
                if a not in main_ids and b not in main_ids:
                    continue
                shared_tk = tickers_by_pol[a] & tickers_by_pol[b]
                if len(shared_tk) >= min_shared_stocks:
                    top = sorted(shared_tk)[:5]
                    edges.append({
                        "from": a, "to": b, "kind": "shared_stock",
                        "label": f"{len(shared_tk)} shared stocks: {', '.join(top)}"
                                 + ("…" if len(shared_tk) > 5 else ""),
                        "weight": len(shared_tk), "illustrative": False, "source_url": None,
                    })

                # co_trade: same ticker traded within `cotrade_days` of each other
                co = [tk for tk in shared_tk
                      if _co_timed(dates_by_pol_ticker.get((a, tk), []),
                                   dates_by_pol_ticker.get((b, tk), []), cotrade_days)]
                if len(co) >= min_cotrades:
                    top = sorted(co)[:5]
                    edges.append({
                        "from": a, "to": b, "kind": "co_trade",
                        "label": f"co-timed on {len(co)} stock(s) (≤{cotrade_days}d): {', '.join(top)}"
                                 + ("…" if len(co) > 5 else ""),
                        "weight": len(co), "illustrative": False, "source_url": None,
                    })

                # shared_sector: overlap in heavily-traded sectors
                shared_sec = heavy_sectors.get(a, set()) & heavy_sectors.get(b, set())
                if len(shared_sec) >= min_shared_sectors:
                    edges.append({
                        "from": a, "to": b, "kind": "shared_sector",
                        "label": f"{len(shared_sec)} shared sectors: {', '.join(sorted(shared_sec))}",
                        "weight": len(shared_sec), "illustrative": False, "source_url": None,
                    })

                shared_cm = comms_by_pol[a] & comms_by_pol[b]
                if len(shared_cm) >= min_shared_committees:
                    edges.append({
                        "from": a, "to": b, "kind": "shared_committee",
                        "label": f"{len(shared_cm)} shared committees",
                        "weight": len(shared_cm), "illustrative": False, "source_url": None,
                    })

                # committee_leadership: both hold a Chair/Ranking role on the same committee
                lead_cm = lead_by_pol.get(a, set()) & lead_by_pol.get(b, set())
                if lead_cm:
                    edges.append({
                        "from": a, "to": b, "kind": "committee_leadership",
                        "label": f"co-lead {len(lead_cm)} committee(s)",
                        "weight": len(lead_cm) + 1, "illustrative": False, "source_url": None,
                    })

                # same_state: same state delegation
                sa, sb = state_by_pol.get(a), state_by_pol.get(b)
                if sa and sa == sb:
                    edges.append({
                        "from": a, "to": b, "kind": "same_state",
                        "label": f"Same-state delegation: {sa}",
                        "weight": 1, "illustrative": False, "source_url": None,
                    })

    # 4b) Outside positions (Schedule E of the annual disclosure) — a real
    #     member -> organisation tie, and the thing the curated overlay only ever
    #     had hand-written samples for. Organisations become their own nodes;
    #     one shared by two members links them through it.
    org_nodes = {}
    if congress_ids:
        pos_rows = (db.query(MemberPosition.bioguide_id, MemberPosition.organization,
                             MemberPosition.position, MemberPosition.year,
                             MemberPosition.source_url)
                      .filter(MemberPosition.bioguide_id.in_(congress_ids),
                              MemberPosition.organization.isnot(None),
                              MemberPosition.organization != "")
                      .all())
        # Keep the most recent filing per (member, organisation) so a position
        # re-disclosed year after year is one edge, not one per year.
        latest = {}
        for bio, org, pos, yr, url in pos_rows:
            key = (bio, org.strip())
            if key not in latest or (yr or 0) > (latest[key][1] or 0):
                latest[key] = (pos, yr, url)
        for (bio, org), (pos, yr, url) in latest.items():
            oid = "ORG_" + re.sub(r"[^A-Za-z0-9]+", "_", org).strip("_")[:60].upper()
            scope = _org_scope.classify(org)
            org_nodes.setdefault(oid, (org, scope))
            edges.append({
                "from": bio, "to": oid, "kind": _org_scope.edge_kind(org),
                "label": f"{pos} — {org}" + (f" ({yr})" if yr else ""),
                "weight": 2, "illustrative": False, "source_url": url,
            })

    # 5) Assemble nodes (hub + every congress / external node in `included`).
    deg = defaultdict(int)
    for e in edges:
        deg[e["from"]] += 1
        deg[e["to"]] += 1

    nodes = [{
        "id": hub_id, "name": f"{party_norm} Party", "party": party_norm,
        "type": "hub", "ring": 0, "value": max(8, len(main_ids)),
    }]
    pol_map = {
        p.bioguide_id: p for p in db.query(Politician).filter(
            Politician.bioguide_id.in_(congress_ids)).all()
    } if congress_ids else {}
    for bio in congress_ids:
        p = pol_map.get(bio)
        nodes.append({
            "id": bio,
            "name": f"{p.first_name} {p.last_name}" if p else bio,
            "party": p.party if p else None,
            "type": "congress",
            "ring": depth.get(bio, 2),
            "value": deg.get(bio, 1),
            "chamber": p.chamber if p else None,
            "state": p.state if p else None,
        })
    for ext_id in included:
        if ext_id not in ext_by_id:
            continue
        n = ext_by_id[ext_id]
        nodes.append({
            "id": ext_id, "name": n.get("name", ext_id),
            "party": n.get("party"), "type": n.get("type", "other"),
            "role": n.get("role"),
            "ring": depth.get(ext_id, 2), "value": deg.get(ext_id, 1),
        })

    for oid, (org, scope) in org_nodes.items():
        nodes.append({
            "id": oid, "name": org, "party": None, "type": "organization",
            "scope": scope, "ring": 2, "value": deg.get(oid, 1),
        })

    # 6) Hub spokes to each main node (anchors the radial web).
    for bio in main_ids:
        edges.append({"from": hub_id, "to": bio, "kind": "hub", "label": "",
                      "weight": 1, "illustrative": False, "source_url": None})

    kind_of = lambda k: sum(1 for e in edges if e["kind"] == k)
    return {
        "party": party_norm,
        "hub":   hub_id,
        "nodes": nodes,
        "edges": edges,
        "counts": {
            "main":             len(main_ids),
            "connected":        len(included) - len(main_ids),
            "shared_stock":     kind_of("shared_stock"),
            "co_trade":         kind_of("co_trade"),
            "shared_sector":    kind_of("shared_sector"),
            "shared_committee": kind_of("shared_committee"),
            "committee_leadership": kind_of("committee_leadership"),
            "same_state":       kind_of("same_state"),
            "position_national": kind_of("position_national"),
            "position_state":    kind_of("position_state"),
            "position_private":  kind_of("position_private"),
            "curated":          sum(1 for e in edges if e["kind"] in
                                    ("business_deal", "appointment", "former_member",
                                     "donor", "family", "other")),
        },
    }


def _mid(t):
    if t.amount_min is None:
        return 0.0
    return (t.amount_min + (t.amount_max or t.amount_min)) / 2.0


def _parse_iso(s):
    from datetime import date as _date
    try:
        return _date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def _window(years, start, end):
    """Resolve a (start_date, end_date) window from an explicit ISO start/end or a
    `years` lookback (end defaults to today, start to end − years)."""
    from datetime import date as _date, timedelta as _td
    end_d = _parse_iso(end) or _date.today()
    start_d = _parse_iso(start) or (end_d - _td(days=365 * max(1, years)))
    if start_d > end_d:
        start_d, end_d = end_d, start_d
    return start_d, end_d


@app.get("/api/pol/treasury")
def pol_treasury(years: int = 20, start: str = "", end: str = "",
                 bioguide: str = "", db: Session = Depends(get_pol_db)):
    """Congressional Treasury / T-Bill activity within a window: a per-period
    purchase-volume histogram (relative buying), most-bought-by-politician and
    -by-committee highlights, and the underlying rows. Window = explicit ISO
    start/end or the last `years`. Treasury = federal Treasury bills/notes/bonds
    held directly (asset_description matches 'treasury' but NOT bond ETFs/funds)."""
    start_d, end_d = _window(years, start, end)
    asset = func.lower(CongressionalTrade.asset_description)
    rows = db.query(CongressionalTrade, Politician).outerjoin(
        Politician, CongressionalTrade.bioguide_id == Politician.bioguide_id
    ).filter(
        asset.like("%treasury%"),
        ~asset.like("%etf%"),
        ~asset.like("%ishares%"),
        ~asset.like("%fund%"),
        CongressionalTrade.transaction_date >= start_d,
        CongressionalTrade.transaction_date <= end_d,
    ).order_by(CongressionalTrade.transaction_date.asc()).all()

    # member -> committees (for the by-committee attribution)
    bio_committees = {}
    for bio, cname in db.execute(text(
        "SELECT m.bioguide_id, c.name FROM committee_memberships m "
        "JOIN committees c ON c.committee_id = m.committee_id"
    )).fetchall():
        bio_committees.setdefault(bio, []).append(cname)

    # always monthly histogram buckets (YYYY-MM); zero-filled across the window so
    # the time axis is uniform and year dividers land correctly
    def bucket(d):
        return d.isoformat()[:7]

    # all distinct purchasers in the window (congressperson dropdown) — built before
    # the bioguide filter so the option list stays stable when one is selected
    all_pols = {}
    for t, p in rows:
        if (t.transaction_type or "").startswith("purchase"):
            all_pols.setdefault(t.bioguide_id,
                                f"{p.first_name} {p.last_name}" if p else t.bioguide_id)
    politicians = sorted(({"bioguide_id": b, "name": n} for b, n in all_pols.items()),
                         key=lambda x: x["name"])

    # per-period purchase volume (histogram) + highlights
    by_bucket, pol_vol, com_vol, trades = {}, {}, {}, []
    purchase_count = 0
    for t, p in rows:
        if bioguide and t.bioguide_id != bioguide:   # optional single-member filter
            continue
        amt = _mid(t)
        is_buy = (t.transaction_type or "").startswith("purchase")
        name = f"{p.first_name} {p.last_name}" if p else t.bioguide_id
        if t.transaction_date and is_buy:
            purchase_count += 1
            bk = bucket(t.transaction_date)
            by_bucket[bk] = by_bucket.get(bk, 0.0) + amt
            pv = pol_vol.setdefault(t.bioguide_id, {"bioguide_id": t.bioguide_id, "name": name,
                 "party": p.party if p else None, "volume": 0.0, "count": 0})
            pv["volume"] += amt; pv["count"] += 1
            for cname in bio_committees.get(t.bioguide_id, []):
                cv = com_vol.setdefault(cname, {"volume": 0.0, "count": 0})
                cv["volume"] += amt; cv["count"] += 1
        trades.append({
            "bioguide_id": t.bioguide_id,
            "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
            "politician_name": name,
            "party": p.party if p else None,
            "transaction_type": t.transaction_type,
            "amount_min": t.amount_min, "amount_max": t.amount_max,
            "asset": t.asset_description,
        })

    # zero-fill every month from window start to end (uniform time axis)
    months, y, m = [], start_d.year, start_d.month
    while (y, m) <= (end_d.year, end_d.month):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    series = [{"period": mk, "volume": round(by_bucket.get(mk, 0.0), 2)} for mk in months]
    top_pol = sorted(pol_vol.values(), key=lambda x: -x["volume"])[:10]
    top_com = sorted(
        ({"committee": k, **v} for k, v in com_vol.items()),
        key=lambda x: -x["volume"])[:10]
    trades.reverse()  # newest first for the table
    return {
        "series": series,
        "granularity": "month",
        "window": {"start": start_d.isoformat(), "end": end_d.isoformat()},
        "by_politician": [{**p, "volume": round(p["volume"], 2)} for p in top_pol],
        "by_committee": [{**c, "volume": round(c["volume"], 2)} for c in top_com],
        "trades": trades[:200],
        "total_volume": round(sum(by_bucket.values()), 2),
        "purchase_count": purchase_count,   # buys driving volume/series
        "trade_count": len(trades),         # all rows incl. sales (table count)
        "politicians": politicians,         # dropdown options (all purchasers in window)
        "selected_bioguide": bioguide or None,
    }


@app.get("/api/market/sp500")
def market_sp500(years: int = 20, start: str = "", end: str = ""):
    """S&P 500 closes for a window (explicit ISO start/end or the last `years`),
    live from yfinance ^GSPC. Weekly bars for ≤3y windows, else monthly."""
    try:
        start_d, end_d = _window(years, start, end)
        span = (end_d - start_d).days
        interval = "1wk" if span <= 365 * 3 else "1mo"
        hist = yf.Ticker("^GSPC").history(
            start=start_d.isoformat(), end=end_d.isoformat(), interval=interval)
        closes = hist["Close"].dropna()
        return {"interval": interval, "points": [
            {"date": idx.strftime("%Y-%m-%d"), "close": round(float(v), 2)}
            for idx, v in closes.items()
        ]}
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": f"S&P fetch failed: {e}"})


@app.get("/api/pol/ticker/{ticker}")
def pol_ticker(ticker: str, days: int = 99999, db: Session = Depends(get_pol_db)):
    from datetime import date as _d, timedelta as _td
    ticker = ticker.upper()
    since  = _d.today() - _td(days=days)
    trades = db.query(CongressionalTrade, Politician).outerjoin(
        Politician, CongressionalTrade.bioguide_id == Politician.bioguide_id
    ).filter(
        CongressionalTrade.ticker == ticker,
        CongressionalTrade.transaction_date >= since,
    ).order_by(CongressionalTrade.transaction_date.desc()).all()

    return {
        "ticker": ticker,
        "trades": [
            {
                "trade_id":         t.trade_id,
                "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
                "disclosure_date":  t.disclosure_date.isoformat()  if t.disclosure_date  else None,
                "transaction_type": t.transaction_type,
                "amount_min":       t.amount_min,
                "amount_max":       t.amount_max,
                "bioguide_id":      t.bioguide_id,
                "politician_name":  f"{p.first_name} {p.last_name}" if p else t.bioguide_id,
                "chamber":          p.chamber if p else None,
                "party":            p.party   if p else None,
            } for t, p in trades
        ],
    }


# ── Insider trades API ───────────────────────────────────────────────────────

@app.get("/api/insider/trades")
def insider_trades(
    ticker:   Optional[str] = None,
    txn_type: Optional[str] = None,
    days:     Optional[int] = None,
    limit:    int = 100,
    offset:   int = 0,
    db: Session = Depends(get_pol_db),
):
    q = _sane_insider(db.query(InsiderTrade))
    if ticker:   q = q.filter(InsiderTrade.ticker == ticker.upper())
    if txn_type: q = q.filter(InsiderTrade.transaction_type == txn_type)
    if days:
        from datetime import date as _d, timedelta as _td
        q = q.filter(InsiderTrade.transaction_date >= _d.today() - _td(days=days))
    q = q.order_by(InsiderTrade.transaction_date.desc())

    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return {
        "total": total,
        "trades": [
            {
                "filing_id":         t.filing_id,
                "ticker":            t.ticker,
                "company_name":      t.company_name,
                "insider_name":      t.insider_name,
                "insider_title":     t.insider_title,
                "transaction_date":  t.transaction_date.isoformat() if t.transaction_date else None,
                "transaction_type":  t.transaction_type,
                "shares":            t.shares,
                "price_per_share":   t.price_per_share,
                "total_value":       t.total_value,
                "shares_owned_after":t.shares_owned_after,
            } for t in rows
        ],
    }


@app.get("/api/insider/ticker/{ticker}")
def insider_ticker(ticker: str, days: int = 99999, db: Session = Depends(get_pol_db)):
    from datetime import date as _d, timedelta as _td
    ticker = ticker.upper()
    since  = _d.today() - _td(days=days)
    rows = _sane_insider(db.query(InsiderTrade)).filter(
        InsiderTrade.ticker == ticker,
        InsiderTrade.transaction_date >= since,
    ).order_by(InsiderTrade.transaction_date.desc()).all()
    return {
        "ticker": ticker,
        "trades": [
            {
                "filing_id":        t.filing_id,
                "insider_name":     t.insider_name,
                "insider_title":    t.insider_title,
                "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
                "transaction_type": t.transaction_type,
                "shares":           t.shares,
                "price_per_share":  t.price_per_share,
                "total_value":      t.total_value,
            } for t in rows
        ],
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

@app.get("/politicians")
def politicians_page():
    return FileResponse(os.path.join(STATIC_DIR, "politicians.html"))

@app.get("/relationships")
def relationships_page():
    return FileResponse(os.path.join(STATIC_DIR, "relationships.html"))

@app.get("/politician/{bioguide_id}")
def politician_detail_page(bioguide_id: str):
    return FileResponse(os.path.join(STATIC_DIR, "politician_detail.html"))

@app.get("/insiders")
def insiders_page():
    return FileResponse(os.path.join(STATIC_DIR, "insiders.html"))

@app.get("/news")
def news_page():
    return FileResponse(os.path.join(STATIC_DIR, "news.html"))


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
