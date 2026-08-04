"""
politicians_database.py — SQLAlchemy models for congressional + insider trade data
Separate DB (politicians.db) from stocks.db to keep concerns isolated.
"""
import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, String, Float, Integer,
    Boolean, Date, DateTime, Text, UniqueConstraint, Index, event
)
from sqlalchemy.orm import declarative_base, sessionmaker

_DB_PATH = os.environ.get("POL_DB_PATH", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "politicians.db"
))
DATABASE_URL = f"sqlite:///{_DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

@event.listens_for(engine, "connect")
def _set_wal_mode(dbapi_conn, _):
    dbapi_conn.execute("PRAGMA journal_mode=WAL")
    dbapi_conn.execute("PRAGMA busy_timeout=5000")

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


class Politician(Base):
    """Members. term_start/term_end/terms_count come from congress-legislators;
    service is often split across chambers with gaps, so term_start is the first
    seat they ever took and terms_count carries the rest."""
    __tablename__ = "politicians"
    bioguide_id = Column(String, primary_key=True)
    first_name  = Column(String)
    last_name   = Column(String)
    chamber     = Column(String)   # 'house' | 'senate'
    party       = Column(String)
    state       = Column(String)
    district    = Column(String)   # house only
    active      = Column(Boolean, default=True)
    term_start  = Column(String)   # ISO date of their very first term
    term_end    = Column(String)   # ISO date the current/last term runs to
    terms_count = Column(Integer)


class Committee(Base):
    __tablename__ = "committees"
    committee_id        = Column(String, primary_key=True)
    name                = Column(String)
    chamber             = Column(String)
    parent_committee_id = Column(String)   # NULL for full committees


class CommitteeMembership(Base):
    __tablename__ = "committee_memberships"
    bioguide_id  = Column(String, primary_key=True)
    committee_id = Column(String, primary_key=True)
    start_date   = Column(Date,   primary_key=True)
    role         = Column(String)   # 'Chair' | 'Ranking Member' | 'Member'
    end_date     = Column(Date)     # NULL = current


class CongressionalTrade(Base):
    __tablename__ = "congressional_trades"
    trade_id          = Column(String, primary_key=True)  # hash(bioguide+ticker+date+amount+type)
    bioguide_id       = Column(String, index=True)
    ticker            = Column(String, index=True)
    asset_description = Column(Text)
    transaction_date  = Column(Date,   index=True)
    disclosure_date   = Column(Date)
    transaction_type  = Column(String)  # 'purchase' | 'sale_full' | 'sale_partial' | 'exchange'
    amount_min        = Column(Integer)
    amount_max        = Column(Integer)
    owner             = Column(String)  # 'self' | 'spouse' | 'dependent' | 'joint'
    source            = Column(String)  # 'senate_stock_watcher'
    ingested_at       = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        Index("ix_ctrade_ticker_date", "ticker", "transaction_date"),
        Index("ix_ctrade_bio_date",    "bioguide_id", "transaction_date"),
    )


class InsiderTrade(Base):
    __tablename__ = "insider_trades"
    filing_id        = Column(String, primary_key=True)   # SEC accession number
    ticker           = Column(String, index=True)
    company_name     = Column(String)
    insider_name     = Column(String)
    insider_title    = Column(String)
    transaction_date = Column(Date,   index=True)
    transaction_type = Column(String)  # 'P' purchase | 'S' sale | 'A' award etc
    shares           = Column(Float)
    price_per_share  = Column(Float)
    total_value      = Column(Float)
    shares_owned_after = Column(Float)
    form_type        = Column(String)  # '4' | '4/A'
    filed_date       = Column(Date)
    source_url       = Column(String)
    ingested_at      = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        Index("ix_insider_ticker_date", "ticker", "transaction_date"),
    )


class PolTickerMetadata(Base):
    __tablename__ = "pol_ticker_metadata"
    ticker       = Column(String, primary_key=True)
    company_name = Column(String)
    sector       = Column(String)
    industry     = Column(String)


