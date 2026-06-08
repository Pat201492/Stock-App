"""
notifications.py — push-notification service interface and implementations.

MockNotificationService: in-memory, used in tests.
FCMNotificationService: stubbed; no network calls until credentials are wired.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class NotificationPayload:
    token: str
    title: str
    body: str
    data: Dict[str, Any] = field(default_factory=dict)


class NotificationService(ABC):
    @abstractmethod
    def send(self, payload: NotificationPayload) -> bool: ...


class MockNotificationService(NotificationService):
    def __init__(self) -> None:
        self.sent: List[NotificationPayload] = []

    def send(self, payload: NotificationPayload) -> bool:
        self.sent.append(payload)
        return True


class FCMNotificationService(NotificationService):
    """Stubbed FCM implementation — no network calls until credentials configured."""

    def send(self, payload: NotificationPayload) -> bool:
        # TODO: use firebase-admin SDK once server credentials are provisioned
        raise NotImplementedError("FCM credentials not configured")
