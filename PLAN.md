# OneAbility AI — Executable Build Plan

Source: `OneAbility_AI_PRD_System_Architecture_Tech_Stack.pdf` (all 16 features F01–F16, A11Y-01..12, SEC-01..12, NFR-01..08).
Scope boundary (PRD §Critical Scope): simulated payments only. No real UPI PIN / OTP / raw biometrics anywhere.

## Stack (exactly as PRD §13)
| Area | Choice |
|---|---|
| Frontend | HTML5, vanilla CSS3, JS ES6 modules (no framework) |
| Backend | Python, FastAPI, Uvicorn |
| AI | Google Gemini (REST, key in backend `.env`), deterministic Tamil/English/Tanglish parser fallback |
| Speech | Web Speech API (STT) + `speechSynthesis` (TTS) |
| QR | Camera API + jsQR (vendored) |
| Auth | WebAuthn platform authenticator, labelled demo fallback |
| Haptics | Vibration API |
| Persistence | localStorage |
| Offline | PWA manifest + service worker |
| Local hosting | `server.js` (Node) serves frontend and proxies `/api` to FastAPI; FastAPI can also serve the frontend itself |

## Phases
1. **Scaffold** – folders, PLAN, README, env template, requirements.
2. **Backend core** – config, models, deterministic NLP (Tamil/English/Tanglish: payment/balance/history/QR help/navigation/yes/no/cancel), fraud/safety guards (SEC-06..09), QR verifier (SEC-08), Gemini client with fallback (SEC-10), routes: `/health`, `/api/assistant/chat`, `/api/qr/verify`, `/api/voice/parse-payment`, `/api/voice/confirm-payment`, `/api/payment/validate`.
3. **Backend tests** – pytest suite (parsing cases, guards, QR, API, no-PIN leakage).
4. **Frontend core** – state store + localStorage, i18n (en/ta), payment state machine with processing lock, confirmation gate, mock bank/balance/beneficiaries/transactions.
5. **Frontend features** – Home, Voice Pay (Dex), Scan & Pay (jsQR + guidance), Pay Contact, Pay UPI ID, Bank linking (6-step demo), WebAuthn/demo auth, Beneficiaries CRUD, History + search + receipt/share, Bills & Recharge mock, Settings, emergency stop.
6. **Accessibility layer** – semantic HTML, ARIA live regions, captions bar, haptics, dwell-click, high contrast, large text, simple mode, keyboard nav, 44px+ targets, responsive 320–1200px.
7. **PWA** – manifest, icons, service worker, offline fallbacks.
8. **Local hosting & run scripts** – `server.js`, `run.ps1`/`run.sh`.
9. **Frontend logic tests** – Node test runner for parser, state machine, guards.
10. **Verify** – run all tests, boot servers, smoke-test endpoints, static checks; write final verification checklist (PRD Appendix B).

## Acceptance mapping (PRD §19)
Each criterion is covered by a named test in `backend/tests` or `frontend/tests` and by the demo script in README.

## Progress checklist (final)
- [x] 1 Scaffold, PLAN, lexicon, shared test vectors
- [x] 2 Backend core (nlp, safety, qr, gemini, flows, API, security headers, rate limit)
- [x] 3 Backend tests: 161 passing (venv at backend/.venv)
- [x] 4 JS nlp + guards + store + payment engine + i18n (en/ta) + a11y + voice + auth + qr + dex
- [x] 5 Screens: home, balance, Dex voice, scan, contacts, UPI, amount, review, auth, result, history, receipt, people, banks, bank-link, bills, insights, settings, welcome, help
- [x] 6 CSS: light/dark/high-contrast, 4 text sizes, simple mode, dwell, responsive 320px to desktop
- [x] 7 PWA (manifest, icons, service worker), server.js, run.ps1 / run.sh
- [x] 8 Frontend unit tests: 132 passing (parity, guards, payment engine, i18n audit, imports, insights)
- [x] 9 Browser e2e + axe audit: 59 steps passing, stable across repeated runs
- [x] 10 README and docs/PRD_COVERAGE.md (PRD Appendix B answered)

Open items that need a human: add GEMINI_API_KEY (optional), manual screen-reader / real-device haptics review.
