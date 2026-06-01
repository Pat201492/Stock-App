"""
fred.py — minimal FRED (St. Louis Fed) API client for the Fed / economic-health page.
Needs a free API key in the FRED_API_KEY env var (https://fred.stlouisfed.org/docs/api/api_key.html).
No extra deps — uses urllib.
"""
import os, json
from urllib.request import urlopen, Request
from urllib.parse import urlencode

FRED_API_KEY = os.environ.get("FRED_API_KEY")
BASE = "https://api.stlouisfed.org/fred/series/observations"


def configured() -> bool:
    return bool(FRED_API_KEY)


def fetch_series(series_id: str, limit: int = 24):
    """Most-recent `limit` observations (ascending). Returns list of {date, value}."""
    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY not set")
    qs = urlencode({
        "series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json",
        "sort_order": "desc", "limit": limit,
    })
    req = Request(f"{BASE}?{qs}", headers={"User-Agent": "StockTracker"})
    data = json.loads(urlopen(req, timeout=20).read().decode("utf-8"))
    obs = []
    for o in data.get("observations", []):
        v = o.get("value")
        if v in (".", "", None):
            continue
        try:
            obs.append({"date": o["date"], "value": float(v)})
        except ValueError:
            continue
    obs.reverse()  # ascending by date
    return obs


def latest_with_change(series_id: str, limit: int = 24, yoy: bool = False):
    """Latest value + change vs prior obs (or YoY % when yoy=True) + history for a sparkline."""
    obs = fetch_series(series_id, limit=max(limit, 14 if yoy else 2))
    if not obs:
        return None
    latest = obs[-1]
    out = {"value": latest["value"], "asof": latest["date"],
           "history": [o["value"] for o in obs[-limit:]]}
    if yoy and len(obs) >= 13:
        year_ago = obs[-13]["value"]
        out["value"] = round((latest["value"] / year_ago - 1) * 100, 2) if year_ago else None
        out["history"] = [
            round((obs[i]["value"] / obs[i - 12]["value"] - 1) * 100, 2)
            for i in range(12, len(obs)) if obs[i - 12]["value"]
        ]
        out["change"] = round(out["value"] - (
            (obs[-2]["value"] / obs[-14]["value"] - 1) * 100), 2) if len(obs) >= 14 and obs[-14]["value"] else None
    else:
        out["change"] = round(latest["value"] - obs[-2]["value"], 2) if len(obs) >= 2 else None
    return out
