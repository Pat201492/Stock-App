"""
price_live.py — guarded on-demand price history for tickers the local backfill
doesn't cover.

`price_history` in stocks.db is built locally and shipped with the DB, so the
serving box normally never touches the network. A few tickers fall outside that
snapshot: brand-new listings (no rows until the nightly news run picks them up)
and the ~3.2k traded symbols that aren't in the universe at all (delisted,
acquired, renamed). Without a fallback the trade-timing chart draws dots over
blank space for those.

Every guard here exists to keep that cold path cold:
  - positive cache — a closed day's close never changes, so cache hard
  - negative cache — dead symbols are the real risk. Without this, every
    pageview for a delisted ticker is another upstream request.
  - single-flight  — N concurrent viewers of one ticker produce one fetch
  - timeout        — a slow upstream must not hang the request

Results are NOT written back to stocks.db: publish.ps1 swaps the whole file on
every data push, so anything written here dies at the next publish.
"""
import threading
from datetime import datetime, timedelta

import yfinance as yf

# Older than the oldest congressional trade (2012-02), so one cached fetch per
# ticker serves every range the UI can ask for; callers slice it with `since`.
FETCH_FLOOR = "2010-01-01"

TTL_OK      = timedelta(hours=12)   # closed-day closes don't change
TTL_MISS    = timedelta(hours=12)   # dead symbols stay dead; don't re-ask
TIMEOUT     = 15                    # seconds, upstream fetch
MAX_ENTRIES = 512                   # cache bound; evicts oldest

_cache = {}          # ticker -> (fetched_at, rows). rows == [] means known-miss
# One lock per ticker, never pruned. The caller only reaches us for symbols on
# its allow-list, so this is bounded by the known-ticker count (a few thousand
# tiny objects). An earlier version pruned locks not yet in _cache, which could
# drop a lock a thread was mid-fetch under and let a second thread fetch the
# same ticker concurrently — the exact thing single-flight is here to prevent.
_locks = {}
_locks_guard = threading.Lock()
_live = {}           # ticker -> [upstream_fetches, rows_found] — feeds backfill scope
_refused = {}        # ticker -> count, callers we declined to fetch for


def get_prices(ticker, since=None):
    """Weekly [{"date","close","volume"}] ascending, or [] if unavailable."""
    ticker = (ticker or "").strip().upper()
    if not ticker:
        return []
    rows = _cached_fetch(ticker)
    if since:
        rows = [r for r in rows if r["date"] >= since]
    return rows


def note_refused(ticker):
    """Record a caller we declined to fetch for (unknown/oversized symbol)."""
    t = (ticker or "")[:32]
    _refused[t] = _refused.get(t, 0) + 1


def stats():
    """Diagnostics: what took the cold path, and what's worth backfilling."""
    ok = [t for t, (_, rows) in _cache.items() if rows]
    return {
        "cached_tickers": len(_cache),
        "cached_with_data": len(ok),
        "cached_empty": len(_cache) - len(ok),
        # upstream_fetches counts cache MISSES, not requests — a ticker served
        # from cache never increments it.
        "live_lookups": {t: {"upstream_fetches": n, "rows": r} for t, (n, r) in
                         sorted(_live.items(), key=lambda kv: -kv[1][0])},
        # Tickers upstream actually has data for — add these to the next
        # local backfill run so they stop needing the network.
        "backfill_candidates": sorted(t for t, (_, r) in _live.items() if r),
        # Symbols the allow-list turned away. A big number here is either a
        # stale allow-list or someone probing the endpoint.
        "refused": dict(sorted(_refused.items(), key=lambda kv: -kv[1])[:50]),
        "refused_total": sum(_refused.values()),
        "note": "in-memory; resets when the service restarts (every publish)",
    }


# ── internals ────────────────────────────────────────────────────────────────

def _fresh(entry):
    if not entry:
        return False
    age = datetime.utcnow() - entry[0]
    return age < (TTL_OK if entry[1] else TTL_MISS)


def _cached_fetch(ticker):
    entry = _cache.get(ticker)
    if _fresh(entry):
        return entry[1]

    with _lock_for(ticker):
        # Another thread may have filled it while we waited on the lock.
        entry = _cache.get(ticker)
        if _fresh(entry):
            return entry[1]

        rows = _fetch(ticker)
        _store(ticker, rows)
        seen = _live.get(ticker, [0, 0])
        _live[ticker] = [seen[0] + 1, len(rows)]
        return rows


def _fetch(ticker):
    try:
        df = yf.download([ticker], start=FETCH_FLOOR, interval="1wk",
                         group_by="ticker", auto_adjust=True,
                         progress=False, threads=False, timeout=TIMEOUT)
    except Exception:
        return []
    if df is None or getattr(df, "empty", True):
        return []
    try:
        sub = df[ticker]
    except Exception:
        return []

    out = []
    for d, r in sub.iterrows():
        close = r.get("Close")
        if close is None or close != close:      # NaN
            continue
        vol = r.get("Volume")
        out.append({
            "date":   d.strftime("%Y-%m-%d"),
            "close":  round(float(close), 4),
            "volume": None if vol is None or vol != vol else float(vol),
        })
    return out


def _store(ticker, rows):
    if len(_cache) >= MAX_ENTRIES:
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
    _cache[ticker] = (datetime.utcnow(), rows)


def _lock_for(ticker):
    with _locks_guard:
        lk = _locks.get(ticker)
        if lk is None:
            lk = _locks[ticker] = threading.Lock()
        return lk
