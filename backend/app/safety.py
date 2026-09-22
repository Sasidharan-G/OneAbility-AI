"""Deterministic payment guards (SEC-04, 06..09). AI output never bypasses these."""
from __future__ import annotations

import math
import re
import time
from typing import Any, Optional

from .config import Settings, get_settings

VPA_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,63}@[a-zA-Z][a-zA-Z0-9]{1,31}$")
SECRET_KEYS = {"pin", "upipin", "upi_pin", "otp", "cvv", "password", "passcode", "biometric",
               "fingerprint", "face", "facedata", "template", "secret", "mpin"}


def w(code: str, severity: str, en: str, ta: str) -> dict:
    return {"code": code, "severity": severity, "message_en": en, "message_ta": ta}


def valid_amount(a: Any) -> Optional[float]:
    """Return a clean positive rupee amount (max 2 decimals) or None."""
    if isinstance(a, bool) or a is None:
        return None
    try:
        v = float(a)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v) or v <= 0:
        return None
    if round(v, 2) != v:
        return None
    return v


def contains_secret_keys(obj: Any) -> Optional[str]:
    """Recursively find a forbidden credential-like key (SEC-01/02)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower().replace("-", "_") in SECRET_KEYS:
                return str(k)
            hit = contains_secret_keys(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = contains_secret_keys(v)
            if hit:
                return hit
    return None


def check_payment(draft: dict, recent: Optional[list[dict]] = None, balance: Optional[float] = None,
                  settings: Optional[Settings] = None, now: Optional[float] = None) -> dict:
    """Return {blocked, needs_ack, warnings[]} for a payment draft."""
    s = settings or get_settings()
    now = now if now is not None else time.time()
    ws: list[dict] = []
    name = (draft.get("recipient_name") or "").strip()
    upi = (draft.get("upi_id") or "").strip()
    amount = valid_amount(draft.get("amount"))

    if draft.get("qr_blocked"):
        ws.append(w("QR_SUSPICIOUS", "block", "This QR code looks suspicious and was blocked.",
                    "இந்த QR குறியீடு சந்தேகத்திற்குரியது, தடுக்கப்பட்டது."))
    if draft.get("ambiguous_candidates"):
        names = ", ".join(draft["ambiguous_candidates"])
        ws.append(w("AMBIGUOUS_RECEIVER", "block", f"More than one contact matches: {names}. Please choose one.",
                    f"ஒன்றுக்கு மேற்பட்ட தொடர்புகள் பொருந்துகின்றன: {names}. ஒன்றைத் தேர்ந்தெடுக்கவும்."))
    elif not name and not upi:
        ws.append(w("MISSING_RECEIVER", "block", "No receiver selected.", "பெறுநர் தேர்ந்தெடுக்கப்படவில்லை."))

    if upi and not VPA_RE.match(upi):
        ws.append(w("INVALID_UPI_ID", "block", "The UPI ID format is not valid.", "UPI ஐடி வடிவம் சரியில்லை."))

    if amount is None:
        ws.append(w("INVALID_AMOUNT", "block", "Enter a valid amount greater than zero, with at most two decimals.",
                    "பூஜ்ஜியத்திற்கு அதிகமான சரியான தொகையை உள்ளிடவும்."))
    else:
        if amount > s.txn_limit:
            ws.append(w("LIMIT_EXCEEDED", "block", f"Amount is above the per-payment limit of {int(s.txn_limit)} rupees.",
                        f"ஒரு பணப்பரிவர்த்தனை வரம்பான {int(s.txn_limit)} ரூபாயை தொகை மீறுகிறது."))
        elif amount >= s.high_amount:
            ws.append(w("HIGH_AMOUNT", "warn", f"This is a high amount: {amount:g} rupees.",
                        f"இது அதிக தொகை: {amount:g} ரூபாய்."))
        if balance is not None and amount > balance:
            ws.append(w("INSUFFICIENT_BALANCE", "block", "Balance is not enough for this payment.",
                        "இந்த பணம் செலுத்த இருப்பு போதவில்லை."))

    if (name or upi) and not draft.get("ambiguous_candidates"):
        if not draft.get("known"):
            ws.append(w("UNKNOWN_RECEIVER", "warn", "This receiver is not in your saved contacts.",
                        "இந்த பெறுநர் உங்கள் சேமித்த தொடர்புகளில் இல்லை."))
        elif not draft.get("verified"):
            ws.append(w("UNVERIFIED_RECEIVER", "warn", "This receiver has not been verified.",
                        "இந்த பெறுநர் சரிபார்க்கப்படவில்லை."))

    if amount is not None and recent:
        key = (upi or name).lower()
        for t in recent:
            if t.get("status", "success") != "success":
                continue
            tkey = (t.get("upi_id") or t.get("recipient") or "").lower()
            ts = t.get("ts")
            ts = ts / 1000 if isinstance(ts, (int, float)) and ts > 1e11 else ts
            if key and tkey == key and valid_amount(t.get("amount")) == amount and isinstance(ts, (int, float)) \
                    and 0 <= now - ts <= s.duplicate_window_s:
                ws.append(w("DUPLICATE_RECENT", "warn", "You paid the same amount to this receiver a moment ago.",
                            "சற்று முன் இதே தொகையை இதே பெறுநருக்கு செலுத்தினீர்கள்."))
                break

    blocked = any(x["severity"] == "block" for x in ws)
    needs_ack = any(x["severity"] == "warn" for x in ws)
    return {"blocked": blocked, "needs_ack": needs_ack and not blocked, "warnings": ws}
