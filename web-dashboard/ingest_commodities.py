"""
ingest_commodities.py — prices for tracked commodities and commodity ETFs.

The universe is curated. There is no feed that enumerates "the commodities",
and the set worth following is small and stable, so it lives here as a list
rather than being discovered. Two kinds sit in it:

  future  a continuous front-month contract ("GC=F"). What the commodity is
          actually worth. Not something you can hold in a brokerage account.
  etf     a fund that follows one ("GLD"). Buyable, and therefore what shows up
          in congressional disclosures and in paper trading — but it carries an
          expense ratio and can drift from spot, so it is labelled separately.

Prices land in price_history next to equities. That is deliberate: the chart
endpoint, the deep-history backfill and the trade-timing overlay then all work
on commodities with no changes. History runs back to 2000 for the majors.
"""
import sys
import time
from datetime import datetime

import yfinance as yf

from database import SessionLocal, init_db, Commodity, PriceHistory

# symbol, name, category, kind, unit, tracks
UNIVERSE = [
    ("GC=F", "Gold",              "Metals",      "future", "USD / troy oz",   None),
    ("SI=F", "Silver",            "Metals",      "future", "USD / troy oz",   None),
    ("PL=F", "Platinum",          "Metals",      "future", "USD / troy oz",   None),
    ("PA=F", "Palladium",         "Metals",      "future", "USD / troy oz",   None),
    ("HG=F", "Copper",            "Metals",      "future", "USD / lb",        None),
    ("CL=F", "Crude Oil (WTI)",   "Energy",      "future", "USD / barrel",    None),
    ("BZ=F", "Crude Oil (Brent)", "Energy",      "future", "USD / barrel",    None),
    ("NG=F", "Natural Gas",       "Energy",      "future", "USD / MMBtu",     None),
    ("RB=F", "RBOB Gasoline",     "Energy",      "future", "USD / gallon",    None),
    ("HO=F", "Heating Oil",       "Energy",      "future", "USD / gallon",    None),
    ("ZC=F", "Corn",              "Agriculture", "future", "cents / bushel",  None),
    ("ZW=F", "Wheat",             "Agriculture", "future", "cents / bushel",  None),
    ("ZS=F", "Soybeans",          "Agriculture", "future", "cents / bushel",  None),
    ("KC=F", "Coffee",            "Agriculture", "future", "cents / lb",      None),
    ("SB=F", "Sugar",             "Agriculture", "future", "cents / lb",      None),
    ("CT=F", "Cotton",            "Agriculture", "future", "cents / lb",      None),
    ("CC=F", "Cocoa",             "Agriculture", "future", "USD / tonne",     None),
    ("LE=F", "Live Cattle",       "Livestock",   "future", "cents / lb",      None),
    ("HE=F", "Lean Hogs",         "Livestock",   "future", "cents / lb",      None),

    ("GLD",  "SPDR Gold Shares",             "Metals",      "etf", "USD / share", "Gold"),
    ("IAU",  "iShares Gold Trust",           "Metals",      "etf", "USD / share", "Gold"),
    ("SLV",  "iShares Silver Trust",         "Metals",      "etf", "USD / share", "Silver"),
    ("CPER", "US Copper Index Fund",         "Metals",      "etf", "USD / share", "Copper"),
    ("USO",  "United States Oil Fund",       "Energy",      "etf", "USD / share", "Crude Oil (WTI)"),
    ("BNO",  "United States Brent Oil Fund", "Energy",      "etf", "USD / share", "Crude Oil (Brent)"),
    ("UNG",  "United States Natural Gas Fund", "Energy",    "etf", "USD / share", "Natural Gas"),
    ("XLE",  "Energy Select Sector SPDR",    "Energy",      "etf", "USD / share", "Energy equities"),
    ("DBA",  "Invesco DB Agriculture Fund",  "Agriculture", "etf", "USD / share", "Agriculture basket"),
    ("CORN", "Teucrium Corn Fund",           "Agriculture", "etf", "USD / share", "Corn"),
    ("WEAT", "Teucrium Wheat Fund",          "Agriculture", "etf", "USD / share", "Wheat"),
    ("DBC",  "Invesco DB Commodity Index",   "Index",       "etf", "USD / share", "Broad basket"),
    ("GSG",  "iShares S&P GSCI Commodity",   "Index",       "etf", "USD / share", "Broad basket"),
    ("PDBC", "Invesco Optimum Yield Divers.", "Index",      "etf", "USD / share", "Broad basket"),
    ("GDX",  "VanEck Gold Miners",           "Metals",      "etf", "USD / share", "Gold miners"),
]

SYMBOLS = {row[0] for row in UNIVERSE}
HISTORY_PERIOD = "max"
PAUSE = 0.25


def _rows_for(symbol, period=HISTORY_PERIOD):
    """Daily closes for one symbol; NaN bars dropped, as elsewhere."""
    try:
        h = yf.Ticker(symbol).history(period=period, interval="1d")
    except Exception as e:
        print(f"  [warn] {symbol}: {type(e).__name__}: {e}")
        return []
    if h is None or h.empty:
        return []
    out = []
    for d, r in h.iterrows():
        close = r.get("Close")
        if close is None or close != close:      # NaN — see news.py
            continue
        vol = r.get("Volume")
        out.append((d.strftime("%Y-%m-%d"), round(float(close), 4),
                    None if vol is None or vol != vol else float(vol)))
    return out


def ingest(symbols=None, period=HISTORY_PERIOD):
    init_db()
    db = SessionLocal()
    try:
        wanted = [r for r in UNIVERSE if not symbols or r[0] in set(symbols)]
        print(f"[commodities] {len(wanted)} symbols, history={period}")
        have = {(t, d) for t, d in db.query(PriceHistory.ticker, PriceHistory.date)
                .filter(PriceHistory.ticker.in_([r[0] for r in wanted])).all()}
        inserted = 0
        for sym, name, cat, kind, unit, tracks in wanted:
            rows = _rows_for(sym, period)
            if not rows:
                print(f"  {sym:<6} no data")
                continue
            new = 0
            for d, close, vol in rows:
                if (sym, d) in have:
                    continue
                have.add((sym, d))
                db.add(PriceHistory(ticker=sym, date=d, close=close, volume=vol))
                new += 1
                inserted += 1
            last = rows[-1][1]
            prev = rows[-2][1] if len(rows) > 1 else None
            db.merge(Commodity(
                symbol=sym, name=name, category=cat, kind=kind, unit=unit,
                tracks=tracks, last_price=last, prev_close=prev,
                change_pct=(round((last - prev) / prev * 100, 2)
                            if prev else None),
                last_updated=datetime.utcnow()))
            print(f"  {sym:<6} {name:<28} {rows[0][0]} → {rows[-1][0]}  +{new} rows")
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"  [warn] {sym}: commit failed — {type(e).__name__}: {e}")
            time.sleep(PAUSE)
        print(f"[commodities] Done — inserted={inserted}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    per = "1y" if "--recent" in sys.argv else HISTORY_PERIOD
    ingest(args or None, per)
