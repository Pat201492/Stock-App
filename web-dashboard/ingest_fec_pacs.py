"""
ingest_fec_pacs.py — which PACs fund which members, from FEC bulk data.

  https://www.fec.gov/files/bulk-downloads/{cycle}/cn{yy}.zip     candidate master
  https://www.fec.gov/files/bulk-downloads/{cycle}/cm{yy}.zip     committee master
  https://www.fec.gov/files/bulk-downloads/{cycle}/pas2{yy}.zip   cmte -> candidate

Deliberately the bulk files rather than the OpenFEC REST API. The API needs an
api.data.gov key and caps out at 1,000 calls an hour; the bulk files need no
credential at all and the whole current cycle is a 7MB download. Same data.

Contributions are aggregated to (member, PAC, cycle) on the way in. The itemised
file has millions of rows and the relationship web only needs to know whether
two members draw on the same funders — the individual cheques are noise at that
level.

Pipe-delimited, no header row. Field positions come from the FEC's published
layouts:
  cn      0 CAND_ID  1 CAND_NAME  2 PTY  4 OFFICE_ST  5 OFFICE  6 DISTRICT
  cm      0 CMTE_ID  1 CMTE_NM
  itpas2  0 CMTE_ID  14 TRANSACTION_AMT  16 CAND_ID
"""
import io
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime

from politicians_database import init_pol_db, SessionLocal, PacSupport, Politician
from ingest_house import _strip_accents

UA = "Mozilla/5.0 (compatible; StockApp/1.0; +https://github.com/Pat201492/Stock-App)"
BASE = "https://www.fec.gov/files/bulk-downloads/{cycle}/{name}"
CYCLES = [2026, 2024]
MIN_AMOUNT = 0          # ignore refunds/negatives
OFFICE_TO_CHAMBER = {"H": ("rep", "house"), "S": ("sen", "senate")}


def _fetch_rows(cycle, name):
    url = BASE.format(cycle=cycle, name=name)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    raw = urllib.request.urlopen(req, timeout=300).read()
    zf = zipfile.ZipFile(io.BytesIO(raw))
    inner = zf.namelist()[0]
    with zf.open(inner) as fh:
        for line in io.TextIOWrapper(fh, "latin-1"):
            line = line.rstrip("\n").rstrip("\r")
            if line:
                yield line.split("|")


def _norm(s):
    return re.sub(r"[^a-z]", "", _strip_accents(s or "").lower())


def _build_lookup(db):
    """(last, state, chamber) -> [(first, bioguide)] for matching FEC candidates."""
    by_key = defaultdict(list)
    for p in db.query(Politician).all():
        last = _norm(p.last_name or "")
        st = (p.state or "").strip().upper()
        ch = (p.chamber or "").strip().lower()
        if last and st and ch:
            by_key[(last, st, ch)].append((_norm(p.first_name or ""), p.bioguide_id))
    return by_key


def _match_candidate(row, by_key):
    """FEC cn row -> bioguide_id, or None."""
    name, st, office = row[1], row[4].strip().upper(), row[5].strip().upper()
    chambers = OFFICE_TO_CHAMBER.get(office)
    if not chambers:
        return None
    parts = [p.strip() for p in name.split(",")]
    last = _norm(parts[0])
    first = _norm(parts[1]) if len(parts) > 1 else ""
    for ch in chambers:
        cands = by_key.get((last, st, ch))
        if not cands:
            continue
        if len(cands) == 1:
            return cands[0][1]
        # Several same-surname members in one state: require the first name to
        # agree, by prefix either way (FEC writes "JERRY LEE", the DB "Jerry").
        for f, bio in cands:
            if f and first and (f.startswith(first[:4]) or first.startswith(f[:4])):
                return bio
    return None


def ingest(cycles=None):
    init_pol_db()
    db = SessionLocal()
    try:
        by_key = _build_lookup(db)
        existing = {(b, c, y) for b, c, y in db.query(
            PacSupport.bioguide_id, PacSupport.cmte_id, PacSupport.cycle).all()}
        print(f"[fec] {len(existing)} PAC-support rows already stored")

        inserted = 0
        for cycle in (cycles or CYCLES):
            yy = str(cycle)[-2:]
            print(f"[fec] {cycle}: candidate master …")
            cand_to_bio = {}
            unmatched = 0
            for row in _fetch_rows(cycle, f"cn{yy}.zip"):
                if len(row) < 7:
                    continue
                bio = _match_candidate(row, by_key)
                if bio:
                    cand_to_bio[row[0]] = bio
                else:
                    unmatched += 1
            print(f"[fec] {cycle}: {len(cand_to_bio)} candidates matched to members "
                  f"({unmatched} not sitting members)")
            if not cand_to_bio:
                continue

            print(f"[fec] {cycle}: committee master …")
            cmte_name = {}
            for row in _fetch_rows(cycle, f"cm{yy}.zip"):
                if len(row) >= 2:
                    cmte_name[row[0]] = row[1]

            print(f"[fec] {cycle}: contributions …")
            agg = defaultdict(lambda: [0.0, 0])     # (bio, cmte) -> [amount, count]
            scanned = 0
            for row in _fetch_rows(cycle, f"pas2{yy}.zip"):
                scanned += 1
                if len(row) < 17:
                    continue
                bio = cand_to_bio.get(row[16])
                if not bio:
                    continue
                try:
                    amt = float(row[14] or 0)
                except ValueError:
                    continue
                if amt <= MIN_AMOUNT:
                    continue
                k = (bio, row[0])
                agg[k][0] += amt
                agg[k][1] += 1
            print(f"[fec] {cycle}: {scanned} rows scanned, {len(agg)} member-PAC pairs")

            for (bio, cid), (amt, n) in agg.items():
                if (bio, cid, cycle) in existing:
                    continue
                existing.add((bio, cid, cycle))
                db.add(PacSupport(
                    bioguide_id=bio, cmte_id=cid,
                    cmte_name=(cmte_name.get(cid) or "")[:200] or None,
                    cycle=cycle, total_amount=round(amt, 2), n_contribs=n,
                    ingested_at=datetime.utcnow()))
                inserted += 1
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"[fec] {cycle}: commit failed — {type(e).__name__}: {e}")

        print(f"[fec] Done — inserted={inserted}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    yrs = [int(a) for a in sys.argv[1:] if a.isdigit()]
    ingest(yrs or None)
