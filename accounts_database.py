"""
accounts_database.py — lightweight account layer (favorites + paper trades).
Separate DB (accounts.db) so the nightly data push (stocks.db/politicians.db)
never clobbers user data. Username-only (no auth).
"""
import os
from datetime import datetime, date
from sqlalchemy import (
    create_engine, Column, String, Float, Integer, Date, DateTime, event
)
from sqlalchemy.orm import declarative_base, sessionmaker

_DB_PATH = os.environ.get("ACCOUNTS_DB_PATH", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "accounts.db"
))
engine = create_engine(f"sqlite:///{_DB_PATH}", connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def _wal(conn, _):
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


class Favorite(Base):
    __tablename__ = "favorites"
    username   = Column(String, primary_key=True)
    ticker     = Column(String, primary_key=True)
    kind       = Column(String)   # 'stock' | 'etf'
    created_at = Column(DateTime, default=datetime.utcnow)


class PaperTrade(Base):
    __tablename__ = "paper_trades"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    username   = Column(String, index=True)
    ticker     = Column(String)
    kind       = Column(String)   # 'stock' | 'etf'
    side       = Column(String)   # 'buy' | 'sell'
    shares     = Column(Float)
    price      = Column(Float)    # user-entered (daily pull)
    traded_on  = Column(Date, default=date.today)
    note       = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


def init_accounts_db():
    Base.metadata.create_all(engine)


def get_acct_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
