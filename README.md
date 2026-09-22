# OneAbility AI

**One Platform. Every Ability. Independent Access.**

An accessibility-first, *simulated* digital payment assistant (college mini-project). Users pay by voice
(Tamil, English, Tanglish), QR scan, contact, UPI ID or bill screen, with explicit read-back and Yes/No
confirmation, safety checks, and WebAuthn or clearly labelled demo authorization.

> **Simulation only.** No real money moves. The app never collects, stores, transmits or speaks a UPI PIN,
> OTP or raw biometric data. Every payment screen says so.

Built from `OneAbility_AI_PRD_System_Architecture_Tech_Stack.pdf`. See [docs/PRD_COVERAGE.md](docs/PRD_COVERAGE.md)
for a line-by-line map from PRD requirements to code and tests.

---

## Quick start

Needs Python 3.10+ and (optionally) Node 20+.

```powershell
./run.ps1            # Windows: creates the venv, installs deps, starts http://localhost:8000
```
```bash
./run.sh             # macOS / Linux
```

Then open **http://localhost:8000** (use `localhost`, not `127.0.0.1`: browsers refuse WebAuthn on raw IP addresses).

Use **Chrome or Edge** for voice input (Web Speech API). Camera and WebAuthn need `localhost` or HTTPS.

### Optional: turn on Gemini

The app works fully without it, using the built-in deterministic Tamil / English / Tanglish parser.
To let Gemini help with unclear sentences:

1. Get a key at <https://aistudio.google.com/apikey>.
2. Put it in `backend/.env` as `GEMINI_API_KEY=...` (the key stays on the server, never in the browser).
3. Check it: `cd backend && .venv/Scripts/python -m scripts.check_gemini`

The default model is `gemini-2.5-flash` (change with `GEMINI_MODEL`).

### Optional: Node front server

`server.js` serves `/frontend` and proxies `/api` to FastAPI (PRD "Node.js server.js" role). It has no business logic.

```powershell
./run.ps1 -Node      # backend on :8000 (API only) + Node server on http://localhost:3000
```

---

## What it does

| Area | Features |
|---|---|
| Pay | Voice Pay with Dex, Scan & Pay, Pay Contact, Pay UPI ID, Bills & Recharge (mobile, power, water, DTH) |
| Safety | Read-back + Yes/No gate, ambiguous / unknown / unverified receiver, suspicious QR block, invalid / high / over-limit amount, insufficient balance, duplicate warning, processing lock (no double debit), emergency Stop |
| Authorization | WebAuthn platform authenticator (fingerprint / face / screen lock) or explicit demo fallback |
| Accounts | 6-step simulated bank linking, primary bank, masked numbers, balance by voice |
| People | Beneficiaries: add, edit, delete, favourite, quick pay, voice search |
| Records | History with search and filters, receipts (read aloud, share), monthly expense insights |
| Accessibility | Screen-reader semantics and live regions, captions for everything Dex says, haptics plus screen flash, keyboard-only use, dwell click, high contrast, four text sizes, simple mode, 320 px to desktop layouts |
| Languages | English and Tamil UI. Tamil, English and Tanglish voice input |
| PWA | Installable, app shell works offline, payments still simulate locally when the API is unreachable |

### Demo script (PRD section 23)

1. Open the app, complete the short welcome, note the settings.
2. On **Dex**, say or type: `Kumar-ku 500 rooba anuppu`.
3. Dex reads back receiver and amount; the same text is on screen and in the caption bar.
4. Say `aama` (or press **Yes, continue**).
5. Verify with your device, or press **Use demo authorization**.
6. See the success screen (visual flash, vibration, spoken result), then the receipt and history. The balance drops by exactly 500.
7. Try `send 200000 to Kumar` (blocked), `pay Arun 200` (Dex asks which Arun), a QR pointing to a web link (blocked), and `my pin is 1234` (refused).

---

## Architecture

```
Browser (vanilla HTML/CSS/ES modules, PWA)
 ├─ UI screens ─ router ─ i18n (en/ta)
 ├─ Interaction: Web Speech (STT/TTS), Vibration, captions, dwell click, jsQR camera
 ├─ Dex (intent + slot filling)  ──►  local parser (nlp.js)  ─┐  same lexicon + test vectors
 │                               └─►  /api/assistant/chat ────┼─► FastAPI ─► Gemini (optional, untrusted output)
 ├─ Payment engine (state machine, guards, lock)               │           └► deterministic parser (nlp.py)
 │     draft → confirm → authorize → processing → success      │
 ├─ localStorage: profile, settings, banks, contacts, history  │
 └─ Service worker: app-shell cache                            ┘
FastAPI: /health, /api/assistant/chat, /api/qr/verify, /api/voice/parse-payment,
         /api/voice/confirm-payment, /api/payment/validate|confirm, /api/auth/challenge
```