class MemberPosition(Base):
    """Outside positions from Schedule E of the annual financial disclosure —
    board seats, partnerships, trusteeships and the like.

    Unlike the trade tables this is a *relationship* source: it ties a member to
    a named organisation, which is what the relationship web needs and what the
    hand-written curated overlay was standing in for.
    """
    __tablename__ = "member_positions"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    bioguide_id  = Column(String, index=True)
    position     = Column(String)        # "Board Member", "Partner", ...
    organization = Column(String)        # "U.S. Holocaust Museum", ...
    # Senate filings name an entity type and a location; the House form asks for
    # neither, so both stay nullable. Where present they beat guessing scope
    # from the organisation's name.
    entity_type  = Column(String)        # "Company", "Educational Organization", ...
    location     = Column(String)        # "Detroit, MI"
    year         = Column(Integer)       # filing year the disclosure covers
    doc_id       = Column(String)        # House Clerk DocID, for provenance
    source_url   = Column(String)
    ingested_at  = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("bioguide_id", "organization", "position", "year",
                         name="uq_member_position"),
        Index("ix_member_positions_org", "organization"),
    )


class PacSupport(Base):
    """Money from one PAC to one member in one cycle, from FEC bulk data.

    Stored per (member, PAC, cycle) rather than per contribution: the web only
    cares whether two members draw on the same funders, and the itemised file
    runs to millions of rows.
    """
    __tablename__ = "pac_support"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    bioguide_id  = Column(String, index=True)
    cmte_id      = Column(String, index=True)   # FEC committee (PAC) id
    cmte_name    = Column(String)
    cycle        = Column(Integer)
    total_amount = Column(Float)
    n_contribs   = Column(Integer)
    ingested_at  = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("bioguide_id", "cmte_id", "cycle", name="uq_pac_support"),
    )


class BillCosponsor(Base):
    """One member's sponsorship or cosponsorship of one bill (govinfo BILLSTATUS).

    n_cosponsors is denormalised onto every row on purpose. A resolution signed
    by 300 members links 45,000 pairs and says nothing about who works with
    whom, so the graph needs to exclude mass-signed bills — and doing that
    without a per-row bill size means a join or a second table for no gain.
    """
    __tablename__ = "bill_cosponsors"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    bioguide_id   = Column(String, index=True)
    bill_id       = Column(String, index=True)   # "119-hr-152"
    congress      = Column(Integer)
    n_cosponsors  = Column(Integer)              # size of the bill's coalition
    is_sponsor    = Column(Boolean, default=False)
    __table_args__ = (
        UniqueConstraint("bioguide_id", "bill_id", name="uq_bill_cosponsor"),
    )


class Bill(Base):
    """Bill metadata from govinfo BILLSTATUS.

    bill_cosponsors already records who signed what, but only as an id. This
    carries the parts a person can read — title, when it was introduced, where
    it has got to — so a sponsored-bills list means something.
    """
    __tablename__ = "bills"
    bill_id            = Column(String, primary_key=True)   # "119-hr-152"
    congress           = Column(Integer)
    bill_type          = Column(String)                     # hr, s, hjres, sjres
    number             = Column(Integer)
    title              = Column(Text)
    introduced_date    = Column(String)
    policy_area        = Column(String)
    latest_action_date = Column(String)
    latest_action      = Column(Text)
    sponsor_bioguide   = Column(String, index=True)
    n_cosponsors       = Column(Integer)


class FloorItem(Base):
    """A bill on the House weekly floor schedule — genuinely upcoming business.

    docs.house.gov publishes a per-week XML naming what is scheduled. That's an
    actual calendar rather than something inferred from how far a bill has got,
    which is the only honest way to say "upcoming". The Senate publishes no
    equivalent machine-readable feed, so this is House-only.
    """
    __tablename__ = "floor_items"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    week        = Column(String, index=True)   # YYYYMMDD of the week published
    chamber     = Column(String)
    legis_num   = Column(String)               # "H.R. 2715" as printed
    bill_id     = Column(String, index=True)   # "119-hr-2715", when resolvable
    description = Column(Text)
    doc_url     = Column(String)
    __table_args__ = (UniqueConstraint("week", "legis_num", name="uq_floor_item"),)


