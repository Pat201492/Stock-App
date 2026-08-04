"""
ingest_lobbying.py — revolving-door ties from Senate LDA registrations.

  https://lda.senate.gov/api/v1/filings/?filing_year=YYYY&filing_type=RR

When a lobbyist registers for a client they must disclose any "covered
position" previously held in government, and those entries name the member
whose office they worked in:

    "SW Washington Director for Sen. Murray"
    "Deputy Chief of Staff to Rep. Pat Fallon (R-TX)"

That gives an edge the other sources can't: from a member's old staff, through a
lobbying firm, to whoever is now paying for the access. Roughly 47% of lobbyist
entries carry a covered position and about a fifth of those name a sitting
member once matched strictly.

No API key. Registrations only (filing_type=RR) — quarterly reports repeat the
same roster, and registrations are where a covered position is first declared.
6,981 registrations for 2025, and page_size is capped at 25 whatever you ask
for, so it's ~280 requests per year at a deliberately gentle pace.

Matching refuses anything it can't pin down, because a wrong edge here invents a
relationship between a real person and a lobbying client:

  - "former Rep. X" is skipped outright. Brian Baird left in 2011 and is not
    Jim Baird, who currently sits — surname-only matching cheerfully conflated
    the two.
  - a first name in the text has to agree with the member's.
  - a surname shared by two sitting members is dropped unless a first name
    settles it.
  - the chamber in the title has to match the chamber they serve in.

A covered position often lists several former bosses ("... Rep. Jim Jordan.
Deputy Chief of Staff ... Rep. Darrell Issa"), so every name in the string is
extracted, not just the first.
"""
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime

from politicians_database import init_pol_db, SessionLocal, LobbyTie, Politician

UA = "Mozilla/5.0 (compatible; StockApp/1.0; +https://github.com/Pat201492/Stock-App)"
API = "https://lda.senate.gov/api/v1"
YEARS = [2025, 2026]
PAGE_PAUSE = 1.1          # unauthenticated; stay well under the published limit
MAX_PAGES = 400           # guard against an unbounded walk

_TITLE_RE = re.compile(
    r"(?P<former>\bformer\s+)?"
    r"\b(?P<title>Rep|Sen|Representative|Senator|Congressman|Congresswoman)\b\.?\s+"
    r"(?P<name>(?:[A-Z][A-Za-z.'’-]+)(?:\s+[A-Z][A-Za-z.'’-]+){0,2})")
_CHAMBER = {"rep": ("rep", "house"), "representative": ("rep", "house"),
            "congressman": ("rep", "house"), "congresswoman": ("rep", "house"),
            "sen": ("sen", "senate"), "senator": ("sen", "senate")}
# Words that follow a title but aren't a surname.
_STOP = {"whip", "leader", "affairs", "office", "committee", "staff", "deputy",
         "chief", "director", "counsel", "the", "and", "for", "of", "member"}


def _norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.lower())


