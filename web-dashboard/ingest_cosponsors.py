"""
ingest_cosponsors.py — who legislates with whom, from govinfo BILLSTATUS.

  https://www.govinfo.gov/bulkdata/BILLSTATUS/{congress}/{type}/BILLSTATUS-{congress}-{type}.zip

Bulk rather than the congress.gov REST API for the same reason as the FEC
ingest: the API needs an api.data.gov key and one call per bill, while the bulk
archive is a single unauthenticated download covering every bill at once. The
119th's House and Senate files together are ~40MB for 15k bills.

BILLSTATUS carries bioguideId inside the sponsor and cosponsor blocks, so
members resolve exactly. No name matching, no unmatched-filer bucket — the one
ingest in this project that doesn't have to guess at anybody's identity.

Only bill types that carry real legislative coalitions are pulled: hr, s, hjres
and sjres. Simple and concurrent resolutions are mostly ceremonial.

Parsed with a regex over the sponsor/cosponsor blocks rather than a full XML
parse. Only the ids are wanted, there are 15k documents, and one malformed file
shouldn't take the run down.
"""
import io
import re
import sys
import urllib.request
import zipfile
from datetime import datetime

from politicians_database import (init_pol_db, SessionLocal, BillCosponsor,
                                  Bill, Politician)

UA = "Mozilla/5.0 (compatible; StockApp/1.0; +https://github.com/Pat201492/Stock-App)"
URL = "https://www.govinfo.gov/bulkdata/BILLSTATUS/{c}/{t}/BILLSTATUS-{c}-{t}.zip"
CONGRESSES = [119]
BILL_TYPES = ["hr", "s", "hjres", "sjres"]

_SPONSORS_RE = re.compile(r"<sponsors>(.*?)</sponsors>", re.S)
_COSPONSORS_RE = re.compile(r"<cosponsors>(.*?)</cosponsors>", re.S)
_BIOGUIDE_RE = re.compile(r"<bioguideId>([A-Z]\d{6})</bioguideId>")
_NUM_RE = re.compile(r"BILLSTATUS-(\d+)([a-z]+)(\d+)\.xml", re.I)
_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
_INTRO_RE = re.compile(r"<introducedDate>(.*?)</introducedDate>")
_POLICY_RE = re.compile(r"<policyArea>\s*<name>(.*?)</name>", re.S)
_LATEST_RE = re.compile(
    r"<latestAction>\s*<actionDate>(.*?)</actionDate>\s*<text>(.*?)</text>", re.S)


def _clean(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def parse_meta(xml):
    """Title, dates and status — the parts of a bill a person can read."""
    t = _TITLE_RE.search(xml)
    intro = _INTRO_RE.search(xml)
    pol = _POLICY_RE.search(xml)
    la = _LATEST_RE.search(xml)
    return {
        "title": _clean(t.group(1))[:400] if t else None,
        "introduced_date": (intro.group(1) or "").strip()[:10] if intro else None,
        "policy_area": _clean(pol.group(1))[:120] if pol else None,
        "latest_action_date": (la.group(1) or "").strip()[:10] if la else None,
        "latest_action": _clean(la.group(2))[:400] if la else None,
    }


def _fetch_zip(congress, btype):
    req = urllib.request.Request(URL.format(c=congress, t=btype),
                                 headers={"User-Agent": UA})
    return zipfile.ZipFile(io.BytesIO(
        urllib.request.urlopen(req, timeout=900).read()))


def parse_bill(xml):
    """-> (sponsor_bioguide|None, [cosponsor_bioguide])"""
    sm = _SPONSORS_RE.search(xml)
    sponsor = None
    if sm:
        ids = _BIOGUIDE_RE.findall(sm.group(1))
        sponsor = ids[0] if ids else None
    cm = _COSPONSORS_RE.search(xml)
    cos = _BIOGUIDE_RE.findall(cm.group(1)) if cm else []
    # A member can appear twice if they withdrew and re-added; collapse.
    return sponsor, list(dict.fromkeys(cos))


def ingest(congresses=None):
    init_pol_db()
    db = SessionLocal()
    try:
        known = {p.bioguide_id for p in db.query(Politician.bioguide_id).all()}
        existing = {(b, i) for b, i in db.query(
            BillCosponsor.bioguide_id, BillCosponsor.bill_id).all()}
        print(f"[cosponsor] {len(existing)} rows already stored, "
              f"{len(known)} known members")

        inserted = bills = skipped_unknown = 0
        for congress in (congresses or CONGRESSES):
            for btype in BILL_TYPES:
                try:
                    zf = _fetch_zip(congress, btype)
                except Exception as e:
                    print(f"[cosponsor] {congress}/{btype}: unavailable ({e})")
                    continue
                names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
                print(f"[cosponsor] {congress}/{btype}: {len(names)} bills")

                for i, name in enumerate(names):
                    if i and i % 2000 == 0:
                        print(f"   {i}/{len(names)} … +{inserted}")
                    try:
                        xml = zf.read(name).decode("utf-8", "replace")
                    except Exception:
                        continue
                    sponsor, cos = parse_bill(xml)
                    if not sponsor and not cos:
                        continue
                    m = _NUM_RE.search(name)
                    bill_id = (f"{m.group(1)}-{m.group(2).lower()}-{m.group(3)}"
                               if m else f"{congress}-{btype}-{i}")
                    bills += 1
                    n_cos = len(cos)
                    meta = parse_meta(xml)
                    db.merge(Bill(
                        bill_id=bill_id, congress=congress, bill_type=btype,
                        number=int(m.group(3)) if m else None,
                        sponsor_bioguide=sponsor, n_cosponsors=n_cos, **meta))
                    for bio, is_sp in [(sponsor, True)] + [(c, False) for c in cos]:
                        if not bio:
                            continue
                        if bio not in known:
                            skipped_unknown += 1
                            continue
                        if (bio, bill_id) in existing:
                            continue
                        existing.add((bio, bill_id))
                        db.add(BillCosponsor(
                            bioguide_id=bio, bill_id=bill_id, congress=congress,
                            n_cosponsors=n_cos, is_sponsor=is_sp))
                        inserted += 1
                try:
                    db.commit()
                except Exception as e:
                    db.rollback()
                    print(f"[cosponsor] {congress}/{btype}: commit failed — "
                          f"{type(e).__name__}: {e}")

        print(f"[cosponsor] Done — inserted={inserted} bills={bills} "
              f"skipped_not_in_db={skipped_unknown}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    cs = [int(a) for a in sys.argv[1:] if a.isdigit()]
    ingest(cs or None)
