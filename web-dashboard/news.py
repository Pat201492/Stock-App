"""
news.py — Fetch news and sentiment for stocks in the database
"""
import time, warnings
from datetime import datetime
warnings.filterwarnings("ignore")

import yfinance as yf
from database import SessionLocal, News, Stock, PriceHistory, init_db

try:
    from textblob import TextBlob
    HAS_TEXTBLOB = True
except ImportError:
    HAS_TEXTBLOB = False


def sentiment_score(text):
    if not HAS_TEXTBLOB or not text:
        return 0.0
    try:
        return round(TextBlob(text).sentiment.polarity, 3)
    except Exception:
        return 0.0


def fetch_and_store_news(ticker, db, limit=10):
    try:
        t = yf.Ticker(ticker)
        articles = (t.news or [])[:limit]
    except Exception:
        return 0

    saved = 0
    for art in articles:
        # yfinance >=0.2.x nests fields under "content"; fall back to legacy flat schema.
        c = art.get("content", art)

        title = c.get("title", "")
        url = (
            (c.get("canonicalUrl") or {}).get("url")
            or (c.get("clickThroughUrl") or {}).get("url")
            or c.get("link") or c.get("url", "")
        )
        if not title or not url:
            continue

        summary = c.get("summary") or c.get("description") or ""

        existing = db.query(News).filter(News.ticker == ticker, News.url == url).first()
        if existing:
            # Backfill summary on rows ingested before the column existed.
            if summary and not existing.summary:
                existing.summary = summary
                saved += 1
            continue

        # New schema: ISO8601 string in pubDate/displayTime. Legacy: epoch in providerPublishTime.
        ts = art.get("providerPublishTime")
        iso = c.get("pubDate") or c.get("displayTime")
        if ts:
            dt = datetime.fromtimestamp(ts)
        elif iso:
            try:
                dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            except ValueError:
                dt = datetime.utcnow()
        else:
            dt = datetime.utcnow()

        publisher = (c.get("provider") or {}).get("displayName", "") or art.get("publisher", "")

        db.add(News(
            ticker=ticker,
            title=title,
            url=url,
            publisher=publisher,
            published_at=dt,
            sentiment=sentiment_score(title),
            summary=summary,
        ))
        saved += 1

    try:
        db.commit()
    except Exception:
        db.rollback()
    return saved


def fetch_and_store_prices(ticker, db, period="1y"):
    try:
        t    = yf.Ticker(ticker)
        hist = t.history(period=period)
        if hist.empty:
            return 0
    except Exception:
        return 0

    saved = 0
    for date, row in hist.iterrows():
        # Skip bars with no close. yfinance hands back NaN on a bad day, and
        # round(nan, 4) lands in SQLite as NULL — which is worse than having no
        # row at all, because the date then counts as already fetched and the
        # gap can never refill. One bad upstream day did this to 1,491 tickers.
        close = row["Close"]
        if close is None or close != close:      # NaN
            continue
        date_str = date.strftime("%Y-%m-%d")
        existing = (
            db.query(PriceHistory)
            .filter(PriceHistory.ticker == ticker, PriceHistory.date == date_str)
            .first()
        )
        if existing:
            continue
        vol = row.get("Volume")
        db.add(PriceHistory(
            ticker=ticker,
            date=date_str,
            close=round(float(close), 4),
            volume=None if vol is None or vol != vol else float(vol),
        ))
        saved += 1

    try:
        db.commit()
    except Exception:
        db.rollback()
    return saved


NEWS_STALE_HOURS  = 24
PRICE_STALE_HOURS = 6


def _tickers_needing_news(tickers, db):
    """Return tickers with no news in the past NEWS_STALE_HOURS hours."""
    from sqlalchemy import func
    from datetime import timedelta, datetime as _dt
    cutoff = _dt.utcnow() - timedelta(hours=NEWS_STALE_HOURS)
    recent = {
        r.ticker for r in
        db.query(News.ticker)
        .filter(News.ticker.in_(tickers), News.last_updated >= cutoff)
        .distinct().all()
    }
    return [t for t in tickers if t not in recent]


def _purge_null_closes(db):
    """Drop price rows that have no close.

    They carry no information — every reader filters them out — but they still
    occupy the (ticker, date) slot, so the dedupe in fetch_and_store_prices
    treats that day as already done and the hole never fills. Clearing them lets
    this run's 1y fetch put the real bars back.
    """
    n = (db.query(PriceHistory)
           .filter(PriceHistory.close.is_(None))
           .delete(synchronize_session=False))
    if n:
        db.commit()
        print(f"Purged {n} price rows with no close — refilling below.")
    return n


def _tickers_needing_prices(tickers, db):
    """Return tickers with no price row today."""
    from datetime import datetime as _dt
    today = _dt.utcnow().strftime("%Y-%m-%d")
    have = {
        r.ticker for r in
        db.query(PriceHistory.ticker)
        .filter(PriceHistory.ticker.in_(tickers), PriceHistory.date == today)
        .all()
    }
    return [t for t in tickers if t not in have]


def main(tickers=None, limit_per_ticker=10):
    init_db()
    db = SessionLocal()

    if tickers is None:
        rows = db.query(Stock.ticker).order_by(Stock.rank).limit(1500).all()
        tickers = [r.ticker for r in rows]

    _purge_null_closes(db)
    need_news   = _tickers_needing_news(tickers, db)
    need_prices = _tickers_needing_prices(tickers, db)
    print(f"News:   {len(need_news)}/{len(tickers)} tickers need update")
    print(f"Prices: {len(need_prices)}/{len(tickers)} tickers need update")

    all_need = sorted(set(need_news) | set(need_prices), key=lambda t: tickers.index(t) if t in tickers else 9999)

    for i, ticker in enumerate(all_need):
        if i % 50 == 0:
            print(f"  {i}/{len(all_need)}")
        if ticker in need_news:
            fetch_and_store_news(ticker, db, limit=limit_per_ticker)
        if ticker in need_prices:
            fetch_and_store_prices(ticker, db)
        time.sleep(0.3)

    db.close()
    print(f"Done — updated {len(all_need)} tickers.")


if __name__ == "__main__":
    main()
