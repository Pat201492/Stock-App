"""
ingest_house_positions.py — outside positions from House annual financial
disclosures (Schedule E), the official source for board seats and the like.

  Index: https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{YEAR}FD.zip
         -> {YEAR}FD.txt  (FilingType 'O' == annual report, 'A' == amendment)
  PDF:   https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{YEAR}/{DocID}.pdf

ingest_house.py already downloads that same index and keeps only FilingType 'P'
(periodic transactions). The annual reports sitting alongside them carry
Schedule E — "Positions Held Outside U.S. Government" — which is a genuine
member-to-organisation tie, and the thing the hand-written curated overlay in
political_relationships.json was standing in for. Roughly 35% of filers list at
least one.

Two quirks make this worth documenting:

1. The heading font doesn't extract. pypdf maps its glyphs to NUL, so
   "SCHEDULE E: POSITIONS" arrives as "S\\x00\\x00... E: P\\x00\\x00...". Strip the
   NULs and it collapses to "S E: P" — the schedule LETTER survives, so sections
   are found by letter and never by the mangled words.

2. Position and organisation are two table columns. Default extraction flattens
   them into one space-joined string with no delimiter ("Partner RB2EH
   Enterprises"), which can only be split by guessing at job titles. Layout mode
   keeps the gap, so a 2+ space split gives the pair cleanly.
"""
import csv, io, os, re, sys, time, zipfile
from datetime import datetime

from politicians_database import init_pol_db, SessionLocal, MemberPosition
from ingest_house import (
    _http_get, _norm_name, _norm_last, _build_house_lookup, CACHE_DIR,
)

YEARS = [2025, 2026]
INDEX_URL = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"
FD_URL = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}/{doc}.pdf"
POS_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "house_fd")

# "S E: P" after NUL-stripping. The letter is the only reliable part. Leading
# whitespace is allowed: layout mode indents a heading that lands after a page
# break, and anchoring hard to ^S silently loses those sections.
_SCHED_RE = re.compile(r"^[ \t]*S\s+([A-Z]):\s*[A-Z]", re.M)
# The Positions table's own column header — unique to Schedule E.
_POS_HEADER_RE = re.compile(r"^[ \t]*Position\s{2,}Name of Organization[ \t]*$", re.M)
# Layout mode leaves a wide gap between the two columns.
_ROW_RE = re.compile(r"^(.{2,60}?)\s{3,}(.+?)\s*$")
# Lines that are structure, not data.
_SKIP_RE = re.compile(
    r"^(Position\s+Name of Organization|Filing ID\s*#|None disclosed\.?|"
    r"C:\s|\*|Page\s+\d)", re.I)

MAX_ORG = 200
MAX_POS = 120


def _clean(t):
    return (t or "").replace("\x00", "")


def download_index(year):
    """Annual reports ('O') and their amendments ('A') for a year."""
    raw = _http_get(INDEX_URL.format(year=year))
    zf = zipfile.ZipFile(io.BytesIO(raw))
    txt = zf.read(f"{year}FD.txt").decode("utf-8", errors="replace")
    rows = list(csv.DictReader(io.StringIO(txt), delimiter="\t"))
    return [r for r in rows if (r.get("FilingType") or "").strip() in ("O", "A")]


def fetch_pdf(year, doc_id):
    ydir = os.path.join(POS_CACHE, str(year))
    os.makedirs(ydir, exist_ok=True)
    path = os.path.join(ydir, f"{doc_id}.pdf")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    data = _http_get(FD_URL.format(year=year, doc=doc_id))
    with open(path, "wb") as f:
        f.write(data)
    time.sleep(0.4)
    return path


def extract_layout(path):
    """Layout mode — see the module docstring for why plain mode won't do."""
    try:
        import pypdf
        r = pypdf.PdfReader(path)
        return _clean("\n".join(
            (p.extract_text(extraction_mode="layout") or "") for p in r.pages))
    except Exception as e:
        print(f"[positions]   extract failed {os.path.basename(path)}: {e}")
        return ""