def _get(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json"})
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < retries - 1:
                time.sleep(20 * (attempt + 1))     # backing off, not hammering
                continue
            raise
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(3 * (attempt + 1))


def build_lookup(db):
    by_last = {}
    for bio, fn, ln, ch, act in db.query(
            Politician.bioguide_id, Politician.first_name, Politician.last_name,
            Politician.chamber, Politician.active).all():
        k = _norm(ln)
        if k:
            by_last.setdefault(k, []).append(
                (bio, _norm(fn), (ch or "").lower(), bool(act)))
    return by_last


def match_members(cp, by_last):
    """Every sitting member named in a covered position. Ambiguity -> skip."""
    out = []
    for m in _TITLE_RE.finditer(cp or ""):
        if m.group("former"):
            continue
        toks = [t for t in m.group("name").split() if _norm(t) not in _STOP]
        if not toks:
            continue
        cands = [x for x in by_last.get(_norm(toks[-1]), []) if x[3]]
        if not cands:
            continue
        first = _norm(toks[0]) if len(toks) > 1 else ""
        # The title's chamber usually settles it, but members move between
        # chambers, so a mismatch alone can't be fatal: a staffer for "Rep.
        # Marsha Blackburn" is describing today's Senator Blackburn.
        #
        # What can't be waved through is a mismatch with no first name.
        # "Tax Counsel, Sen. Menendez" is the senator who resigned in 2024, and
        # with only a surname to go on it would otherwise land on Rob Menendez
        # Jr. — his son, who sits in the House. Different person entirely.
        want = _CHAMBER.get(m.group("title").lower().rstrip("."))
        if want:
            same_chamber = [x for x in cands if x[2] in want]
            if same_chamber:
                cands = same_chamber
            elif not first:
                continue          # wrong chamber and nothing to identify them by
        if len(cands) == 1:
            if first and not (cands[0][1].startswith(first[:3])
                              or first.startswith(cands[0][1][:3])):
                continue
            out.append(cands[0][0])
            continue
        tied = [x for x in cands if first and
                (x[1].startswith(first[:3]) or first.startswith(x[1][:3]))]
        if len(tied) == 1:
            out.append(tied[0][0])
    return list(dict.fromkeys(out))


def ingest(years=None):
    init_pol_db()
    db = SessionLocal()
    try:
        by_last = build_lookup(db)
        existing = {(b, l, c, y) for b, l, c, y in db.query(
            LobbyTie.bioguide_id, LobbyTie.lobbyist_name,
            LobbyTie.client, LobbyTie.filing_year).all()}
        print(f"[lobby] {len(existing)} ties already stored")

        inserted = filings = with_cp = 0
        for year in (years or YEARS):
            page = 1
            while page <= MAX_PAGES:
                url = (f"{API}/filings/?filing_year={year}&filing_type=RR"
                       f"&page_size=25&page={page}")
                try:
                    d = _get(url)
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        break                      # walked past the last page
                    print(f"[lobby] {year} p{page}: HTTP {e.code}, stopping")
                    break
                except Exception as e:
                    print(f"[lobby] {year} p{page}: {type(e).__name__}, stopping")
                    break

                results = d.get("results") or []
                if not results:
                    break
                if page == 1:
                    print(f"[lobby] {year}: {d.get('count')} registrations")

                for f in results:
                    filings += 1
                    reg = ((f.get("registrant") or {}).get("name") or "")[:200]
                    cli = ((f.get("client") or {}).get("name") or "")[:200]
                    uuid = f.get("filing_uuid") or ""
                    if not cli:
                        continue
                    for a in (f.get("lobbying_activities") or []):
                        for l in (a.get("lobbyists") or []):
                            cp = (l.get("covered_position") or "").strip()
                            if not cp:
                                continue
                            with_cp += 1
                            who = l.get("lobbyist") or {}
                            name = " ".join(x for x in (who.get("first_name"),
                                                        who.get("last_name")) if x)[:120]
                            for bio in match_members(cp, by_last):
                                key = (bio, name, cli, year)
                                if key in existing:
                                    continue
                                existing.add(key)
                                db.add(LobbyTie(
                                    bioguide_id=bio, lobbyist_name=name,
                                    position=cp[:600], registrant=reg, client=cli,
                                    filing_year=year, filing_uuid=uuid,
                                    ingested_at=datetime.utcnow()))
                                inserted += 1

                if page % 40 == 0:
                    print(f"   {year} p{page} … +{inserted}")
                    try:
                        db.commit()
                    except Exception as e:
                        db.rollback()
                        print(f"   commit failed: {type(e).__name__}: {e}")
                if not d.get("next"):
                    break
                page += 1
                time.sleep(PAGE_PAUSE)

            try:
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"[lobby] {year}: commit failed — {type(e).__name__}: {e}")

        print(f"[lobby] Done — inserted={inserted} filings={filings} "
              f"covered_positions={with_cp}")
        return inserted
    finally:
        db.close()


if __name__ == "__main__":
    yrs = [int(a) for a in sys.argv[1:] if a.isdigit()]
    ingest(yrs or None)
