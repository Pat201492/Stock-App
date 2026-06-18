"""Offline unit tests for the Senate eFD PTR HTML parser (ingest_senate_efd).
No network: parse_ptr_html is pure (HTML text in -> structured trades out)."""
import os
from datetime import date

import ingest_senate_efd as s

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "senate_ptr_sample.html")


def _sample():
    with open(FIXTURE, encoding="utf-8") as f:
        return f.read()


def test_parses_tickered_and_treasury_rows():
    txns = s.parse_ptr_html(_sample())
    # two tickered rows + the no-ticker Treasury row under a TREAS sentinel
    assert [t["ticker"] for t in txns] == ["KHC", "AAPL", "TREAS"]


def test_treasury_row_captured():
    t = next(t for t in s.parse_ptr_html(_sample()) if t["ticker"] == "TREAS")
    assert "treasur" in t["asset"].lower()      # feeds the /treasury asset filter
    assert t["type"] == "purchase"
    assert (t["amount_min"], t["amount_max"]) == (50001, 100000)


def test_fields_mapped():
    khc = s.parse_ptr_html(_sample())[0]
    assert khc["txn_date"] == date(2026, 5, 21)
    assert khc["type"] == "purchase"
    assert khc["owner"] == "self"
    assert khc["amount_min"] == 1001
    assert khc["amount_max"] == 15000


def test_partial_sale_type():
    aapl = s.parse_ptr_html(_sample())[1]
    assert aapl["type"] == "sale_partial"
    assert aapl["amount_min"] == 15001


def test_amount_label_map():
    assert s._amount("$50,001 - $100,000") == (50001, 100000)
    assert s._amount("Over $50,000,000") == (50000001, 99999999)
    assert s._amount("nonsense") == (None, None)


def test_empty_html():
    assert s.parse_ptr_html("<html><body>no table</body></html>") == []