**Design rule: AI interprets, deterministic code decides.** Gemini only proposes an intent and fields. Its
output is schema-checked, re-parsed, and can never confirm, authorize or execute anything. Guards, the Yes/No
gate, authorization and the debit run in plain code that is unit tested on both client and server.

Parser, guards and QR verifier exist in **both** Python and JavaScript so safety holds offline. They are
checked against the same JSON test vectors in `frontend/shared/`, so they cannot drift apart.

### API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health, and whether Gemini is configured (never the key) |
| `POST /api/assistant/chat` | Intent understanding (local parser plus optional Gemini) |
| `POST /api/voice/parse-payment` | Parse, run guards, open a server flow |
| `POST /api/voice/confirm-payment` | Yes/No with authorization, idempotent (lock) |
| `POST /api/payment/validate`, `/api/payment/confirm` | Same flow for manual payments |
| `POST /api/qr/verify` | QR payload verification |
| `GET /api/auth/challenge` | Random WebAuthn challenge |
| `GET /api/docs` | Interactive OpenAPI docs |

Requests use strict schemas: any extra field such as `pin`, `otp` or `biometric` is rejected with HTTP 422.

### Project layout

```
backend/app/      nlp.py  safety.py  qr.py  gemini.py  flows.py  main.py  config.py
backend/tests/    pytest suite (parser, guards, QR, API, flows, Gemini client with mocked HTTP)
frontend/js/      app.js router, store, payment engine, dex, nlp, guards, a11y, voice, auth, qr, i18n, ui
frontend/js/screens/   one module per screen
frontend/shared/  lexicon.json + test vectors used by Python and JS
frontend/tests/   node unit tests + e2e/ (real Chrome, axe accessibility audit)
server.js         optional Node static server + API proxy
tools/            icon generator
```

---

## Tests

```powershell
cd backend; .venv/Scripts/python -m pytest -q      # 161 backend tests
npm test                                            # 132 frontend unit tests
npm run e2e                                         # 59 browser steps (needs the server running on :8000)
```

The e2e suite drives real Chrome: onboarding, voice payments, every safety guard, QR from image and from a
live video stream, WebAuthn with a virtual authenticator, a real offline run (Node server killed), settings
persistence, 320 px overflow checks at 175% text, and an **axe-core WCAG 2.2 AA audit of every screen** in
light, dark, high-contrast and Tamil.

Set `CHROME_PATH` if Chrome is not in a standard location.

---

## Configuration (`backend/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | empty | Enables Gemini. Optional |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model name |
| `HIGH_AMOUNT_THRESHOLD` | 5000 | Rupees at or above which a warning is shown |
| `TXN_LIMIT` | 100000 | Per-payment hard limit |
| `DUPLICATE_WINDOW_SECONDS` | 120 | Same receiver and amount inside this window warns |
| `SERVE_FRONTEND` | 1 | Set 0 when Node serves the frontend |

---

## Accessibility statement

The app implements the techniques listed in PRD section 9, and every screen passes an automated axe-core
audit for WCAG 2.0/2.1/2.2 A and AA rules in the e2e suite. Automated checks cover only part of WCAG, so this
project **does not claim** formal WCAG AAA (or any) conformance. That needs a manual audit with real assistive
technology on target devices (see docs/PRD_COVERAGE.md).

## Known limits (by design, per the PRD)

- Simulation only: no real UPI settlement, KYC, OTP, bank discovery or cloud database. Data lives in `localStorage`.
- Voice input needs Chrome or Edge and internet (browser speech service). Typing always works.
- Speech output uses the browser's `speechSynthesis`. Gemini Tamil TTS and gTTS are not implemented.
- WebAuthn needs `localhost` or HTTPS and a device with a screen lock, fingerprint or face. Otherwise use the labelled demo authorization.
- The server-side flow store is in memory (single process, demo scale).

## Path to production (PRD 21.1)

Real authentication and onboarding, authorized PSP integration, a secured backend data layer, provider-compliant
authorization, formal accessibility conformance testing, observability, fraud monitoring and regulatory compliance.
