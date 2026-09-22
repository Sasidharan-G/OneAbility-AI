"""OneAbility AI FastAPI backend. Simulated payments only: no real money, PIN, OTP or biometrics."""

import base64
import logging
import secrets
import time
from collections import defaultdict, deque
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import gemini as gem
from .config import FRONTEND_DIR, Settings, get_settings
from .flows import FlowError, FlowStore
from .nlp import parse_confirmation, parse_utterance
from .qr import verify_qr
from .safety import check_payment

log = logging.getLogger("oneability")
VERSION = "1.0.0"


class Strict(BaseModel):
    """extra='forbid' means a stray pin/otp/biometric field is rejected outright (SEC-01/02)."""
    model_config = ConfigDict(extra="forbid")


class ContactIn(Strict):
    name: str = Field(min_length=1, max_length=60)
    upi_id: Optional[str] = Field(default=None, max_length=80)
    verified: bool = False
    favorite: bool = False


class RecentTxn(Strict):
    recipient: str = Field(default="", max_length=80)
    upi_id: Optional[str] = Field(default=None, max_length=80)
    amount: float = 0
    ts: float = 0
    status: str = "success"


class ChatReq(Strict):
    message: str = Field(min_length=1, max_length=500)
    profile_name: Optional[str] = Field(default=None, max_length=40)
    language: Optional[Literal["en", "ta", "tanglish"]] = None
    contacts: list[ContactIn] = Field(default_factory=list, max_length=100)


class ParseReq(ChatReq):
    recent: list[RecentTxn] = Field(default_factory=list, max_length=50)
    balance: Optional[float] = None
    bank_id: Optional[str] = Field(default=None, max_length=40)


class DraftIn(Strict):
    recipient_name: Optional[str] = Field(default=None, max_length=80)
    upi_id: Optional[str] = Field(default=None, max_length=80)
    amount: Any = None
    method: Literal["voice", "qr", "contact", "upi", "bill"] = "contact"
    bank_id: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=80)
    known: bool = False
    verified: bool = False
    qr_blocked: bool = False
    ambiguous_candidates: list[str] = Field(default_factory=list, max_length=10)


class ValidateReq(Strict):
    draft: DraftIn
    recent: list[RecentTxn] = Field(default_factory=list, max_length=50)
    balance: Optional[float] = None


class AuthIn(Strict):
    method: Literal["webauthn", "demo"]
    credential_id: Optional[str] = Field(default=None, max_length=256)


class ConfirmReq(Strict):
    flow_id: str = Field(min_length=6, max_length=40)
    decision: Optional[Literal["yes", "no"]] = None
    utterance: Optional[str] = Field(default=None, max_length=200)
    auth: Optional[AuthIn] = None
    acknowledged: bool = False


class QRReq(Strict):
    payload: str = Field(max_length=2000)
    contacts: list[ContactIn] = Field(default_factory=list, max_length=100)


