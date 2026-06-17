"""
ingest_fundamentals_history.py — backfill multi-year growth from SEC EDGAR.

yfinance only returns ~4 years of annual financials, so eps_cagr_5y (~48% null),
fcf_3yr_avg_raw (~32%), and rev_cagr_5y/10y are missing for much of the universe.
This pulls the official SEC XBRL `companyfacts` feed (10+ years, free, no key) and
computes the 5Y/3Y/10Y CAGRs for revenue, EPS, and FCF where they're null in the
Fundamentals table.

  CIK map:      https://www.sec.gov/files/company_tickers.json
  Company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json

US 10-K filers only (foreign 20-F ADRs aren't covered). Fill-only: never
overwrites a value yfinance already provided.
"""
import datetime as _dt
import json
import sys
import time
import urllib.request

from data_utils import cagr, sf
from database import init_db, SessionLocal, Fundamentals

UA = {"User-Agent": "StockApp research (contact@example.com)"}
CIK_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# Concept variants in rough priority order; merged across to maximize history
# (companies migrate tags over the years).
REV_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
]
EPS_CONCEPTS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"]
OCF_CONCEPTS = [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
]
CAPEX_CONCEPTS = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
]


def _days(a, b):
    f = "%Y-%m-%d"
    return (_dt.datetime.strptime(b, f) - _dt.datetime.strptime(a, f)).days


def annual_series(facts, concepts, unit):
    """{fiscal_year:int -> value:float} from a us-gaap concept (merged across the
    given concept variants). Annual 10-K periods only; latest-filed wins per year.
    Pure function over a companyfacts dict."""
    gaap = (facts or {}).get("facts", {}).get("us-gaap", {})
    best = {}  # year -> (filed, val)
    for concept in concepts:
        units = gaap.get(concept, {}).get("units", {}).get(unit, [])
        for x in units:
            form = x.get("form", "")
            start, end = x.get("start"), x.get("end")
            if not form.startswith("10-K") or x.get("fp") != "FY" or not start or not end:
                continue
            try:
                if not (350 <= _days(start, end) <= 380):  # true annual, not YTD/partial
                    continue
            except ValueError:
                continue
            val = sf(x.get("val"))
            if val is None:
                continue
            year = int(end[:4])
            filed = x.get("filed", "")
            if year not in best or filed > best[year][0]:
                best[year] = (filed, val)
    return {y: v for y, (f, v) in best.items()}


def _cagr_n(year_val, n):
    """series_cagr-equivalent over a {year:val} dict: oldest→newest within n years."""
    years = sorted(year_val)
    if len(years) < 2:
        return None
    newest_first = [year_val[y] for y in reversed(years)]
    k = min(len(newest_first) - 1, n)
    return cagr(newest_first[k], newest_first[0], k)


def compute_growth(facts):
    """companyfacts -> {field: value} for the CAGR/avg columns (only those we can
    derive). Pure function."""
    rev = annual_series(facts, REV_CONCEPTS, "USD")
    eps = annual_series(facts, EPS_CONCEPTS, "USD/shares")
    ocf = annual_series(facts, OCF_CONCEPTS, "USD")
    capex = annual_series(facts, CAPEX_CONCEPTS, "USD")
    # FCF per year = OCF - CapEx (CapEx reported positive as a payment)
    fcf = {y: ocf[y] - capex.get(y, 0) for y in ocf}

    out = {}
    for field, series in (("rev_cagr", rev), ("eps_cagr", eps), ("fcf_cagr", fcf)):
        for n in (1, 3, 5, 10):
            v = _cagr_n(series, n)
            if v is not None:
                out[f"{field}_{n}y"] = v
    # 3-year average FCF (raw $) — DCF smoothing input
    if fcf:
        recent = [fcf[y] for y in sorted(fcf)[-3:]]
        if recent:
            out["fcf_3yr_avg_raw"] = sum(recent) / len(recent)
    return out


# ── I/O ─────────────────────────────────────────────────────────────────────
def _get(url, retries=3):
    for attempt in range(retries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30
            ).read()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def load_cik_map():
    data = json.loads(_get(CIK_URL).decode("utf-8"))
    return {v["ticker"].upper(): int(v["cik_str"]) for v in data.values()}


# Columns we can backfill, and the source field that produced them.
_FILLABLE = [
    "rev_cagr_1y", "rev_cagr_3y", "rev_cagr_5y", "rev_cagr_10y",
    "eps_cagr_1y", "eps_cagr_3y", "eps_cagr_5y", "eps_cagr_10y",
    "fcf_cagr_1y", "fcf_cagr_3y", "fcf_cagr_5y", "fcf_cagr_10y",
    "fcf_3yr_avg_raw",
]


def ingest(full_refresh=False, limit=None):
    """Backfill null CAGR/avg columns from EDGAR. fill-only unless full_refresh."""
    init_db()
    db = SessionLocal()
    try:
        print("[edgar] loading CIK map …")
        cik_map = load_cik_map()
        rows = db.query(Fundamentals).all()
        # only stocks missing at least one fillable column (unless full)
        targets = []
        for r in rows:
            if full_refresh or any(getattr(r, c, None) is None for c in _FILLABLE):
                targets.append(r)
        if limit:
            targets = targets[:limit]
        print(f"[edgar] {len(targets)} stocks to backfill (of {len(rows)})")

        updated = no_cik = no_data = 0
        for i, r in enumerate(targets):
            cik = cik_map.get((r.ticker or "").upper())
            if not cik:
                no_cik += 1
                continue
            try:
                facts = json.loads(_get(FACTS_URL.format(cik=cik)).decode("utf-8"))
            except Exception as e:
                no_data += 1
                continue
            growth = compute_growth(facts)
            if not growth:
                no_data += 1
            changed = False
            for col, val in growth.items():
                if col not in _FILLABLE:
                    continue
                if full_refresh or getattr(r, col, None) is None:
                    setattr(r, col, val)
                    changed = True
            if changed:
                updated += 1
            if (i + 1) % 200 == 0:
                db.commit()
                print(f"[edgar]   {i+1}/{len(targets)} processed, {updated} updated")
            time.sleep(0.12)  # SEC fair-use: ≤10 req/s
        db.commit()
        print(f"[edgar] Done — updated={updated} no_cik={no_cik} no_data={no_data}")
    finally:
        db.close()


if __name__ == "__main__":
    lim = None
    if "--limit" in sys.argv:
        lim = int(sys.argv[sys.argv.index("--limit") + 1])
    ingest(full_refresh="--full" in sys.argv, limit=lim)
