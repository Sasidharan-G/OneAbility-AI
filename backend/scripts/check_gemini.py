"""Verify your Gemini key works. Run from the backend folder:  python -m scripts.check_gemini"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.gemini import ask_gemini  # noqa: E402

SAMPLES = ["Kumar-ku 500 rooba anuppu", "balance evlo irukku", "எனக்கு உதவி வேண்டும்", "hmm can you tell me a joke"]


async def main() -> int:
    s = get_settings()
    if not s.gemini_enabled:
        print("GEMINI_API_KEY is not set in backend/.env. The app still works with the local parser.")
        return 1
    print(f"Model: {s.gemini_model}")
    bad = 0
    for text in SAMPLES:
        res, status = await ask_gemini(text, "Sasi", "tanglish", ["Kumar", "Priya Sharma"], s)
        print(f"- {text!r}\n    status={status} result={res}")
        bad += status != "ok"
    print("\nAll good." if not bad else f"\n{bad} call(s) failed. Check the key, model name and internet access.")
    return int(bool(bad))


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
