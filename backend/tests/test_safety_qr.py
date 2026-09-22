import time

import pytest

from app.config import Settings
from app.qr import verify_qr
from app.safety import check_payment, contains_secret_keys, valid_amount

S = Settings()
CONTACTS = [{"name": "Kumar", "upi_id": "kumar@okbank", "verified": True}]


def codes(res):
    return {w["code"] for w in res["warnings"]}


def draft(**kw):
    d = {"recipient_name": "Kumar", "upi_id": "kumar@okbank", "amount": 500, "known": True, "verified": True}
    d.update(kw)
    return d


@pytest.mark.parametrize("bad", [0, -5, "abc", None, float("nan"), float("inf"), True, 10.123, ""])
def test_invalid_amounts_blocked(bad):
    r = check_payment(draft(amount=bad), settings=S)
    assert r["blocked"] and "INVALID_AMOUNT" in codes(r)


def test_clean_payment_passes():
    r = check_payment(draft(), settings=S)
    assert not r["blocked"] and not r["needs_ack"] and r["warnings"] == []


def test_high_amount_warns_and_limit_blocks():
    assert "HIGH_AMOUNT" in codes(check_payment(draft(amount=6000), settings=S))
    r = check_payment(draft(amount=100001), settings=S)
    assert r["blocked"] and "LIMIT_EXCEEDED" in codes(r)


def test_insufficient_balance_blocks():
    r = check_payment(draft(amount=900), balance=500, settings=S)
    assert r["blocked"] and "INSUFFICIENT_BALANCE" in codes(r)


def test_unknown_and_unverified_receivers_warn():
    assert "UNKNOWN_RECEIVER" in codes(check_payment(draft(known=False, verified=False), settings=S))
    r = check_payment(draft(verified=False), settings=S)
    assert "UNVERIFIED_RECEIVER" in codes(r) and r["needs_ack"]


def test_ambiguous_and_missing_receiver_block():
    assert "AMBIGUOUS_RECEIVER" in codes(check_payment(draft(ambiguous_candidates=["Arun A", "Arun B"]), settings=S))
    assert "MISSING_RECEIVER" in codes(check_payment(draft(recipient_name=None, upi_id=None), settings=S))


def test_invalid_upi_id_blocked():
    assert "INVALID_UPI_ID" in codes(check_payment(draft(upi_id="not a vpa"), settings=S))


def test_duplicate_within_window_warns_but_old_one_does_not():
    now = time.time()
    recent = [{"recipient": "Kumar", "upi_id": "kumar@okbank", "amount": 500, "ts": (now - 30) * 1000, "status": "success"}]
    assert "DUPLICATE_RECENT" in codes(check_payment(draft(), recent, settings=S, now=now))
    old = [{**recent[0], "ts": (now - 3600) * 1000}]
    assert "DUPLICATE_RECENT" not in codes(check_payment(draft(), old, settings=S, now=now))
    failed = [{**recent[0], "status": "failed"}]
    assert "DUPLICATE_RECENT" not in codes(check_payment(draft(), failed, settings=S, now=now))


def test_qr_blocked_flag_blocks():
    assert check_payment(draft(qr_blocked=True), settings=S)["blocked"]


def test_valid_amount_helper():
    assert valid_amount("250.50") == 250.5 and valid_amount(1) == 1.0


def test_secret_key_scan():
    assert contains_secret_keys({"a": {"UPI_PIN": "1"}}) == "UPI_PIN"
    assert contains_secret_keys({"a": [{"ok": 1}]}) is None


# ------------------------------------------------------------------ QR
def test_valid_upi_qr():
    r = verify_qr("upi://pay?pa=kumar@okbank&pn=Kumar&am=250&cu=INR&tn=Lunch", CONTACTS)
    assert r["valid"] and not r["blocked"] and r["known"] and r["verified"]
    assert r["payee"] == {"vpa": "kumar@okbank", "name": "Kumar", "amount": 250.0, "note": "Lunch", "merchant_code": None}


def test_unknown_payee_warns():
    r = verify_qr("upi://pay?pa=shop@ybl&pn=Corner%20Shop", CONTACTS)
    assert r["valid"] and "QR_UNKNOWN_PAYEE" in codes(r) and not r["known"]


def test_plain_vpa_accepted():
    assert verify_qr("shop@ybl", [])["valid"]


@pytest.mark.parametrize("payload,code", [
    ("", "QR_EMPTY"),
    ("https://evil.example/pay", "QR_URL_NOT_PAYMENT"),
    ("http://bit.ly/abc", "QR_URL_NOT_PAYMENT"),
    ("javascript:alert(1)", "QR_DANGEROUS_SCHEME"),
    ("data:text/html,<script>", "QR_DANGEROUS_SCHEME"),
    ("upi://collect?pa=xy@ybl", "QR_UPI_NOT_PAY"),
    ("upi://pay?pa=a@ybl&pa=b@ybl", "QR_DUPLICATE_FIELD"),
    ("upi://pay?pa=bad vpa", "QR_BAD_VPA"),
    ("upi://pay?pa=xy@ybl&cu=USD", "QR_BAD_CURRENCY"),
    ("upi://pay?pa=xy@ybl&am=-5", "QR_BAD_AMOUNT"),
    ("upi://pay?pa=xy@ybl&am=0", "QR_BAD_AMOUNT"),
    ("just some text", "QR_UNRECOGNISED"),
    ("upi://pay?pa=xy@ybl&url=https://bit.ly/z", "QR_SHORTENED_LINK"),
    ("a" * 1500, "QR_MALFORMED"),
    ("upi://pay?pa=xy@ybl\x00", "QR_MALFORMED"),
])
def test_blocked_qr(payload, code):
    r = verify_qr(payload, [])
    assert r["blocked"] and not r["valid"] and code in codes(r)


def test_qr_name_mismatch_warns_for_known_vpa():
    r = verify_qr("upi://pay?pa=kumar@okbank&pn=Totally%20Different", CONTACTS)
    assert "QR_NAME_MISMATCH" in codes(r)


def test_extra_fields_and_link_warn():
    r = verify_qr("upi://pay?pa=xy@ybl&pn=X&evil=1&url=https://shop.example/", [])
    assert r["valid"] and {"QR_UNEXPECTED_FIELDS", "QR_HAS_LINK"} <= codes(r)


# ---- shared vectors (same file the JS suite uses) keep both implementations honest
import json
from pathlib import Path

_QR = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "shared" / "qr_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("c", _QR["blocked"], ids=[c["payload"][:30] or "<empty>" for c in _QR["blocked"]])
def test_shared_blocked_vectors(c):
    r = verify_qr(c["payload"], _QR["contacts"])
    assert r["blocked"] and c["code"] in codes(r)


@pytest.mark.parametrize("c", _QR["valid"], ids=[c["payload"][:30] for c in _QR["valid"]])
def test_shared_valid_vectors(c):
    r = verify_qr(c["payload"], _QR["contacts"])
    assert r["valid"] and r["known"] == c["known"] and r["payee"]["amount"] == c["amount"]
    assert sorted(codes(r)) == sorted(c["warn"])
