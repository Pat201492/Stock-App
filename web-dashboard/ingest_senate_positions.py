"""
ingest_senate_positions.py — outside positions from Senate annual financial
disclosures (Part 8), the Senate counterpart to ingest_house_positions.py.

  Search: efdsearch report_types [7] = "Annual Report", [12] = amendment
  Filing: https://efdsearch.senate.gov/search/view/annual/<uuid>/

Positions were House-only, which left every senator off the relationship web.
The Senate side is easier to read and carries more: e-filed reports are HTML
tables, and each row names an Entity Type (Company, Educational Organization,
County Government, ...) that the House form never asks for. That type is a far
better scope signal than guessing from the name, so it's stored and fed to the
classifier.

  # | Position Dates | Position Held | Entity | Entity Type | Comments

Two things the data forces:

- The search returns candidates and former filers alongside sitting senators.
  Anything that doesn't resolve to a member is skipped rather than guessed at.
- Amendments restate the whole filing, so the same position arrives repeatedly.
  The (bioguide, organisation, position, year) constraint absorbs that.

Entity carries a trailing location — "AME Higher LLC Detroit, MI". It's stripped
off the stored name so an organisation matches across chambers and across
filings, but it's read first as a scope hint, since a city/state suffix is
stronger evidence of a local body than anything in the name itself.
"""
import html as ihtml
import re
import sys
import time
from datetime import datetime

from politicians_database import init_pol_db, SessionLocal, MemberPosition, Politician
from ingest_senate_efd import _session, _norm_name, _norm_last, DATA, HOME, BASE
from org_scope import STATE_ABBR

REPORT_TYPES = ["[7]", "[12]"]      # annual report, annual amendment
SEARCH_FROM = "01/01/2025 00:00:00"
MAX_ORG = 200
MAX_POS = 120

_PART8_RE = re.compile(r"Part\s*8\.\s*Positions(.*?)Part\s*9\.", re.S | re.I)
_NONE_RE = re.compile(r"reportable outside positions[^A-Za-z]*No\b", re.I)
_YEAR_RE = re.compile(r"Calendar\s+(\d{4})", re.I)
# Trailing state code on an entity: "... Detroit, MI", "... Washington, DC".
_STATE_SUFFIX_RE = re.compile(r",\s*([A-Z]{2})\s*$")


def _split_location(entity):
    """-> (organisation, location). The name is returned verbatim.

    An earlier version tried to lift the city out of the name. There is no
    delimiter between them, so it can't be done reliably: greedy matching turned
    "University of Michigan Ann Arbor, MI" into "University of", and making it
    non-greedy just breaks the other way on two-word cities ("Los Angeles").
    Since the only gain was cosmetic, the name is now left exactly as filed and
    only the state code is read off, which is all the scope classifier needs.
    """
    m = _STATE_SUFFIX_RE.search(entity)
    if not m or m.group(1) not in STATE_ABBR | {"DC"}:
        return entity, ""
    return entity, m.group(1)


def _cells(tr):
    out = [re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", td))).strip()
           for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
    return [c for c in out if c]


def parse_part8(page):
    """-> [(position, organization, entity_type, location)]"""
    sec = _PART8_RE.search(page)
    if not sec:
        return []
    body = sec.group(1)
    flat = re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", body)))
    if _NONE_RE.search(flat):
        return []

    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S | re.I):
        c = _cells(tr)
        # Header row, or a row too short to be a position.
        if len(c) < 4 or c[0].lower().startswith("position") or c[1] == "Position Dates":
            continue
        if not c[0].strip().rstrip(".").isdigit():
            continue
        pos, entity = c[2].strip(), c[3].strip()
        etype = c[4].strip() if len(c) > 4 else ""
        if len(pos) < 2 or len(entity) < 3:
            continue
        entity, loc = _split_location(entity)
        out.append((pos[:MAX_POS], entity[:MAX_ORG], etype[:80], loc))
    return out


def _iter_annual(c, csrf):
    """Yield (first, last, href, report_year) for annual reports and amendments."""
    for rtype in REPORT_TYPES:
        start = 0
        while True:
            payload = {
                "start": str(start), "length": "100", "report_types": rtype,
                "filer_types": "[]", "submitted_start_date": SEARCH_FROM,
                "submitted_end_date": "", "candidate_state": "", "senator_state": "",
                "office_id": "", "first_name": "", "last_name": "",
                "csrfmiddlewaretoken": csrf,
            }
            r = c.post(DATA, data=payload, headers={
                "Referer": HOME, "X-Requested-With": "XMLHttpRequest",
                "X-CSRFToken": csrf})
            data = r.json()
            rows = data.get("data", [])
            if not rows:
                break
            for row in rows:
                first = re.sub(r"\s+", " ", row[0]).strip()
                last = re.sub(r"\s+", " ", row[1]).strip()
                m = re.search(r'href="([^"]+)"', row[3])
                if not m:
                    continue
                ym = _YEAR_RE.search(row[3])
                yield first, last, m.group(1), int(ym.group(1)) if ym else None
            start += len(rows)
            if start >= data.get("recordsTotal", 0):
                break
            time.sleep(0.3)


def ingest():
    init_pol_db()
    db = SessionLocal()
    try:
        name_map, last_count, last_map = {}, {}, {}
        for p in db.query(Politician).filter(
                Politician.chamber.in_(("sen", "senate"))).all():
            key = _norm_name(p.first_name or "", p.last_name or "")
            if key:
                name_map[key] = p.bioguide_id
            ln = _norm_last(p.last_name or "")
            if ln and getattr(p, "active", False):
                last_count[ln] = last_count.get(ln, 0) + 1
                last_map[ln] = p.bioguide_id
        last_unique = {ln: b for ln, b in last_map.items() if last_count[ln] == 1}

        def _match(first, last):
            return name_map.get(_norm_name(first, last)) \
                or last_unique.get(_norm_last(last))

        existing = {(b, o, p, y) for b, o, p, y in db.query(
            MemberPosition.bioguide_id, MemberPosition.organization,
            MemberPosition.position, MemberPosition.year).all()}
        print(f"[senate_pos] {len(existing)} positions already stored")

        c = _session()
        csrf = c.cookies.get("csrftoken")
        inserted = unmatched = seen = no_pos = 0
        for first, last, href, year in _iter_annual(c, csrf):
            seen += 1
            if "/view/paper/" in href:
                continue
            bio = _match(first, last)
            if not bio:
                unmatched += 1
                continue
            try:
                page = c.get(BASE + href, headers={"Referer": HOME}).text
            except Exception as e:
                print(f"  [warn] {first} {last}: {e}")
                continue
            rows = parse_part8(page)
            if not rows:
                no_pos += 1
                continue
            url = BASE + href
            for pos, org, etype, loc in rows:
                key = (bio, org, pos, year)
                if key in existing:
                    continue
                existing.add(key)
                db.add(MemberPosition(
                    bioguide_id=bio, position=pos, organization=org,
                    entity_type=etype or None, location=loc or None,
                    year=year, doc_id=href.strip("/").split("/")[-1][:40],
                    source_url=url, ingested_at=datetime.utcnow()))
                inserted += 1
            time.sleep(0.25)
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[senate_pos] commit failed — {type(e).__name__}: {e}")
            return 0

        print(f"[senate_pos] Done — inserted={inserted} filings={seen} "
              f"unmatched_filer={unmatched} no_positions={no_pos}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(0 if ingest() is not None else 1)
