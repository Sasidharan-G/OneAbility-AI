import asyncio
import json

import httpx
import pytest

from app import gemini as gem
from app.config import Settings
from app.flows import FlowError, FlowStore
from tests.conftest import CONTACTS

DEMO = {"method": "demo"}


def parse(client, text, **kw):
    body = {"message": text, "contacts": CONTACTS, **kw}
    return client.post("/api/voice/parse-payment", json=body)


def test_health_hides_key(client):
    j = client.get("/health").json()
    assert j["status"] == "ok" and j["simulated"] is True and "key" not in json.dumps(j).lower().replace("gemini", "")


def test_voice_payment_end_to_end_exactly_once(client):
    j = parse(client, "Kumar-ku 500 rooba anuppu").json()
    assert j["draft"]["recipient_name"] == "Kumar" and j["draft"]["amount"] == 500 and j["flow_state"] == "awaiting_confirmation"
    fid = j["flow_id"]
    r1 = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "decision": "yes", "auth": DEMO}).json()
    r2 = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "decision": "yes", "auth": DEMO}).json()
    assert r1["state"] == "executed" and r1["duplicate"] is False and r1["result"]["mock_txn_id"].startswith("MOCK-")
    assert r2["duplicate"] is True and r2["result"]["mock_txn_id"] == r1["result"]["mock_txn_id"]  # SEC-06


def test_cancel_leaves_no_transaction(client):
    fid = parse(client, "send 200 to Priya").json()["flow_id"]
    r = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "utterance": "illa venam"}).json()
    assert r["state"] == "cancelled" and r["result"] is None
    late = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "decision": "yes", "auth": DEMO})
    assert late.status_code == 409


def test_unclear_confirmation_changes_nothing(client):
    fid = parse(client, "send 200 to Priya").json()["flow_id"]
    r = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "utterance": "hmm maybe"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNCLEAR_CONFIRMATION"
    assert client.get(f"/api/payment/flow/{fid}").json()["state"] == "awaiting_confirmation"


def test_confirm_requires_authorization(client):
    fid = parse(client, "send 200 to Priya").json()["flow_id"]
    r = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "decision": "yes"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "AUTH_REQUIRED"


def test_warning_needs_acknowledgement(client):
    fid = parse(client, "send 300 to Ravi").json()["flow_id"]  # Ravi unverified
    r = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "decision": "yes", "auth": DEMO})
    assert r.status_code == 428
    ok = client.post("/api/voice/confirm-payment", json={"flow_id": fid, "decision": "yes", "auth": DEMO, "acknowledged": True})
    assert ok.json()["state"] == "executed"


def test_blocked_flow_cannot_execute(client):
    j = parse(client, "send 200000 to Kumar").json()
    assert j["flow_state"] == "blocked" and j["guard"]["blocked"]
    r = client.post("/api/voice/confirm-payment", json={"flow_id": j["flow_id"], "decision": "yes", "auth": DEMO})
    assert r.status_code == 409


def test_missing_amount_creates_no_flow(client):
    j = parse(client, "pay kumar").json()
    assert j["flow_id"] is None and j["parsed"]["missing"] == ["amount"]


def test_ambiguous_receiver_creates_no_flow(client):
    contacts = CONTACTS + [{"name": "Arun Prakash"}, {"name": "Arun Kumar"}]
    j = client.post("/api/voice/parse-payment", json={"message": "pay Arun 200", "contacts": contacts}).json()
    assert j["flow_id"] is None and j["guard"]["blocked"]


def test_insufficient_balance_blocks(client):
    j = parse(client, "send 900 to Kumar", balance=100).json()
    assert j["flow_state"] == "blocked"


def test_validate_endpoint_for_manual_flows(client):
    d = {"recipient_name": "Kumar", "upi_id": "kumar@okbank", "amount": 0, "method": "contact", "known": True, "verified": True}
    j = client.post("/api/payment/validate", json={"draft": d}).json()
    assert j["flow_state"] == "blocked" and j["guard"]["warnings"][0]["code"] == "INVALID_AMOUNT"


