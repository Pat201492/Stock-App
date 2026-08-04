"""
org_scope.py — classify a disclosed organisation as national / state / private.

Schedule E organisations fall into genuinely different kinds, and lumping them
together buries the interesting ones. A member sitting on the board of the
Congressional Hunger Center is a different fact from a member owning
"Broad Street LLC", and both differ from a seat on the Colorado General Assembly.

Rule order carries the logic and must not be shuffled:

  1. private  — an LLC/Inc/Trust suffix settles it regardless of anything else.
                "Continental Divide International (CDI) LLC MT" is a company,
                not an international body and not a Montana institution.
  2. state    — checked BEFORE national, because state chapters of national
                bodies name the parent first: "AMERICAN CIVIL LIBERTIES UNION
                (ACLU) OF MICHIGAN" is Michigan's, not America's.
  3. national — national scope, incl. anything congressional or federal. Ahead
                of intl so a federal body with an international remit stays
                national ("Congressional Office of International Leadership").
  4. intl     — non-US bodies.
  5. other    — unmatched; shown with the national group rather than hidden,
                so nothing silently disappears from the graph.

Kept as a pure function with no DB column behind it: the rules will need
tuning as new filings arrive, and a stored column would mean a re-ingest every
time they change.
"""
import re

STATES = {
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Washington", "West Virginia", "Wisconsin", "Wyoming",
}
STATE_ABBR = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY",
}

# Corporate/■personal-vehicle suffixes and markers.
_PRIVATE_RE = re.compile(
    r"(?:^|[\s,(])(?:LLC|L\.L\.C\.|LLP|LP|L\.P\.|LC|Inc\.?|Incorporated|Corp\.?|"
    r"Co\.?|Company|Ltd\.?|PLLC|PC)(?:$|[\s,.)])|"
    r"\b(?:Revocable\s+Trust|Family\s+Trust|Living\s+Trust|Trust,|Trust$|"
    r"Properties|Holdings|Realty|Enterprises|Rentals|Partners|Partnership|"
    r"&\s+Associates|dba)\b",
    re.I)

_LOCAL_RE = re.compile(
    r"\b(?:County|Counties|City\s+of|Township|Borough|Municipal|"
    r"General\s+Assembly|State\s+Legislature|Local\s+Chapter|School\s+District|"
    r"PERA)\b", re.I)

_INTL_RE = re.compile(
    r"\b(?:International|Munich|Dominican\s+Republic|Tinian|Global|"
    r"Foreign|Overseas)\b", re.I)

_NATIONAL_RE = re.compile(
    r"\b(?:National|Nationwide|Congressional|Congress|Federal|"
    r"United\s+States|U\.S\.|US|USA|America|American|America's)\b", re.I)


def _has_state(name):
    if any(re.search(r"\b" + re.escape(s) + r"\b", name, re.I) for s in STATES):
        return True
    # Two-letter abbreviations are only a signal in mixed-case names. Plenty of
    # state codes are also ordinary words (IN, OR, OK, ME, HI, DE, LA), and in an
    # all-caps filing they match constantly — "NATIONAL MUSEUM FOR WOMEN IN THE
    # ARTS" came out as Indiana. Mixed case keeps "NC General Assembly" working.
    letters = [ch for ch in name if ch.isalpha()]
    if letters and all(ch.isupper() for ch in letters):
        return False
    return any(re.search(r"(?:^|[\s,(])" + a + r"(?:$|[\s,.)])", name)
               for a in STATE_ABBR)


# Senate filings name the entity type outright. Trust it over the name — the
# House form doesn't ask, so this is only ever available for the Senate half.
_ETYPE_PRIVATE = re.compile(
    r"\b(?:Company|Corporation|Partnership|Sole\s+Proprietorship|"
    r"Trust|LLC|Business)\b", re.I)
_ETYPE_LOCAL = re.compile(
    r"\b(?:County|City|Municipal|State\s+Government|Local)\b", re.I)


def classify(name, entity_type=None, location=None):
    """-> 'private' | 'state' | 'intl' | 'national' | 'other'

    entity_type and location come from Senate filings and are authoritative
    when present: a form field beats a keyword guess against the name.
    """
    n = (name or "").strip()
    if not n:
        return "other"

    if entity_type:
        if _ETYPE_PRIVATE.search(entity_type):
            return "private"
        if _ETYPE_LOCAL.search(entity_type):
            return "state"
    # A city/state suffix on the entity is stronger evidence of a local body
    # than anything in the name — but only after private has had its say, since
    # a company headquartered somewhere is still a company.
    if location and not _PRIVATE_RE.search(n):
        st = location.rsplit(",", 1)[-1].strip().upper()
        if st in STATE_ABBR and not _NATIONAL_RE.search(n):
            return "state"

    if _PRIVATE_RE.search(n):
        return "private"
    if _LOCAL_RE.search(n) or _has_state(n):
        return "state"
    # National before international: a US federal body with an international
    # remit is still a national one. "Congressional Office of International
    # Leadership" is Congress's, not a foreign organisation.
    if _NATIONAL_RE.search(n):
        return "national"
    if _INTL_RE.search(n):
        return "intl"
    return "other"


# What the graph shows. 'other' rides with national so nothing vanishes.
GROUP = {"private": "private", "state": "state",
         "intl": "national", "national": "national", "other": "national"}


def edge_kind(name, entity_type=None, location=None):
    """Edge kind for a position at this organisation."""
    return "position_" + GROUP[classify(name, entity_type, location)]
