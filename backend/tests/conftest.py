import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=DeprecationWarning)

import pytest  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def settings():
    return Settings()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    return TestClient(create_app(Settings()))


CONTACTS = [
    {"name": "Kumar", "upi_id": "kumar@okbank", "verified": True},
    {"name": "Priya Sharma", "upi_id": "priya.s@oksbi", "verified": True},
    {"name": "Ravi", "upi_id": "ravi@paytm", "verified": False},
]
