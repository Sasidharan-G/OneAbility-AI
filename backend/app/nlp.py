"""Deterministic Tamil / English / Tanglish intent + field parser.

This is both the offline fallback for Gemini (PRD 16) and the deterministic
validator for anything the model returns. A line-for-line JS port lives in
frontend/js/nlp.js; both are exercised by frontend/shared/nlp_cases.json.
"""
from __future__ import annotations

import difflib
import json
import re
from pathlib import Path
from typing import Any, Optional

LEXICON_PATH = Path(__file__).resolve().parents[2] / "frontend" / "shared" / "lexicon.json"
LEX: dict[str, Any] = json.loads(LEXICON_PATH.read_text(encoding="utf-8"))

CURRENCY = set(LEX["currency"])
PAY_VERBS = set(LEX["pay_verbs"])
FILLERS = set(LEX["fillers"])
YES = set(LEX["yes_words"])
NO = set(LEX["no_words"])
SECRET = set(LEX["secret_words"])
BALANCE = set(LEX["balance_words"])
HISTORY = set(LEX["history_words"])
RECHARGE = set(LEX["recharge_words"])
QR = set(LEX["qr_words"])
HELP = set(LEX["help_words"])
INSIGHT = set(LEX["insight_words"])
NAV = {k: set(v) for k, v in LEX["nav_words"].items()}
AMBIG_UNITS = set(LEX["ambiguous_units"])
NUMBER_WORDS: dict[str, int] = LEX["number_words"]
HUNDRED = set(LEX["hundred_words"])
THOUSAND = set(LEX["thousand_words"])
LAKH = set(LEX["lakh_words"])
NUM_SKIP = set(LEX["number_skip"])
SUFFIXES = sorted(LEX["name_suffixes"], key=len, reverse=True)
TANGLISH = set(LEX["tanglish_markers"])
TR = LEX["tamil_translit"]

TAMIL_RE = re.compile(r"[஀-௿]")
TAMIL_DIGITS = {ord(c): str(i) for i, c in enumerate("௦௧௨௩௪௫௬௭௮௯")}
UPI_RE = re.compile(r"[a-z0-9.\-_]{2,}@[a-z][a-z0-9]{1,}")
PHONE_RE = re.compile(r"(?<!\d)[6-9]\d{9}(?!\d)")


def _norm_token(p: str) -> str:
    p = re.sub(r"(?<=\d),(?=\d{3})", "", p)  # 1,500 -> 1500
    p = re.sub(r"(\d)([^\d.])", r"\1 \2", p)
    p = re.sub(r"([^\d.])(\d)", r"\1 \2", p)
    p = re.sub(r"(?<!\d)\.", " ", p)
    p = re.sub(r"\.(?!\d)", " ", p)
    p = re.sub(r"[,;:!?\"'()\[\]{}/\\|<>~`*]", " ", p)
    p = p.replace("-", " ").replace("_", " ")
    return p


def normalize(text: str) -> str:
    t = (text or "").lower().translate(TAMIL_DIGITS).replace("₹", " rs ")
    out = []
    for p in t.split():
        if "@" in p:
            out.append(p.strip(",;:!?.\"'()"))
        else:
            out.append(_norm_token(p))
    return " ".join(" ".join(out).split())


def tokenize(text: str) -> list[str]:
    n = normalize(text)
    return n.split(" ") if n else []


def detect_language(text: str) -> str:
    if TAMIL_RE.search(text or ""):
        return "ta"
    return "tanglish" if set(tokenize(text)) & TANGLISH else "en"


def transliterate(s: str) -> str:
    """Rough Tamil -> Latin, only used for fuzzy contact matching."""
    out: list[str] = []
    cons, vow, signs = TR["consonants"], TR["vowels"], TR["signs"]
    i = 0
    while i < len(s):
        ch = s[i]
        if ch in cons:
            base = cons[ch]
            nxt = s[i + 1] if i + 1 < len(s) else ""
            if nxt == "்":
                out.append(base)
                i += 2
                continue
            if nxt in signs:
                out.append(base + signs[nxt])
                i += 2
                continue
            out.append(base + "a")
        elif ch in vow:
            out.append(vow[ch])
        elif ch == "்" or ch in signs:
            pass
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def norm_name(s: str) -> str:
    t = transliterate((s or "").lower())
    for a, b in (("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"), ("ae", "e"),
                 ("oa", "o"), ("th", "t"), ("dh", "d"), ("z", "l"), ("w", "v")):
        t = t.replace(a, b)
    t = re.sub(r"[^a-z0-9 ]", "", t)
    t = re.sub(r"(.)\1+", r"\1", t)
    return t.strip()


