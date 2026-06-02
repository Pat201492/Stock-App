"""
auth.py — password hashing, session tokens, and reset-email sending (stdlib only).
"""
import os, hashlib, secrets, smtplib
from email.message import EmailMessage

_ITERS = 200_000


def hash_password(password: str, salt: str = None):
    """Returns (hash_hex, salt_hex). PBKDF2-HMAC-SHA256."""
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITERS)
    return dk.hex(), salt


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    if not salt or not expected_hash:
        return False
    calc, _ = hash_password(password, salt)
    return secrets.compare_digest(calc, expected_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def send_reset_email(to_email: str, link: str) -> bool:
    """Send the reset link via SMTP. Returns True if sent; False if SMTP isn't
    configured or sending failed (caller then surfaces the link directly)."""
    host = os.environ.get("SMTP_HOST")
    if not host:
        return False
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "")
    pw   = os.environ.get("SMTP_PASS", "")
    sender = os.environ.get("SMTP_FROM", user or "no-reply@stocktracker")
    try:
        msg = EmailMessage()
        msg["Subject"] = "Stock Tracker — password reset"
        msg["From"] = sender
        msg["To"] = to_email
        msg.set_content(
            f"Reset your Stock Tracker password using this link (valid 1 hour):\n\n{link}\n\n"
            f"If you didn't request this, ignore this email."
        )
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.starttls()
            if user:
                s.login(user, pw)
            s.send_message(msg)
        return True
    except Exception:
        return False
