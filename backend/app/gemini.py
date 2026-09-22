"""Gemini intent-understanding client (PRD 10). Gemini interprets; it never executes.

Output is treated as untrusted: it is schema-checked here and every field is
re-validated by the deterministic parser/guards before use.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

import httpx

from .config import Settings, get_settings
from .nlp import SECRET, parse_utterance, tokenize
from .safety import valid_amount

log = logging.getLogger("oneability.gemini")

INTENTS = {"payment_request", "balance_check", "transaction_history", "scan_qr_help", "navigate",
           "bill_recharge", "insights", "help", "confirm_yes", "confirm_no", "unknown"}
TARGETS = {"home", "back", "settings", "beneficiaries"}
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

SYSTEM = (
    "You are Dex, the voice assistant of OneAbility AI, an accessibility-first SIMULATED payment demo. "
    "Users speak Tamil, English or Tanglish (Tamil written in English letters). "
    "Your ONLY job is to understand intent and extract safe fields. You never execute or approve payments, "
    "never ask for or repeat a PIN, OTP, password or biometric, and never claim money moved. "
    "Reply with a single JSON object with keys: "
    "intent (one of payment_request, balance_check, transaction_history, scan_qr_help, navigate, bill_recharge, insights (monthly spending summary), help, confirm_yes, confirm_no, unknown), "
    "amount (number in rupees or null), recipient (person name as spoken, or null), upi_id (or null), "
    "query (search text for history or null), target (home|back|settings|beneficiaries or null), "
    "reply (one short friendly sentence in the user's language, addressed to the user by name when given, that never states a payment happened). "
    "Example: 'Kumar-ku 500 rooba anuppu' -> intent payment_request, amount 500, recipient Kumar."
)


def mask_secrets(text: str) -> str:
    return re.sub(r"\b\d{4,8}\b", "[number]", text)


def sanitize_model_output(obj: Any) -> Optional[dict]:
    """Validate the untrusted model JSON into a safe dict, or None."""
    if not isinstance(obj, dict):
        return None
    intent = obj.get("intent")
    if intent not in INTENTS:
        return None
    amount = obj.get("amount")
    if isinstance(amount, str):
        try:
            amount = float(amount.replace(",", ""))
        except ValueError:
            amount = None
    amount = valid_amount(amount)
    if amount is not None and amount > 10_000_000:
        amount = None

    def s(v: Any, n: int) -> Optional[str]:
        return v.strip()[:n] if isinstance(v, str) and v.strip() else None

    target = obj.get("target") if obj.get("target") in TARGETS else None
    reply = s(obj.get("reply"), 300)
    if reply and re.search(r"\b(paid|sent|transferred|debited|payment (?:done|complete|successful))\b", reply, re.I):
        reply = None  # model must not claim a payment happened
    return {"intent": intent, "amount": amount, "recipient": s(obj.get("recipient"), 60),
            "upi_id": s(obj.get("upi_id"), 80), "query": s(obj.get("query"), 60),
            "target": target, "reply": reply}


async def ask_gemini(message: str, profile_name: Optional[str], language: Optional[str],
                     contact_names: list[str], settings: Optional[Settings] = None,
                     client: Optional[httpx.AsyncClient] = None) -> tuple[Optional[dict], str]:
    """Return (sanitized_result | None, status) where status in ok|disabled|skipped|error|invalid."""
    s = settings or get_settings()
    if not s.gemini_enabled:
        return None, "disabled"
    if set(tokenize(message)) & SECRET:
        return None, "skipped"  # SEC-01: never send anything credential-like to the model
    ctx = {"user_name": (profile_name or "")[:40], "preferred_language": language or "en",
           "known_contacts": [c[:40] for c in contact_names[:30]]}
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps({"context": ctx, "utterance": mask_secrets(message)[:500]},
                                                                     ensure_ascii=False)}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "maxOutputTokens": 400},
    }
    url = API.format(model=s.gemini_model)
    headers = {"x-goog-api-key": s.gemini_api_key, "content-type": "application/json"}
    own = client is None
    client = client or httpx.AsyncClient(timeout=s.gemini_timeout)
    try:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code != 200:
            log.warning("gemini http %s", r.status_code)
            return None, "error"
        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        obj = json.loads(text)
        clean = sanitize_model_output(obj)
        return (clean, "ok") if clean else (None, "invalid")
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as e:
        log.warning("gemini failure: %s", type(e).__name__)  # class only, never content
        return None, "error"
    finally:
        if own:
            await client.aclose()


def merge(local: dict, model: Optional[dict], contacts: list[dict]) -> dict:
    """Merge model output into the deterministic parse. Local facts win on conflict."""
    if not model:
        return local
    from .nlp import resolve_contact, strip_suffix

    out = dict(local)
    out["notes"] = list(local.get("notes", []))
    keep_local = local["intent"] in {"secret_warning", "confirm_yes", "confirm_no"} or local["confidence"] >= 0.85
    if not keep_local and model["intent"] != "unknown":
        out["intent"] = model["intent"]
        out["confidence"] = 0.7
    if out["intent"] == "payment_request":
        if local["amount"] is None and model["amount"] is not None:
            out["amount"] = model["amount"]
            out["notes"].append("amount_from_model")
        elif local["amount"] is not None and model["amount"] not in (None, local["amount"]):
            out["notes"].append("model_amount_mismatch")
        if local["recipient_status"] != "matched" and model["recipient"]:
            toks = [strip_suffix(t) for t in tokenize(model["recipient"])][:3]
            res = resolve_contact(toks, contacts)
            out["recipient_raw"] = " ".join(toks) or local["recipient_raw"]
            out["recipient_status"] = res["status"]
            out["candidates"] = [c["name"] for c in res["candidates"]]
            out["recipient"] = res["contact"]["name"] if res["contact"] else None
        if not out["upi_id"] and model["upi_id"]:
            out["upi_id"] = model["upi_id"].lower()
        out["missing"] = [m for m in ("amount", "recipient")
                          if (m == "amount" and out["amount"] is None)
                          or (m == "recipient" and not (out["recipient"] or out["recipient_raw"] or out["upi_id"] or out["phone"]))]
    if out["intent"] == "transaction_history" and not out["query"]:
        out["query"] = model["query"]
    if out["intent"] == "navigate" and not out["target"]:
        out["target"] = model["target"]
    out["reply"] = model["reply"]
    out["source"] = "gemini+local"
    return out
