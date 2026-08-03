"""
backfill_prices.py — deep price history for the congressional trade-timing chart.

Why this exists
---------------
`price_history` is populated as a side effect of news.py, which fetches
period="1y". That backfilled one year on first run and has crept forward one
day at a time since, so the table starts 2025-05. Congressional trades go back
to 2012, which left ~91% of trades plotted over blank chart space.

The table can't deepen on its own: "one year ago" is now *newer* than the
existing floor, so every nightly run's fetch window is already covered.

Scope
-----
Only tickers that need it — in the universe, with at least one trade older than
their current price floor. That's ~1.8k of 3.8k, not the whole universe. Each
one is fetched back to *its own* oldest trade, not period="max" (LMT has data to
1962; its oldest congressional trade is 2012 — the other 50 years are waste).

Resolution
----------
Weekly for the deep tail. The chart is ~1300px across ~14 years, so daily data
older than a year is finer than a pixel, and disclosures run on a 45-day window
anyway. Weekly costs ~850k rows; daily would cost ~4.1M.

Rows are fetched strictly *before* each ticker's existing floor, so the daily
rows already in the table are never touched or mixed with weekly bars (a weekly
bar is dated to the week's start but carries the week's closing price).

Usage
-----
    python backfill_prices.py --dry-run        # show scope, fetch nothing
    python backfill_prices.py                  # run it
    python backfill_prices.py --tickers A,B,C  # specific tickers
    python backfill_prices.py --interval 1d    # daily instead of weekly
"""
import argparse
import sqlite3
import sys
import time
from collections import defaultdict

import yfinance as yf

from database import _DB_PATH as STOCKS_DB
from politicians_database import _DB_PATH as POL_DB

BATCH = 100          # tickers per upstream call
SLEEP = 1.0          # seconds between batches
INTERVAL = "1wk"


def scope(tickers_override=None):
    """-> {ticker: (fetch_from, existing_floor_or_None)}"""
    sc = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    universe = {r[0] for r in sc.execute("SELECT ticker FROM stocks")}
    floors = {t: d for t, d in sc.execute(
        "SELECT ticker, MIN(date) FROM price_history GROUP BY ticker")}
    sc.close()

    pc = sqlite3.connect(f"file:{POL_DB}?mode=ro", uri=True)
    oldest = {t: d for t, d in pc.execute(
        "SELECT ticker, MIN(transaction_date) FROM congressional_trades "
        "WHERE ticker IS NOT NULL AND ticker != '' AND transaction_date != '' "
        "GROUP BY ticker")}
    pc.close()

    if tickers_override:
        # Explicit list: honour it even for tickers outside the universe, but
        # we still need a start date — fall back to the oldest trade overall.
        floor_all = min(oldest.values()) if oldest else "2012-01-01"
        return {t: (oldest.get(t, floor_all), floors.get(t))
                for t in tickers_override}

    out = {}
    for t, first_trade in oldest.items():
        if t not in universe:
            continue                      # not chartable from /stock/{ticker}
        floor = floors.get(t)
        if floor and first_trade >= floor:
            continue                      # already covered
        out[t] = (first_trade, floor)
    return out


def fetch_batch(tickers, start, interval, timeout=60):
    """-> {ticker: [(date, close, volume), ...]}"""
    try:
        df = yf.download(tickers, start=start, interval=interval,
                         group_by="ticker", auto_adjust=True,
                         progress=False, threads=True, timeout=timeout)
    except Exception as e:
        print(f"    batch failed: {e}")
        return {}
    if df is None or df.empty:
        return {}

    got = {}
    for t in tickers:
        try:
            sub = df[t]
        except Exception:
            continue
        rows = []
        for d, r in sub.iterrows():
            close = r.get("Close")
            if close is None or close != close:      # NaN
                continue
            vol = r.get("Volume")
            rows.append((d.strftime("%Y-%m-%d"), round(float(close), 4),
                         None if vol is None or vol != vol else float(vol)))
        if rows:
            got[t] = rows
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--batch", type=int, default=BATCH)
    ap.add_argument("--sleep", type=float, default=SLEEP)
    ap.add_argument("--interval", default=INTERVAL)
    ap.add_argument("--limit", type=int, default=0, help="cap tickers (testing)")
    ap.add_argument("--tickers", default="", help="comma-separated override")
    args = ap.parse_args()

    override = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    need = scope(override or None)
    if not need:
        print("Nothing to backfill.")
        return

    # Bucket by start year so a batch doesn't drag every ticker back to 2012
    # just because one of them needs it.
    buckets = defaultdict(list)
    for t, (start, _) in need.items():
        buckets[start[:4]].append(t)

    ordered = []
    for yr in sorted(buckets):
        ordered.extend(sorted(buckets[yr]))
    if args.limit:
        ordered = ordered[:args.limit]

    print(f"stocks.db     : {STOCKS_DB}")
    print(f"politicians.db: {POL_DB}")
    print(f"tickers needing backfill: {len(ordered)}")
    print(f"start-year spread: " +
          ", ".join(f"{y}:{len(v)}" for y, v in sorted(buckets.items())))
    calls = (len(ordered) + args.batch - 1) // args.batch
    print(f"interval={args.interval}  batch={args.batch}  -> ~{calls} upstream calls")
    if args.dry_run:
        print("\n--dry-run: stopping before any fetch.")
        return

    conn = sqlite3.connect(STOCKS_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")

    inserted = failed = 0
    for i in range(0, len(ordered), args.batch):
        chunk = ordered[i:i + args.batch]
        start = min(need[t][0] for t in chunk)
        print(f"  [{i//args.batch + 1}/{calls}] {len(chunk)} tickers from {start} …")

        got = fetch_batch(chunk, start, args.interval)
        missing = [t for t in chunk if t not in got]
        failed += len(missing)

        payload = []
        for t, rows in got.items():
            floor = need[t][1]
            # Strictly before the existing daily rows — never mix resolutions
            # within a date, and never overwrite what's already there.
            for d, close, vol in rows:
                if floor and d >= floor:
                    continue
                payload.append((t, d, close, vol))

        if payload:
            cur = conn.executemany(
                "INSERT OR IGNORE INTO price_history (ticker, date, close, volume) "
                "VALUES (?, ?, ?, ?)", payload)
            conn.commit()
            inserted += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        print(f"      +{len(payload)} rows  ({len(missing)} tickers returned nothing)")

        if i + args.batch < len(ordered):
            time.sleep(args.sleep)

    floor_now = conn.execute("SELECT MIN(date), COUNT(*) FROM price_history").fetchone()
    conn.close()
    print(f"\nDone. inserted={inserted}  tickers_with_no_data={failed}")
    print(f"price_history now: floor={floor_now[0]}  rows={floor_now[1]}")


if __name__ == "__main__":
    sys.exit(main())
