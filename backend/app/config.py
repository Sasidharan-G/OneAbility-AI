"""Backend configuration. Secrets live only here, never in the browser (SEC-10)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
load_dotenv(BACKEND_DIR / ".env")


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip())
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip())
    gemini_timeout: float = field(default_factory=lambda: _float("GEMINI_TIMEOUT", 8.0))
    high_amount: float = field(default_factory=lambda: _float("HIGH_AMOUNT_THRESHOLD", 5000))
    txn_limit: float = field(default_factory=lambda: _float("TXN_LIMIT", 100000))
    duplicate_window_s: float = field(default_factory=lambda: _float("DUPLICATE_WINDOW_SECONDS", 120))
    flow_ttl_s: float = field(default_factory=lambda: _float("FLOW_TTL_SECONDS", 600))
    serve_frontend: bool = field(default_factory=lambda: os.getenv("SERVE_FRONTEND", "1") != "0")

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key) and self.gemini_api_key.lower() not in {"your_key_here", "changeme"}


def get_settings() -> Settings:
    return Settings()