def strip_suffix(tok: str) -> str:
    for suf in SUFFIXES:
        if tok.endswith(suf) and len(tok) - len(suf) >= 2:
            base = tok[: -len(suf)]
            if suf.startswith("ு") and base[-1] in TR["consonants"]:
                base += "்"  # குமார் + உக்கு -> restore the pulli
            return base
    return tok


def _num_run(tokens: list[str], start: int) -> tuple[Optional[int], int]:
    """Parse a run of number words from start. Returns (value, next_index)."""
    total, cur, i, used = 0, 0, start, 0
    while i < len(tokens):
        w = tokens[i]
        if w in NUM_SKIP and used:
            i += 1
            continue
        if w in NUMBER_WORDS:
            cur += NUMBER_WORDS[w]
        elif w in HUNDRED:
            cur = (cur or 1) * 100
        elif w in THOUSAND:
            total += (cur or 1) * 1000
            cur = 0
        elif w in LAKH:
            total += (cur or 1) * 100000
            cur = 0
        else:
            break
        used += 1
        i += 1
    if not used:
        return None, start
    while i > start and tokens[i - 1] in NUM_SKIP:
        i -= 1
    return total + cur, i


def extract_amount(tokens: list[str]) -> tuple[Optional[float], set[int], bool]:
    """Return (amount, consumed_token_indexes, multiple_distinct_amounts)."""
    consumed: set[int] = set()
    cands: list[float] = []
    for i, t in enumerate(tokens):
        if re.fullmatch(r"\d+(\.\d+)?", t):
            if "." not in t and len(t) >= 8:  # phone / account-like number, not an amount
                continue
            cands.append(float(t))
            consumed.add(i)
    if not cands:
        i = 0
        while i < len(tokens):
            val, nxt = _num_run(tokens, i)
            if val is not None and nxt > i:
                run = tokens[i:nxt]
                only_ambig = all(w in AMBIG_UNITS or w in NUM_SKIP for w in run)
                cur_next = nxt < len(tokens) and tokens[nxt] in CURRENCY
                if not only_ambig or cur_next:
                    cands.append(float(val))
                    consumed.update(range(i, nxt))
                i = nxt
            else:
                i += 1
    distinct = sorted(set(cands))
    if len(distinct) > 1:
        return None, consumed, True
    return (distinct[0] if distinct else None), consumed, False


def _amount_out(a: Optional[float]) -> Optional[float | int]:
    if a is None:
        return None
    return int(a) if float(a).is_integer() else round(a, 2)


def resolve_contact(name_tokens: list[str], contacts: list[dict]) -> dict:
    """Match a spoken name against contacts. status: matched|ambiguous|unknown|none."""
    if not name_tokens:
        return {"status": "none", "contact": None, "candidates": []}
    if not contacts:
        return {"status": "unknown", "contact": None, "candidates": []}
    raw_phrase = norm_name(" ".join(name_tokens))
    stripped_phrase = norm_name(" ".join(strip_suffix(t) for t in name_tokens))
    variants = list(dict.fromkeys([raw_phrase, stripped_phrase]))
    q_tokens: set[str] = set()
    for v in variants:
        q_tokens.update(v.split())
    q_tokens.discard("")

    for v in variants:  # 1. exact full name
        exact = [c for c in contacts if norm_name(c["name"]) == v]
        if len(exact) == 1:
            return {"status": "matched", "contact": exact[0], "candidates": exact, "method": "exact"}
        if len(exact) > 1:
            return {"status": "ambiguous", "contact": None, "candidates": exact, "method": "exact"}
    hits = [c for c in contacts if q_tokens & set(norm_name(c["name"]).split())]  # 2. token overlap
    if len(hits) == 1:
        return {"status": "matched", "contact": hits[0], "candidates": hits, "method": "token"}
    if len(hits) > 1:
        return {"status": "ambiguous", "contact": None, "candidates": hits, "method": "token"}
    close = []  # 3. fuzzy
    for c in contacts:
        best = 0.0
        for ct in norm_name(c["name"]).split():
            for qt in q_tokens:
                best = max(best, difflib.SequenceMatcher(None, ct, qt).ratio())
        if best >= 0.8:
            close.append(c)
    if len(close) == 1:
        return {"status": "matched", "contact": close[0], "candidates": close, "method": "fuzzy"}
    if len(close) > 1:
        return {"status": "ambiguous", "contact": None, "candidates": close, "method": "fuzzy"}
    return {"status": "unknown", "contact": None, "candidates": []}


