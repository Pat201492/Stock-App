"""Offline tests for the EDGAR companyfacts -> growth parser. No network: the
parser functions are pure over a companyfacts dict."""
import ingest_fundamentals_history as e


def _entry(start, end, val, filed, form="10-K", fp="FY"):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": form, "fp": fp}


def _facts(concept_units):
    return {"facts": {"us-gaap": concept_units}}


def test_annual_series_picks_annual_latest_filed():
    facts = _facts({
        "Revenues": {"units": {"USD": [
            _entry("2021-01-01", "2021-12-31", 100, "2022-02-01"),
            _entry("2022-01-01", "2022-12-31", 120, "2023-02-01"),
            # restatement of 2021 in a later filing — latest filed wins
            _entry("2021-01-01", "2021-12-31", 105, "2023-02-01"),
            # a quarterly (must be excluded — span < 350d)
            _entry("2022-10-01", "2022-12-31", 30, "2023-02-01"),
            # YTD/partial (excluded)
            _entry("2022-01-01", "2022-06-30", 60, "2022-08-01"),
        ]}},
    })
    s = e.annual_series(facts, ["Revenues"], "USD")
    assert s == {2021: 105, 2022: 120}


def test_annual_series_merges_concept_variants():
    facts = _facts({
        "SalesRevenueNet": {"units": {"USD": [_entry("2019-01-01", "2019-12-31", 80, "2020-02-01")]}},
        "Revenues": {"units": {"USD": [_entry("2020-01-01", "2020-12-31", 90, "2021-02-01")]}},
    })
    s = e.annual_series(facts, ["Revenues", "SalesRevenueNet"], "USD")
    assert s == {2019: 80, 2020: 90}


def test_compute_growth_cagrs_and_fcf_avg():
    yrs = range(2019, 2025)  # 2019..2024
    rev = [100, 110, 121, 133, 146, 161]      # ~10%/yr
    eps = [1.00, 1.10, 1.21, 1.33, 1.46, 1.61]
    ocf = [50, 55, 60, 66, 72, 80]
    capex = [10, 11, 12, 13, 14, 15]
    def mk(vals):
        return {"units": {"USD": [_entry(f"{y}-01-01", f"{y}-12-31", v, f"{y+1}-02-01")
                                  for y, v in zip(yrs, vals)]}}
    facts = _facts({
        "Revenues": mk(rev),
        "NetCashProvidedByUsedInOperatingActivities": mk(ocf),
        "PaymentsToAcquirePropertyPlantAndEquipment": mk(capex),
        "EarningsPerShareDiluted": {"units": {"USD/shares": [
            _entry(f"{y}-01-01", f"{y}-12-31", v, f"{y+1}-02-01") for y, v in zip(yrs, eps)]}},
    })
    g = e.compute_growth(facts)
    assert round(g["rev_cagr_5y"], 1) == 10.0      # 100->161 over 5y
    assert round(g["eps_cagr_5y"], 1) == 10.0
    assert g["fcf_3yr_avg_raw"] == (66 - 13 + 72 - 14 + 80 - 15) / 3  # last 3 yrs OCF-CapEx


def test_negative_start_cagr_is_none():
    # EPS goes negative->positive: CAGR undefined (start <= 0)
    facts = _facts({"EarningsPerShareDiluted": {"units": {"USD/shares": [
        _entry("2019-01-01", "2019-12-31", -1.0, "2020-02-01"),
        _entry("2024-01-01", "2024-12-31", 2.0, "2025-02-01"),
    ]}}})
    g = e.compute_growth(facts)
    assert "eps_cagr_5y" not in g  # undefined, not stored


def test_empty_facts():
    assert e.compute_growth({}) == {}
    assert e.annual_series({}, ["Revenues"], "USD") == {}