class RateLimiter:
    """Tiny per-client sliding window to protect the Gemini quota."""
    def __init__(self, limit: int, window: float):
        self.limit, self.window, self.hits = limit, window, defaultdict(deque)

    def __call__(self, request: Request) -> None:
        ip = request.client.host if request.client else "local"
        q, now = self.hits[ip], time.time()
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(429, detail={"code": "RATE_LIMITED", "message": "Too many requests. Please wait a moment."})
        q.append(now)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    cfg = settings or get_settings()
    app = FastAPI(title="OneAbility AI API", version=VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json")
    flows = FlowStore(cfg)
    limiter = RateLimiter(60, 60.0)
    app.state.flows, app.state.settings = flows, cfg

    app.add_middleware(CORSMiddleware, allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
                       allow_methods=["GET", "POST"], allow_headers=["content-type"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)")
        if not request.url.path.startswith("/api/docs") and not request.url.path.startswith("/api/openapi"):
            resp.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
                "media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; "
                "object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if request.url.path in ("/sw.js", "/") or request.url.path.endswith(".webmanifest"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.exception_handler(FlowError)
    async def flow_error(_: Request, e: FlowError):
        return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, e: HTTPException):
        d = e.detail if isinstance(e.detail, dict) else {"code": "HTTP_ERROR", "message": str(e.detail)}
        return JSONResponse(status_code=e.status_code, content={"error": d})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        forbidden = [x for x in e.errors() if x.get("type") == "extra_forbidden"]
        msg = "Unexpected field rejected. Never send PIN, OTP or biometric data." if forbidden else "Invalid request."
        fields = [".".join(str(p) for p in x.get("loc", ())[1:]) for x in e.errors()][:5]
        return JSONResponse(status_code=422, content={"error": {"code": "INVALID_REQUEST", "message": msg, "fields": fields}})

    # ---------------------------------------------------------------- helpers
    def contact_dicts(cs: list[ContactIn]) -> list[dict]:
        return [c.model_dump() for c in cs]

    def draft_from_parsed(p: dict, contacts: list[dict], method: str = "voice", bank_id: Optional[str] = None) -> dict:
        contact = next((c for c in contacts if c["name"] == p.get("recipient")), None)
        upi = p.get("upi_id") or (contact or {}).get("upi_id")
        name = p.get("recipient") or p.get("recipient_raw") or upi or p.get("phone")
        return {"recipient_name": name, "upi_id": upi, "amount": p.get("amount"), "method": method,
                "bank_id": bank_id, "note": None, "known": bool(contact), "verified": bool((contact or {}).get("verified")),
                "qr_blocked": False, "ambiguous_candidates": p.get("candidates", []) if p.get("recipient_status") == "ambiguous" else []}

    # ----------------------------------------------------------------- routes
    @app.get("/health")
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": VERSION, "gemini": {"enabled": cfg.gemini_enabled, "model": cfg.gemini_model},
                "simulated": True, "time": int(time.time() * 1000)}

    @app.get("/api/auth/challenge")
    async def challenge():
        """Random WebAuthn challenge. The app never sees biometrics, only the OS verdict."""
        return {"challenge": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="),
                "timeout_ms": 60000, "simulated": True}

    async def understand(req: ChatReq) -> tuple[dict, str, list[dict]]:
        contacts = contact_dicts(req.contacts)
        local = parse_utterance(req.message, contacts)
        if local["intent"] == "secret_warning":
            return local, "skipped", contacts
        model, status = await gem.ask_gemini(req.message, req.profile_name, req.language,
                                             [c["name"] for c in contacts], cfg)
        return gem.merge(local, model, contacts), status, contacts

    @app.post("/api/assistant/chat", dependencies=[Depends(limiter)])
    async def chat(req: ChatReq):
        parsed, status, _ = await understand(req)
        return {"parsed": parsed, "reply": parsed.get("reply"), "gemini_status": status,
                "source": parsed["source"], "simulated": True}

    @app.post("/api/voice/parse-payment", dependencies=[Depends(limiter)])
    async def parse_payment(req: ParseReq):
        parsed, status, contacts = await understand(req)
        out: dict[str, Any] = {"parsed": parsed, "gemini_status": status, "simulated": True,
                               "draft": None, "guard": None, "flow_id": None, "flow_state": None}
        if parsed["intent"] != "payment_request":
            return out
        draft = draft_from_parsed(parsed, contacts, "voice", req.bank_id)
        recent = [t.model_dump() for t in req.recent]
        guard = check_payment(draft, recent, req.balance, cfg)
        out.update(draft=draft, guard=guard)
        if not parsed["missing"] and parsed["recipient_status"] != "ambiguous":
            f = flows.create(draft, guard)
            out.update(flow_id=f["flow_id"], flow_state=f["state"])
        return out

    @app.post("/api/payment/validate")
    async def validate(req: ValidateReq):
        draft = req.draft.model_dump()
        guard = check_payment(draft, [t.model_dump() for t in req.recent], req.balance, cfg)
        f = flows.create(draft, guard)
        return {"flow_id": f["flow_id"], "flow_state": f["state"], "draft": draft, "guard": guard, "simulated": True}

    @app.post("/api/voice/confirm-payment")
    @app.post("/api/payment/confirm")
    async def confirm(req: ConfirmReq):
        decision = req.decision
        if decision is None:
            if not req.utterance:
                raise HTTPException(422, detail={"code": "DECISION_REQUIRED", "message": "Say yes or no."})
            heard = parse_confirmation(req.utterance)
            if heard == "unclear":
                raise HTTPException(422, detail={"code": "UNCLEAR_CONFIRMATION",
                                                 "message": "I did not catch a clear yes or no. Nothing was paid."})
            decision = heard
        res = flows.decide(req.flow_id, decision, req.auth.model_dump() if req.auth else None, req.acknowledged)
        return {**res, "simulated": True}

    @app.get("/api/payment/flow/{flow_id}")
    async def flow_status(flow_id: str):
        return {**flows.get(flow_id), "simulated": True}

    @app.post("/api/qr/verify")
    async def qr_verify(req: QRReq):
        res = verify_qr(req.payload, contact_dicts(req.contacts))
        return {**res, "simulated": True}

    @app.get("/api/{rest:path}")
    async def api_404(rest: str):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "Unknown API route."})

    if cfg.serve_frontend and FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    return app


app = create_app()
