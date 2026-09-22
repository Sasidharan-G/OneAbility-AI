"""Server-side payment flow state machine (PRD 12.1): confirm gate, lock, idempotent execute.

State: awaiting_confirmation -> executed | cancelled ; blocked and expired are terminal.
Nothing here moves real money. Transaction ids are labelled MOCK.
"""
from __future__ import annotations

import secrets
import threading
import time
from typing import Optional

from .config import Settings, get_settings


class FlowError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class FlowStore:
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._flows: dict[str, dict] = {}
        self._lock = threading.Lock()

    def _gc(self, now: float) -> None:
        ttl = self.settings.flow_ttl_s
        for fid in [k for k, f in self._flows.items() if now - f["created"] > ttl * 6]:
            del self._flows[fid]

    def create(self, draft: dict, guard: dict) -> dict:
        now = time.time()
        with self._lock:
            self._gc(now)
            fid = "flow_" + secrets.token_hex(8)
            f = {"id": fid, "draft": draft, "guard": guard, "created": now, "result": None,
                 "state": "blocked" if guard["blocked"] else "awaiting_confirmation"}
            self._flows[fid] = f
            return self._public(f)

    def get(self, fid: str) -> dict:
        with self._lock:
            return self._public(self._must(fid))

    def _must(self, fid: str) -> dict:
        f = self._flows.get(fid)
        if not f:
            raise FlowError(404, "FLOW_NOT_FOUND", "Payment flow not found.")
        if f["state"] == "awaiting_confirmation" and time.time() - f["created"] > self.settings.flow_ttl_s:
            f["state"] = "expired"
        return f

    @staticmethod
    def _public(f: dict) -> dict:
        return {"flow_id": f["id"], "state": f["state"], "draft": f["draft"], "guard": f["guard"],
                "result": f["result"]}

    def decide(self, fid: str, decision: str, auth: Optional[dict], acknowledged: bool) -> dict:
        """Apply Yes/No. The lock makes a second 'yes' return the first result (SEC-06)."""
        if decision not in ("yes", "no"):
            raise FlowError(422, "BAD_DECISION", "Decision must be yes or no.")
        with self._lock:
            f = self._must(fid)
            st = f["state"]
            if st == "executed":
                return {**self._public(f), "duplicate": True}
            if st == "cancelled":
                if decision == "no":
                    return {**self._public(f), "duplicate": True}
                raise FlowError(409, "FLOW_CANCELLED", "This payment was cancelled.")
            if st == "blocked":
                if decision == "no":
                    f["state"] = "cancelled"
                    return {**self._public(f), "duplicate": False}
                raise FlowError(409, "FLOW_BLOCKED", "This payment is blocked by safety checks.")
            if st == "expired":
                raise FlowError(410, "FLOW_EXPIRED", "This payment request expired. Start again.")
            if decision == "no":
                f["state"] = "cancelled"
                return {**self._public(f), "duplicate": False}
            if f["guard"]["needs_ack"] and not acknowledged:
                raise FlowError(428, "ACK_REQUIRED", "Please acknowledge the warnings before confirming.")
            method = (auth or {}).get("method", "none")
            if method not in ("webauthn", "demo"):
                raise FlowError(403, "AUTH_REQUIRED", "Authorization is required before payment.")
            f["result"] = {
                "mock_txn_id": "MOCK-" + secrets.token_hex(5).upper(),
                "executed_at": int(time.time() * 1000),
                "auth_method": method,
                "auth_label": "Device authenticator (WebAuthn)" if method == "webauthn" else "Demo authorization (no biometric checked)",
                "simulated": True,
            }
            f["state"] = "executed"
            return {**self._public(f), "duplicate": False}
