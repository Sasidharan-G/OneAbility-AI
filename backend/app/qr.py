"""QR payload parsing and verification (F04, SEC-08). Allow-list of UPI pay fields only."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import parse_qsl, unquote, urlsplit

from .nlp import norm_name
from .safety import VPA_RE, valid_amount, w

ALLOWED_PARAMS = {"pa", "pn", "am", "cu", "tn", "tr", "tid", "mc", "url", "mode", "purpose", "orgid", "sign", "mid", "msid", "mtid", "cq", "refurl", "ver", "qrmedium"}
SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "goo.gl", "cutt.ly", "is.gd", "rb.gy", "shorturl.at")
MAX_LEN = 1000
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _result(valid: bool, blocked: bool, warnings: list, payee: Optional[dict] = None, kind: str = "unknown") -> dict:
    return {"valid": valid, "blocked": blocked, "kind": kind, "payee": payee, "warnings": warnings,
            "known": False, "verified": False, "contact": None}


def verify_qr(payload: str, contacts: Optional[list[dict]] = None) -> dict:
    """Parse + assess a decoded QR string. Never fetches anything from the network."""
    contacts = contacts or []
    raw = payload if isinstance(payload, str) else ""
    ws: list[dict] = []
    if not raw.strip():
        return _result(False, True, [w("QR_EMPTY", "block", "The QR code is empty.", "QR குறியீடு காலியாக உள்ளது.")])
    if len(raw) > MAX_LEN or CTRL_RE.search(raw):
        return _result(False, True, [w("QR_MALFORMED", "block", "The QR code data is malformed or too long.",
                                       "QR தரவு தவறானது அல்லது மிக நீளமானது.")])
    text = raw.strip()
    low = text.lower()

    if low.startswith(("javascript:", "data:", "file:", "vbscript:", "intent:", "blob:")):
        return _result(False, True, [w("QR_DANGEROUS_SCHEME", "block", "This QR code contains a dangerous link type.",
                                       "இந்த QR குறியீட்டில் ஆபத்தான இணைப்பு உள்ளது.")], kind="link")
    if low.startswith(("http://", "https://", "www.")):
        host = urlsplit(text if "://" in text else "http://" + text).hostname or ""
        why = "shortened link" if any(host.endswith(x) for x in SHORTENERS) else "web link"
        return _result(False, True, [w("QR_URL_NOT_PAYMENT", "block",
                                       f"This QR code is a {why}, not a payment code. It was blocked.",
                                       "இது பணம் செலுத்தும் QR அல்ல, இணைப்பு. தடுக்கப்பட்டது.")], kind="link")

    params: dict[str, str] = {}
    if low.startswith("upi://"):
        parts = urlsplit(text)
        if parts.netloc.lower() != "pay":
            return _result(False, True, [w("QR_UPI_NOT_PAY", "block", "This UPI code is not a pay request.",
                                           "இது பணம் செலுத்தும் UPI குறியீடு அல்ல.")], kind="upi")
        pairs = parse_qsl(parts.query, keep_blank_values=True)
        seen: set[str] = set()
        for k, v in pairs:
            k = k.lower()
            if k in seen and k in ("pa", "am", "cu"):
                return _result(False, True, [w("QR_DUPLICATE_FIELD", "block",
                                               "The QR code repeats a payment field, which is unsafe.",
                                               "QR குறியீடு ஒரே புலத்தை மீண்டும் கொண்டுள்ளது, பாதுகாப்பற்றது.")], kind="upi")
            seen.add(k)
            params[k] = unquote(v).strip()
        kind = "upi"
    elif VPA_RE.match(text):
        params = {"pa": text}
        kind = "vpa"
    else:
        return _result(False, True, [w("QR_UNRECOGNISED", "block", "This QR code is not a payment code.",
                                       "இது பணம் செலுத்தும் QR குறியீடு அல்ல.")])

    extra = sorted(k for k in params if k not in ALLOWED_PARAMS)
    if extra:
        ws.append(w("QR_UNEXPECTED_FIELDS", "warn", "The QR code has unexpected extra fields.",
                    "QR குறியீட்டில் எதிர்பாராத கூடுதல் புலங்கள் உள்ளன."))
    for k in ("url", "refurl"):
        if params.get(k):
            host = urlsplit(params[k]).hostname or ""
            if any(host.endswith(x) for x in SHORTENERS):
                return _result(False, True, [w("QR_SHORTENED_LINK", "block", "The QR code hides a shortened link.",
                                               "QR குறியீட்டில் மறைக்கப்பட்ட இணைப்பு உள்ளது.")], kind=kind)
            ws.append(w("QR_HAS_LINK", "warn", "The QR code carries a web link. Ignore it and check the payee.",
                        "QR குறியீட்டில் இணைய இணைப்பு உள்ளது. பெறுநரை சரிபார்க்கவும்."))
    vpa = params.get("pa", "")
    if not VPA_RE.match(vpa):
        return _result(False, True, [w("QR_BAD_VPA", "block", "The payee UPI ID in the QR code is invalid.",
                                       "QR குறியீட்டில் உள்ள பெறுநர் UPI ஐடி தவறானது.")], kind=kind)
    if not vpa.isascii():
        return _result(False, True, [w("QR_LOOKALIKE", "block", "The payee ID uses look-alike characters.",
                                       "பெறுநர் ஐடியில் ஒத்த தோற்றமுடைய எழுத்துகள் உள்ளன.")], kind=kind)
    cu = params.get("cu")
    if cu and cu.upper() != "INR":
        return _result(False, True, [w("QR_BAD_CURRENCY", "block", "Only rupee (INR) payments are supported.",
                                       "ரூபாய் (INR) மட்டுமே ஆதரிக்கப்படுகிறது.")], kind=kind)

    amount = None
    if params.get("am"):
        amount = valid_amount(params["am"])
        if amount is None:
            return _result(False, True, [w("QR_BAD_AMOUNT", "block", "The amount in the QR code is not valid.",
                                           "QR குறியீட்டில் உள்ள தொகை சரியில்லை.")], kind=kind)
    name = params.get("pn", "").strip()[:60]
    note = params.get("tn", "").strip()[:80]
    payee = {"vpa": vpa.lower(), "name": name or None, "amount": amount, "note": note or None,
             "merchant_code": params.get("mc") or None}

    contact = None
    for c in contacts:
        if (c.get("upi_id") or "").lower() == vpa.lower():
            contact = c
            break
    res = _result(True, False, ws, payee, kind)
    if contact:
        res.update(known=True, verified=bool(contact.get("verified")), contact=contact)
        if name and norm_name(name).split()[:1] != norm_name(contact["name"]).split()[:1] and norm_name(name) not in norm_name(contact["name"]):
            ws.append(w("QR_NAME_MISMATCH", "warn",
                        f"The QR name '{name}' differs from your saved contact '{contact['name']}'.",
                        f"QR பெயர் '{name}' உங்கள் தொடர்பு '{contact['name']}' உடன் பொருந்தவில்லை."))
    else:
        ws.append(w("QR_UNKNOWN_PAYEE", "warn", "This payee is not in your contacts. Check the name carefully.",
                    "இந்த பெறுநர் உங்கள் தொடர்புகளில் இல்லை. பெயரை கவனமாக பார்க்கவும்."))
    if not name:
        ws.append(w("QR_NO_NAME", "warn", "The QR code has no payee name.", "QR குறியீட்டில் பெறுநர் பெயர் இல்லை."))
    return res
