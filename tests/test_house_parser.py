"""Offline unit tests for the House PTR parser (ingest_house). No network/PDFs:
the parser functions are pure (text in -> structured out)."""
import os
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import ingest_house as h
from politicians_database import Base, Politician

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "house_ptr_sample.txt")


def _sample():
    with open(FIXTURE, encoding="utf-8") as f:
        return f.read()


def test_parse_header():
    name, statedst = h.parse_header(_sample())
    assert name == "Richard W. Allen"
    assert statedst == "GA12"


def test_is_scanned():
    assert h.is_scanned("") is True
    assert h.is_scanned("   \n  \n") is True
    assert h.is_scanned(_sample()) is False


def test_parse_transactions_tickers():
    txns = h.parse_transactions(_sample())
    tickers = [t["ticker"] for t in txns]
    # ABT, AAPL, AMZN are stocks; the muni bond + Treasury (CUSIP) carry no ticker
    assert tickers == ["ABT", "AAPL", "AMZN"]


def test_abt_sale_full_wrapped_amount():
    t = next(t for t in h.parse_transactions(_sample()) if t["ticker"] == "ABT")
    assert t["type"] == "sale_full"
    assert t["txn_date"] == date(2026, 4, 16)
    assert t["disc_date"] == date(2026, 5, 4)
    assert (t["amount_min"], t["amount_max"]) == (15001, 50000)
    assert t["owner"] == "spouse"


def test_aapl_purchase_sameline():
    t = next(t for t in h.parse_transactions(_sample()) if t["ticker"] == "AAPL")
    assert t["type"] == "purchase"
    assert (t["amount_min"], t["amount_max"]) == (1001, 15000)
    assert t["owner"] == "joint"


def test_amzn_partial_sale():
    t = next(t for t in h.parse_transactions(_sample()) if t["ticker"] == "AMZN")
    assert t["type"] == "sale_partial"
    assert t["txn_date"] == date(2026, 3, 16)


def test_no_ticker_rows_skipped():
    tickers = [t["ticker"] for t in h.parse_transactions(_sample())]
    assert "91282CJR3" not in tickers  # Treasury CUSIP never becomes a ticker


def test_parse_date():
    assert h._parse_date("04/16/2026") == date(2026, 4, 16)
    assert h._parse_date("2026-04-16") == date(2026, 4, 16)
    assert h._parse_date("") is None
    assert h._parse_date("garbage") is None


def test_norm_name():
    assert h._norm_name("David A", "Perdue, Jr") == "david perdue"
    assert h._norm_name("Richard W.", "Allen") == "richard allen"
    # accent strip: Sánchez -> sanchez (PTR index emits ASCII)
    assert h._norm_name("Linda T.", "Sánchez") == "linda sanchez"


def test_norm_last():
    assert h._norm_last("Hagerty, IV") == "hagerty"
    assert h._norm_last("Perdue, Jr") == "perdue"
    assert h._norm_last("Sánchez") == "sanchez"
    assert h._norm_last("  STAUBER  ") == "stauber"


def test_bioguide_match_with_district():
    """Two reps with the same normalized name in different districts must
    disambiguate by State/District."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add_all([
        Politician(bioguide_id="G1", first_name="John", last_name="Smith",
                   chamber="rep", state="GA", district="12"),
        Politician(bioguide_id="T1", first_name="John", last_name="Smith",
                   chamber="rep", state="TX", district="03"),
        Politician(bioguide_id="S1", first_name="Jane", last_name="Doe",
                   chamber="sen", state="CA", district=None),  # senator: excluded
    ])
    db.commit()
    by_name, by_name_dist, by_dist_last = h._build_house_lookup(db)
    assert by_name_dist[("john smith", "GA12")] == "G1"
    assert by_name_dist[("john smith", "TX03")] == "T1"
    assert ("jane doe", "CA") not in by_name  # senate filtered out


def test_district_padding_and_dist_last_lookup():
    """DB stores district as '8'; House index emits 'PA08'. Lookup must pad.
    by_dist_last covers nickname mismatches (Rob/Robert) for active reps."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add_all([
        # Active sitting rep stored unpadded; PTR comes in as 'PA08'.
        Politician(bioguide_id="B1", first_name="Robert", last_name="Bresnahan",
                   chamber="rep", state="PA", district="8", active=True),
        # Inactive predecessor with same normalized name should NOT win attribution
        Politician(bioguide_id="OLD", first_name="Robert", last_name="Bresnahan",
                   chamber="rep", state="PA", district="8", active=False),
    ])
    db.commit()
    _, by_name_dist, by_dist_last = h._build_house_lookup(db)
    assert ("robert bresnahan", "PA08") in by_name_dist
    assert by_dist_last[("PA08", "bresnahan")] == "B1"  # active wins


def test_dist_last_resolves_nickname():
    """PTR 'Rob Bresnahan' (PA08) doesn't norm-match DB 'Robert Bresnahan'.
    by_dist_last on (statedst, last) covers it."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(Politician(bioguide_id="B1", first_name="Robert", last_name="Bresnahan",
                      chamber="rep", state="PA", district="8", active=True))
    db.commit()
    _, _, by_dist_last = h._build_house_lookup(db)
    # filer arrives as Rob/PA08 — name norm would miss; dist+last hits.
    assert by_dist_last[("PA08", h._norm_last("Bresnahan"))] == "B1"
