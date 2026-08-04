"""
ingest_floor.py — the House weekly floor schedule: what is actually coming up.

  https://docs.house.gov/BillsThisWeek-RSS.xml     lists the published weeks
  https://docs.house.gov/billsthisweek/{week}/{week}.xml   the schedule itself

This is a real calendar, not an inference. Everything else in this project can
only say how far a bill has travelled — "Placed on the Union Calendar" — which
is a status, not a plan. docs.house.gov names the bills the House intends to
take up, so "upcoming" means upcoming.

House only. The Senate publishes its floor schedule as prose on a web page with
no machine-readable equivalent, and guessing at it from press text would be
inventing a calendar rather than reporting one.

A caveat worth carrying into the UI: the newest published week can be weeks old
when the House is in recess, so the week's date is stored and shown rather than
being presented as "this week".
"""
import re
import sys
import urllib.error
import urllib.request

from politicians_database import init_pol_db, SessionLocal, FloorItem

UA = "Mozilla/5.0 (compatible; StockApp/1.0; +https://github.com/Pat201492/Stock-App)"
RSS = "https://docs.house.gov/BillsThisWeek-RSS.xml"
WEEK_URL = "https://docs.house.gov/billsthisweek/{w}/{w}.xml"
CONGRESS = 119
WEEKS_KEPT = 8

_ITEM_RE = re.compile(r"<floor-item[^>]*>(.*?)</floor-item>", re.S)
_NUM_RE = re.compile(r"<legis-num>(.*?)</legis-num>", re.S)
_TEXT_RE = re.compile(r"<floor-text>(.*?)</floor-text>", re.S)
_DOC_RE = re.compile(r'<file[^>]*doc-url="([^"]+)"')
# "H.R. 2715" / "H. Res. 12" / "S. 40" -> the bill_id used everywhere else
_PARSE_NUM_RE = re.compile(
    r"^\s*(H\.?\s?R\.?|H\.?\s?J\.?\s?RES\.?|H\.?\s?RES\.?|H\.?\s?CON\.?\s?RES\.?|"
    r"S\.?\s?J\.?\s?RES\.?|S\.?\s?RES\.?|S\.?\s?CON\.?\s?RES\.?|S\.?)\s*(\d+)",
    re.I)
_TYPE_MAP = {"HR": "hr", "HJRES": "hjres", "HRES": "hres", "HCONRES": "hconres",
             "S": "s", "SJRES": "sjres", "SRES": "sres", "SCONRES": "sconres"}


def _clean(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _get(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}),
        timeout=180).read().decode("utf-8", "replace")


def to_bill_id(legis_num, congress=CONGRESS):
    """'H.R. 2715' -> '119-hr-2715'. None when it isn't a numbered bill."""
    m = _PARSE_NUM_RE.match(legis_num or "")
    if not m:
        return None
    key = re.sub(r"[^A-Z]", "", m.group(1).upper())
    t = _TYPE_MAP.get(key)
    return f"{congress}-{t}-{int(m.group(2))}" if t else None


def parse_week(xml):
    """-> [(legis_num, bill_id, description, doc_url)]"""
    out = []
    for raw in _ITEM_RE.findall(xml):
        num = _NUM_RE.search(raw)
        legis = _clean(num.group(1)) if num else ""
        if not legis:
            continue
        txt = _TEXT_RE.search(raw)
        doc = _DOC_RE.search(raw)
        out.append((legis[:60], to_bill_id(legis), _clean(txt.group(1))[:400] if txt else None,
                    (doc.group(1) if doc else None)))
    return out


def list_weeks():
    try:
        rss = _get(RSS)
    except Exception as e:
        print(f"[floor] RSS unavailable ({e}); nothing to do")
        return []
    return sorted(set(re.findall(r"/billsthisweek/(\d{8})/", rss)))


def ingest(weeks=None):
    init_pol_db()
    db = SessionLocal()
    try:
        wk = weeks or list_weeks()[-WEEKS_KEPT:]
        if not wk:
            return 0
        print(f"[floor] {len(wk)} week(s): {wk[0]} … {wk[-1]}")
        existing = {(w, n) for w, n in db.query(FloorItem.week, FloorItem.legis_num).all()}
        inserted = 0
        for w in wk:
            try:
                xml = _get(WEEK_URL.format(w=w))
            except urllib.error.HTTPError as e:
                print(f"[floor] {w}: HTTP {e.code}, skipped")
                continue
            except Exception as e:
                print(f"[floor] {w}: {type(e).__name__}, skipped")
                continue
            items = parse_week(xml)
            new = 0
            for legis, bid, desc, doc in items:
                if (w, legis) in existing:
                    continue
                existing.add((w, legis))
                db.add(FloorItem(week=w, chamber="house", legis_num=legis,
                                 bill_id=bid, description=desc, doc_url=doc))
                inserted += 1
                new += 1
            print(f"[floor] {w}: {len(items)} items, +{new}")
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[floor] commit failed — {type(e).__name__}: {e}")
            return 0
        print(f"[floor] Done — inserted={inserted}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    ws = [a for a in sys.argv[1:] if re.fullmatch(r"\d{8}", a)]
    ingest(ws or None)