def schedule_e(txt):
    """Rows of the Positions table, or None when the filing has none.

    Anchored on the table's own column header rather than the section heading.
    "SCHEDULE E: POSITIONS" is set in the heading font that doesn't reliably
    extract, and when the table starts on a fresh page the heading can be left
    behind on the previous one entirely — one filer lost every section from A
    to E that way. "Position / Name of Organization" is unique to this schedule
    and survives layout extraction. The header reprints on each continuation
    page, so collect every occurrence.
    """
    blocks = []
    for m in _POS_HEADER_RE.finditer(txt):
        nxt = _SCHED_RE.search(txt, m.end())
        blocks.append(txt[m.end():nxt.start() if nxt else len(txt)])
    return "\n".join(blocks).strip() if blocks else None


def parse_positions(body):
    """-> [(position, organization)]"""
    out = []
    if not body:
        return out
    for line in body.splitlines():
        line = line.rstrip()
        if not line.strip() or _SKIP_RE.match(line.strip()):
            continue
        m = _ROW_RE.match(line)
        if not m:
            continue
        pos, org = m.group(1).strip(), m.group(2).strip()
        # Both halves must look like real text, not stray table furniture.
        if len(pos) < 2 or len(org) < 3:
            continue
        if not re.search(r"[A-Za-z]", pos) or not re.search(r"[A-Za-z]", org):
            continue
        out.append((pos[:MAX_POS], org[:MAX_ORG]))
    return out


def _resolve(row, by_name, by_name_dist, by_dist_last):
    """Filer row -> bioguide_id, same three tiers ingest_house.py uses."""
    first = (row.get("First") or "").strip()
    last = (row.get("Last") or "").strip()
    sd = (row.get("StateDst") or "").strip()
    key = _norm_name(first, last)
    if sd and (key, sd) in by_name_dist:
        return by_name_dist[(key, sd)]
    if sd:
        hit = by_dist_last.get((sd, _norm_last(last)))
        if hit:
            return hit
    return by_name.get(key)


def ingest(years=None):
    init_pol_db()
    db = SessionLocal()
    try:
        by_name, by_name_dist, by_dist_last = _build_house_lookup(db)
        existing = {(b, o, p, y) for b, o, p, y in db.query(
            MemberPosition.bioguide_id, MemberPosition.organization,
            MemberPosition.position, MemberPosition.year).all()}
        print(f"[positions] {len(existing)} already stored")

        inserted = unmatched = no_sched = scanned = 0
        for year in (years or YEARS):
            try:
                rows = download_index(year)
            except Exception as e:
                print(f"[positions] {year}: index unavailable ({e})")
                continue
            print(f"[positions] {year}: {len(rows)} annual filings")

            for i, row in enumerate(rows):
                if i % 50 == 0 and i:
                    print(f"  {i}/{len(rows)} … +{inserted}")
                doc = (row.get("DocID") or "").strip()
                if not doc:
                    continue
                bio = _resolve(row, by_name, by_name_dist, by_dist_last)
                if not bio:
                    unmatched += 1
                    continue
                try:
                    txt = extract_layout(fetch_pdf(year, doc))
                except Exception as e:
                    print(f"  [warn] {doc}: {e}")
                    continue
                scanned += 1
                body = schedule_e(txt)
                if body is None:
                    no_sched += 1
                    continue
                url = FD_URL.format(year=year, doc=doc)
                for pos, org in parse_positions(body):
                    key = (bio, org, pos, year)
                    if key in existing:
                        continue
                    existing.add(key)
                    db.add(MemberPosition(
                        bioguide_id=bio, position=pos, organization=org,
                        year=year, doc_id=doc, source_url=url,
                        ingested_at=datetime.utcnow()))
                    inserted += 1
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"[positions] {year}: commit failed — {type(e).__name__}: {e}")

        print(f"[positions] Done — inserted={inserted} scanned={scanned} "
              f"unmatched_filer={unmatched} no_schedule_e={no_sched}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    yrs = [int(a) for a in sys.argv[1:] if a.isdigit()]
    ingest(yrs or None)
