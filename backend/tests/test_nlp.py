import json
from pathlib import Path

import pytest

from app.nlp import parse_confirmation, parse_utterance

DATA = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "shared" / "nlp_cases.json").read_text(encoding="utf-8"))
CONTACTS = DATA["contacts"]


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["text"] or "<empty>" for c in DATA["cases"]])
def test_parse_cases(case):
    got = parse_utterance(case["text"], CONTACTS)
    for key, want in case["expect"].items():
        if key == "missing":
            assert sorted(got["missing"]) == sorted(want), (case["text"], got)
        elif key == "query":
            assert (got["query"] or "").lower() == want, (case["text"], got)
        else:
            assert got[key] == want, (case["text"], key, got)


@pytest.mark.parametrize("c", DATA["confirmations"], ids=[c["text"] for c in DATA["confirmations"]])
def test_confirmation(c):
    assert parse_confirmation(c["text"]) == c["expect"]


def test_ai_never_sees_secret_only_local_warning():
    got = parse_utterance("pin 4321", CONTACTS)
    assert got["intent"] == "secret_warning" and got["amount"] is None


def test_lone_word_one_is_not_an_amount():
    got = parse_utterance("send money to one person", CONTACTS)
    assert got["amount"] is None and "amount" in got["missing"]


def test_phone_number_is_not_amount():
    got = parse_utterance("pay 9876543210", CONTACTS)
    assert got["amount"] is None and got["phone"] == "9876543210"
