# PRD coverage and verification

Source: `OneAbility_AI_PRD_System_Architecture_Tech_Stack.pdf`. Every requirement below is implemented and
covered by an automated test unless marked *manual*.

## Functional scope (PRD section 6)

| ID | Feature | Where | Verified by |
|---|---|---|---|
| F01 | Voice payment | `js/dex.js`, `js/nlp.js`, `backend/app/nlp.py`, `screens/flow.js` | `nlp.test.mjs`, `test_nlp.py`, e2e "Kumar-ku 500 rooba anuppu" |
| F02 | Voice navigation | intents home, back, history, balance, settings, contacts, scan, bills, insights, help | shared parser vectors, e2e insights steps |
| F03 | Audio feedback | `js/a11y.js` `speak` / `say` (speechSynthesis) | e2e captions step; *manual* audio check |
| F04 | Voice-guided QR scanner | `js/qr.js`, `screens/scan.js` | e2e image QR, live-stream QR decode, malicious QR, camera fallback |
| F05 | Strict confirmation gate | `js/payment.js` `decide`, `screens/flow.js` | `payment.test.mjs`, `test_api_flow.py`, e2e |
| F06 | Haptic feedback | `a11y.haptic` plus visual `flash` (never vibration alone) | *manual* on a phone; flash covered by e2e |
| F07 | Screen reader support | semantic HTML, live regions, focus management | axe on every screen, e2e focus and Tab order |
| F08 | Balance and history | `screens/home.js`, `screens/history.js` | e2e history, search, receipt |
| F09 | Bank linking demo (6 steps) | `screens/banks.js` | e2e bank linking, masked storage check |
| F10 | Secure authorization | `js/auth.js` (WebAuthn, labelled demo fallback) | e2e virtual authenticator: success, reuse, failure, balance protection |
| F11 | Beneficiary management | `screens/people.js`, `screens/pay.js` | e2e add, duplicate, delete, quick pay |
| F12 | Bills and recharge | `screens/bills.js` | e2e bill validation and review |
| F13 | Accessible settings | `screens/settings.js` | e2e persistence across reload |
| F14 | Receipts | `screens/history.js` (read, share, copy, download) | e2e receipt |
| F15 | PWA / offline shell | `sw.js`, `manifest.webmanifest` | e2e real offline run, manifest, `imports.test.mjs` precache audit |
| F16 | Fraud and safety guards | `backend/app/safety.py`, `js/guards.js`, `qr.py` | 100+ unit tests, e2e guards |
| (21) | Monthly expense insights | `js/insights.js`, `screens/insights.js` | `insights.test.mjs`, e2e |

## Accessibility (PRD section 9)

| ID | Implementation |
|---|---|
| A11Y-01 | Semantic landmarks, labelled controls, native elements first |
| A11Y-02 | `role=status` and `role=alert` live regions; Dex text is announced when speech is off |
| A11Y-03 | Everything reachable by keyboard; Escape cancels on the confirm screen; M toggles the mic |
| A11Y-04 | 48 px minimum targets, 64 px primary buttons |
| A11Y-05 | High-contrast mode (light and dark), strong focus rings |
| A11Y-06 | Four persistent text sizes (100 to 175%), rem-based, no clipping at 320 px (e2e) |
| A11Y-07 | Caption bar shows everything Dex says, for every speech event |
| A11Y-08 | Vibration plus a screen flash; vibration is never the only channel |
| A11Y-09 | Every critical step works by voice, touch or keyboard |
| A11Y-10 | Simple mode, plain wording, one decision per screen, payment steps hide the tab bar |
| A11Y-11 | English and Tamil UI; Tamil, English, Tanglish input |
| A11Y-12 | 320 px phones to desktop; two columns from 768 px |

## Security (PRD section 11)

