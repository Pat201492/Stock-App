"""
news_trust.py — Predictive "track record" trust score per news source/publisher.

For every stored article with a sentiment we check whether that sentiment agreed
with the stock's FORWARD price move (FORWARD_DAYS trading days after publication):
a bullish article followed by a gain (or bearish followed by a drop) = a "hit".
A source's trust = its hit-rate across all scorable articles -> a 0..1 score the
UIs render on a red(0) -> green(1) scale. Sources with too few scorable articles
are returned as unrated (score=None).

Computed across News + PriceHistory; cached in-process with a TTL so the news
endpoints stay cheap.
"""
from datetime import datetime, timedelta

from database import SessionLocal, News, PriceHistory

FORWARD_DAYS = 5          # ~1 trading week
MIN_SENT = 0.05           # ignore near-neutral articles
MIN_N = 6                 # need this many scorable articles to rate a source
_TTL = timedelta(hours=6)

_cache = {"at": None, "data": {}}


def compute_source_trust(forward_days=FORWARD_DAYS, min_n=MIN_N):
    """Return {publisher: {"score": 0..1|None, "n": int}}."""
    db = SessionLocal()
    try:
        articles = db.query(
            News.ticker, News.publisher, News.published_at, News.sentiment
        ).filter(
            News.sentiment.isnot(None), News.published_at.isnot(None),
            News.publisher.isnot(None),
        ).all()
        if not articles:
            return {}

        tickers = {a.ticker for a in articles if a.ticker}
        # price history per ticker, ascending by date string (YYYY-MM-DD sorts lexically)
        prices = {}
        rows = db.query(PriceHistory.ticker, PriceHistory.date, PriceHistory.close).filter(
            PriceHistory.ticker.in_(tickers)
        ).all()
        for tk, d, close in rows:
            if close:
                prices.setdefault(tk, []).append((d, float(close)))
        for tk in prices:
            prices[tk].sort(key=lambda x: x[0])

        tally = {}  # publisher -> [hits, total]
        for a in articles:
            if a.sentiment is None or abs(a.sentiment) < MIN_SENT:
                continue
            hist = prices.get(a.ticker)
            if not hist:
                continue
            pub_day = a.published_at.strftime("%Y-%m-%d")
            # first price on/after publication
            i = _bisect_date(hist, pub_day)
            if i is None:
                continue
            j = i + forward_days
            if j >= len(hist):
                continue
            base, fwd = hist[i][1], hist[j][1]
            if base <= 0:
                continue
            ret = fwd / base - 1.0
            if abs(ret) < 1e-6:
                continue
            hit = (a.sentiment > 0) == (ret > 0)
            t = tally.setdefault(a.publisher, [0, 0])
            t[0] += 1 if hit else 0
            t[1] += 1

        out = {}
        for pub, (hits, total) in tally.items():
            out[pub] = {
                "score": round(hits / total, 3) if total >= min_n else None,
                "n": total,
            }
        return out
    finally:
        db.close()


def _bisect_date(hist, day):
    """Index of the first (date, close) with date >= day, or None."""
    lo, hi = 0, len(hist)
    while lo < hi:
        mid = (lo + hi) // 2
        if hist[mid][0] < day:
            lo = mid + 1
        else:
            hi = mid
    return lo if lo < len(hist) else None


def get_source_trust():
    """Cached map {publisher: {score, n}} (TTL-refreshed)."""
    now = datetime.utcnow()
    if _cache["at"] is None or (now - _cache["at"]) > _TTL:
        try:
            _cache["data"] = compute_source_trust()
            _cache["at"] = now
        except Exception as e:  # never let trust scoring break the news endpoints
            print(f"[news_trust] compute failed: {e}")
            if _cache["at"] is None:
                _cache["data"] = {}
    return _cache["data"]


def trust_for(publisher):
    """Score 0..1 or None for one publisher."""
    if not publisher:
        return None
    rec = get_source_trust().get(publisher)
    return rec["score"] if rec else None