def parse_confirmation(text: str) -> str:
    toks = set(tokenize(text))
    y, n = bool(toks & YES), bool(toks & NO)
    if y and not n:
        return "yes"
    if n and not y:
        return "no"
    return "unclear"


def parse_utterance(text: str, contacts: Optional[list[dict]] = None) -> dict:
    contacts = contacts or []
    text = (text or "")[:500]
    tokens = tokenize(text)
    tset = set(tokens)
    out: dict[str, Any] = {
        "intent": "unknown", "language": detect_language(text), "amount": None,
        "recipient_raw": None, "recipient": None, "recipient_status": "none",
        "candidates": [], "upi_id": None, "phone": None, "query": None, "target": None,
        "missing": [], "notes": [], "confidence": 0.0, "source": "local",
    }
    if not tokens:
        out["notes"].append("empty")
        return out

    if tset & SECRET:  # SEC-01: never process credentials
        out.update(intent="secret_warning", confidence=1.0)
        return out

    amount, consumed, multi = extract_amount(tokens)
    joined = normalize(text)
    m = UPI_RE.search(joined)
    if m:
        out["upi_id"] = m.group(0)
    pm = PHONE_RE.search(joined)
    if pm:
        out["phone"] = pm.group(0)

    has_verb = bool(tset & PAY_VERBS)
    payish = has_verb or amount is not None or multi

    left_idx = [
        i for i, t in enumerate(tokens)
        if i not in consumed and t not in CURRENCY and t not in PAY_VERBS and t not in FILLERS
        and t not in YES and t not in NO and not re.fullmatch(r"[\d.]+", t) and not UPI_RE.fullmatch(t)
    ]
    name_tokens = [tokens[i] for i in left_idx][:3]

    if len(tokens) <= 3 and not payish:
        c = parse_confirmation(text)
        if c == "yes":
            out.update(intent="confirm_yes", confidence=0.95)
            return out
        if c == "no":
            out.update(intent="confirm_no", confidence=0.95)
            return out

    if tset & RECHARGE and not (tset & HISTORY):
        out.update(intent="bill_recharge", amount=_amount_out(amount), confidence=0.85)
        return out

    if payish and not (tset & BALANCE and not has_verb) and not (tset & HISTORY and not has_verb):
        out["intent"] = "payment_request"
        out["amount"] = _amount_out(amount)
        if multi:
            out["notes"].append("multiple_amounts")
        pool = [t for t in name_tokens if not (out["phone"] and out["phone"] in t)]
        out["recipient_raw"] = " ".join(strip_suffix(t) for t in pool) or None
        res = resolve_contact(pool, contacts)
        out["recipient_status"] = res["status"]
        out["candidates"] = [c["name"] for c in res["candidates"]]
        if res["contact"]:
            out["recipient"] = res["contact"]["name"]
        if out["amount"] is None:
            out["missing"].append("amount")
        if not (out["recipient"] or out["recipient_raw"] or out["upi_id"] or out["phone"]):
            out["missing"].append("recipient")
        out["confidence"] = 0.9 if not out["missing"] and res["status"] == "matched" else 0.6
        return out

    if tset & INSIGHT:
        out.update(intent="insights", confidence=0.85)
        return out
    if tset & BALANCE:
        out.update(intent="balance_check", confidence=0.9)
        return out
    if tset & HISTORY:
        q = " ".join(strip_suffix(t) for t in name_tokens if t not in HISTORY) or None
        out.update(intent="transaction_history", query=q, confidence=0.85)
        return out
    if tset & QR:
        out.update(intent="scan_qr_help", confidence=0.9)
        return out
    for target, words in NAV.items():
        if tset & words:
            out.update(intent="navigate", target=target, confidence=0.85)
            return out
    if tset & HELP:
        out.update(intent="help", confidence=0.85)
        return out
    out["notes"].append("no_intent")
    return out