| ID | Control | Evidence |
|---|---|---|
| SEC-01 | No PIN anywhere | No PIN field exists. Secret words are refused locally and never sent to Gemini. API models forbid extra fields. Storage is scrubbed of secret-like keys. Tests: `test_credentials_are_rejected_at_the_door`, `test_secret_utterance_never_reaches_model`, `payment.test.mjs` storage test, e2e |
| SEC-02 | No OTP | Bank linking simulates verification with no OTP field. Same rejection tests |
| SEC-03 | Mock execution | Transaction ids are `MOCK-...`; every payment screen and receipt says simulation |
| SEC-04 | Explicit confirmation | Yes only moves to authorization; voice intent never pays. `payment.test.mjs` |
| SEC-05 | Authorization | WebAuthn or labelled demo; the demo never claims biometrics. e2e |
| SEC-06 | Duplicate protection | Processing lock plus idempotent server flow plus duplicate warning. Concurrent-execute test |
| SEC-07 | Receiver warning | Ambiguous (blocked), unknown, unverified, QR name mismatch |
| SEC-08 | QR safety | Allow-listed UPI fields; links, dangerous schemes, shorteners, duplicate fields, look-alikes, bad currency or amount blocked |
| SEC-09 | Amount validation | Rejects zero, negative, NaN, infinity, more than 2 decimals; high-amount warning; hard limit; balance check |
| SEC-10 | Secrets | Gemini key only in `backend/.env`; `/health` never returns it; CSP `connect-src 'self'` |
| SEC-11 | Audit hygiene | Server logs only error class names, never content |
| SEC-12 | Emergency stop | Persistent Stop button and Escape cancel any unfinished flow and return home. e2e |

Also enforced: strict CSP (no inline script or style), `nosniff`, `no-referrer`, permissions policy, per-client rate limit on AI routes.

## Acceptance criteria (PRD section 19)

| Criterion | Test |
|---|---|
| Recipient and amount extracted for predefined voice cases | 66 shared vectors (55 parse, 11 confirmation) run on both Python and JS |
| Read-back shows receiver, identifier, amount before execution | e2e review checks |
| Yes/No handled; cancel leaves no debit | `payment.test.mjs`, e2e "cancel leaves no debit" |
| Keyboard and screen-reader navigable | e2e focus and Tab order; axe on all screens |
| Deaf users understand critical states without audio | captions plus flash plus visual warnings |
| High contrast and large text persist and do not break layout | e2e persistence, 320 px overflow check |
| Suspicious QR, wrong receiver, duplicate, high amount warn | unit and e2e |
| Successful payment updates history and balance exactly once | `payment.test.mjs`, e2e (24,500 after one payment) |
| No real PIN in storage, payloads, logs, AI requests | tests listed under SEC-01 |
| Demo completes without crash | e2e run, zero console errors |

## PRD Appendix B checklist

- **FastAPI routes:** `/health`, `/api/assistant/chat`, `/api/qr/verify`, `/api/voice/parse-payment`, `/api/voice/confirm-payment`, plus `/api/payment/validate|confirm`, `/api/auth/challenge`, `/api/health`.
- **Node `server.js` role:** static file server and reverse proxy for `/api` and `/health` only. No orchestration, no keys.
- **Gemini model:** `gemini-2.5-flash` by default, set by `GEMINI_MODEL`. Not exercised in automated tests without a key; the client is tested against a mocked HTTP transport (success, garbage output, HTTP error, secret masking).
- **gTTS:** not used. Speech output is browser `speechSynthesis`.
- **Fraud checks active:** invalid amount, limit, high amount, insufficient balance, missing / ambiguous / unknown / unverified receiver, invalid UPI ID, duplicate recent payment, and the QR checks above. All are real rules, not hooks.
- **Regression tests re-run on this code:** backend 161 passed; frontend 132 passed; browser 59 steps passed.
- **Final accessibility review:** automated axe audit passed on every screen. *Manual review with NVDA / TalkBack / VoiceOver, real switch or eye-tracking devices, and real vibration hardware is still to be done by a person* and is the honest gap between "techniques implemented" and any conformance claim.
- **Simulation boundary:** a persistent banner, "MOCK-" ids, and explicit wording appear on every payment, review, authorization, result and receipt screen.