@pytest.mark.parametrize("path,body", [
    ("/api/voice/confirm-payment", {"flow_id": "flow_abcdef", "decision": "yes", "auth": {"method": "demo", "pin": "1234"}}),
    ("/api/voice/parse-payment", {"message": "hi", "otp": "123456"}),
    ("/api/payment/validate", {"draft": {"amount": 5, "upi_pin": "1"}}),
    ("/api/qr/verify", {"payload": "x", "biometric": "abc"}),
])
def test_credentials_are_rejected_at_the_door(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 422 and "PIN" in r.json()["error"]["message"]


def test_secret_utterance_never_reaches_model(client, monkeypatch):
    called = []

    async def spy(*a, **k):
        called.append(1)
        return None, "ok"
    monkeypatch.setattr(gem, "ask_gemini", spy)
    r = client.post("/api/assistant/chat", json={"message": "my pin is 4321"}).json()
    assert r["parsed"]["intent"] == "secret_warning" and not called


def test_chat_uses_local_parser_when_gemini_disabled(client):
    r = client.post("/api/assistant/chat", json={"message": "balance evlo irukku"}).json()
    assert r["parsed"]["intent"] == "balance_check" and r["gemini_status"] == "disabled" and r["source"] == "local"


def test_qr_route(client):
    j = client.post("/api/qr/verify", json={"payload": "upi://pay?pa=kumar@okbank&pn=Kumar", "contacts": CONTACTS}).json()
    assert j["valid"] and j["known"]
    bad = client.post("/api/qr/verify", json={"payload": "https://evil.example"}).json()
    assert bad["blocked"]


def test_challenge_and_unknown_api(client):
    assert len(client.get("/api/auth/challenge").json()["challenge"]) >= 40
    assert client.get("/api/nope").status_code == 404


def test_security_headers(client):
    h = client.get("/health").headers
    assert h["x-content-type-options"] == "nosniff" and "default-src 'self'" in h["content-security-policy"]


def test_frontend_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "OneAbility" in r.text


# -------------------------------------------------------------- flow store unit
def test_flow_expiry():
    s = Settings()
    store = FlowStore(Settings.__new__(Settings))
    store.settings = type("S", (), {"flow_ttl_s": -1})()
    f = store.create({"amount": 1}, {"blocked": False, "needs_ack": False, "warnings": []})
    with pytest.raises(FlowError) as e:
        store.decide(f["flow_id"], "yes", DEMO, False)
    assert e.value.status == 410


# -------------------------------------------------------------- gemini client
def _settings():
    class S:
        gemini_enabled = True
        gemini_api_key = "test-key"
        gemini_model = "gemini-2.5-flash"
        gemini_timeout = 2.0
    return S()


def _mock(payload, status=200):
    def handler(request: httpx.Request):
        assert request.headers["x-goog-api-key"] == "test-key"
        body = json.loads(request.content)
        sent = body["contents"][0]["parts"][0]["text"]
        assert "1234" not in sent  # digits masked before leaving the server
        return httpx.Response(status, json=payload)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _gemini_payload(obj):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]}


def test_gemini_success_and_sanitising():
    obj = {"intent": "payment_request", "amount": "1,500", "recipient": "Kumar", "reply": "Sure, Sasi!"}

    async def run():
        async with _mock(_gemini_payload(obj)) as c:
            return await gem.ask_gemini("Kumar ku 1500 anuppu code 1234", "Sasi", "tanglish", ["Kumar"], _settings(), c)
    res, status = asyncio.run(run())
    assert status == "ok" and res["amount"] == 1500.0 and res["recipient"] == "Kumar"


def test_gemini_reply_claiming_payment_is_dropped():
    assert gem.sanitize_model_output({"intent": "help", "reply": "I have sent 500 rupees!"})["reply"] is None


@pytest.mark.parametrize("bad", [{"intent": "drop_tables"}, "text", None, {"intent": "payment_request", "amount": -9}])
def test_gemini_garbage_is_rejected_or_neutralised(bad):
    out = gem.sanitize_model_output(bad)
    assert out is None or out["amount"] is None


def test_gemini_http_error_falls_back():
    async def run():
        async with _mock({}, 500) as c:
            return await gem.ask_gemini("balance", None, None, [], _settings(), c)
    assert asyncio.run(run()) == (None, "error")


def test_merge_keeps_local_amount_and_flags_mismatch():
    from app.nlp import parse_utterance
    local = parse_utterance("Kumar ku 500 anuppu", [{"name": "Kumar"}])
    merged = gem.merge(local, {"intent": "payment_request", "amount": 5000.0, "recipient": "Kumar", "upi_id": None,
                               "query": None, "target": None, "reply": "ok"}, [{"name": "Kumar"}])
    assert merged["amount"] == 500 and "model_amount_mismatch" in merged["notes"] and merged["source"] == "gemini+local"


def test_merge_model_fills_gap_for_unclear_local():
    from app.nlp import parse_utterance
    local = parse_utterance("hmm kumar ah paatha", [{"name": "Kumar"}])
    merged = gem.merge(local, {"intent": "balance_check", "amount": None, "recipient": None, "upi_id": None,
                               "query": None, "target": None, "reply": "Checking."}, [])
    assert merged["intent"] == "balance_check"