class PacCommittee(Base):
    """FEC committee master row — who is actually behind a PAC.

    The PAC's own name is often opaque ("BANKPAC"), while connected_org names
    the sponsoring company or association outright. That's the field worth
    surfacing; the rest is provenance.

    Individual donors are deliberately not here: FEC publishes them, but the
    file is 1.9GB per cycle against a 157MB database that gets copied whole on
    every publish, and for a corporate PAC it is mostly a staff list.
    """
    __tablename__ = "pac_committees"
    cmte_id       = Column(String, primary_key=True)
    name          = Column(String)
    treasurer     = Column(String)
    city          = Column(String)
    state         = Column(String)
    designation   = Column(String)   # e.g. B = lobbyist/registrant PAC
    cmte_type     = Column(String)   # e.g. Q = qualified multicandidate
    party         = Column(String)
    org_type      = Column(String)   # C = corporation, L = labour, T = trade …
    connected_org = Column(String, index=True)
    cycle         = Column(Integer)


class LobbyTie(Base):
    """A registered lobbyist who used to work for a sitting member.

    From LDA registrations: when a lobbyist registers for a client they must
    disclose any "covered position" previously held in government, and those
    entries name the member they worked for. That makes a revolving-door link
    from the member's old office to whoever is now paying for the access.
    """
    __tablename__ = "lobby_ties"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    bioguide_id   = Column(String, index=True)   # the member they worked for
    lobbyist_name = Column(String)
    position      = Column(Text)                 # the disclosed covered position
    registrant    = Column(String, index=True)   # lobbying firm
    client        = Column(String, index=True)   # who is paying
    filing_year   = Column(Integer)
    filing_uuid   = Column(String)
    ingested_at   = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("bioguide_id", "lobbyist_name", "client", "filing_year",
                         name="uq_lobby_tie"),
    )


def _migrate():
    """Idempotent migrations for already-created DBs. A UNIQUE index on the
    insider logical key stops the EDGAR + mirror sources from double-inserting
    the same trade. Creation is skipped (with a warning) if duplicates still
    exist — run `python validate.py --fix` first to collapse them."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)

    # create_all() only creates missing tables, never missing columns, so any
    # column added to an existing table needs an explicit ALTER.
    added = {
        "member_positions": [("entity_type", "VARCHAR"), ("location", "VARCHAR")],
        "politicians": [("term_start", "VARCHAR"), ("term_end", "VARCHAR"),
                        ("terms_count", "INTEGER")],
    }
    tables = set(insp.get_table_names())
    for table, cols in added.items():
        if table not in tables:
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for col, typ in cols:
            if col not in have:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))

    if "insider_trades" not in insp.get_table_names():
        return
    existing = {ix["name"] for ix in insp.get_indexes("insider_trades")}
    if "uq_insider_logical" not in existing:
        with engine.begin() as conn:
            dupes = conn.execute(text("""
                SELECT COUNT(*) - COUNT(DISTINCT
                    ticker || '|' || transaction_date || '|' || insider_name
                          || '|' || transaction_type || '|' || shares)
                FROM insider_trades
            """)).scalar() or 0
            if dupes == 0:
                conn.execute(text("""
                    CREATE UNIQUE INDEX uq_insider_logical ON insider_trades
                    (ticker, transaction_date, insider_name, transaction_type, shares)
                """))
            else:
                print(f"[migrate] {dupes} insider duplicates present — "
                      f"run `python validate.py --fix` before the unique index can be created.")


def init_pol_db():
    Base.metadata.create_all(engine)
    _migrate()


def get_pol_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
