"""
Tests for FCM push-notification infrastructure.
Runs fully offline — no network calls, no live DB file.
"""
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("ACCOUNTS_DB_PATH", ":memory:")

from accounts_database import Base, DeviceToken, User
from notifications import MockNotificationService, FCMNotificationService, NotificationPayload


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    yield s
    s.close()
    engine.dispose()


def _make_user(db, email: str = "test@example.com") -> User:
    u = User(email=email, password_hash="x", salt="s", display_name="Test")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# ── DeviceToken persistence ───────────────────────────────────────────────────

def test_token_registration_persists(db):
    user = _make_user(db)
    db.add(DeviceToken(user_id=user.id, fcm_token="tok-abc-123"))
    db.commit()
    rows = db.query(DeviceToken).filter(DeviceToken.user_id == user.id).all()
    assert len(rows) == 1
    assert rows[0].fcm_token == "tok-abc-123"
    assert rows[0].user_id == user.id


def test_token_deduplication(db):
    user = _make_user(db)
    fcm = "dup-token-xyz"

    def _register():
        exists = (
            db.query(DeviceToken)
            .filter(DeviceToken.user_id == user.id, DeviceToken.fcm_token == fcm)
            .first()
        )
        if not exists:
            db.add(DeviceToken(user_id=user.id, fcm_token=fcm))
            db.commit()

    _register()
    _register()  # second call must not insert a duplicate

    rows = db.query(DeviceToken).filter(DeviceToken.user_id == user.id).all()
    assert len(rows) == 1


def test_multiple_users_independent_tokens(db):
    u1 = _make_user(db, "alice@example.com")
    u2 = _make_user(db, "bob@example.com")
    db.add(DeviceToken(user_id=u1.id, fcm_token="token-alice"))
    db.add(DeviceToken(user_id=u2.id, fcm_token="token-bob"))
    db.commit()
    assert db.query(DeviceToken).filter(DeviceToken.user_id == u1.id).count() == 1
    assert db.query(DeviceToken).filter(DeviceToken.user_id == u2.id).count() == 1


# ── MockNotificationService ───────────────────────────────────────────────────

def test_mock_send_returns_true():
    svc = MockNotificationService()
    payload = NotificationPayload(token="tok-xyz", title="Hello", body="World")
    assert svc.send(payload) is True


def test_mock_payload_stored_correctly():
    svc = MockNotificationService()
    payload = NotificationPayload(
        token="device-token-1",
        title="Price Alert",
        body="AAPL crossed $200",
        data={"ticker": "AAPL", "price": "200.00"},
    )
    svc.send(payload)
    assert len(svc.sent) == 1
    sent = svc.sent[0]
    assert sent.token == "device-token-1"
    assert sent.title == "Price Alert"
    assert sent.body == "AAPL crossed $200"
    assert sent.data == {"ticker": "AAPL", "price": "200.00"}


def test_mock_accumulates_multiple_sends():
    svc = MockNotificationService()
    for i in range(3):
        svc.send(NotificationPayload(token=f"tok-{i}", title=f"T{i}", body="b"))
    assert len(svc.sent) == 3
    assert [p.token for p in svc.sent] == ["tok-0", "tok-1", "tok-2"]


def test_mock_default_data_is_empty_dict():
    svc = MockNotificationService()
    svc.send(NotificationPayload(token="t", title="T", body="B"))
    assert svc.sent[0].data == {}


# ── FCMNotificationService (stubbed) ─────────────────────────────────────────

def test_fcm_service_raises_not_implemented():
    svc = FCMNotificationService()
    with pytest.raises(NotImplementedError):
        svc.send(NotificationPayload(token="t", title="T", body="B"))
