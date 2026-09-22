// Client payment state machine (PRD 12.1). AI never reaches this module's decisions:
// a draft only becomes a debit after guards pass, an explicit Yes, authorization, and the lock.
//
// idle -> awaiting_confirmation -> awaiting_auth -> processing -> success
//                 \-> blocked            \-> cancelled                \-> failed
import * as store from './store.js';
import { api, contactsPayload, recentPayload } from './api.js';
import { checkPayment, validAmount } from './guards.js';

let current = null;
let lock = false;
const subs = new Set();

export const TERMINAL = new Set(['success', 'cancelled', 'failed']);
export const getCurrent = () => current;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => subs.forEach((fn) => { try { fn(current); } catch (e) { console.error(e); } });

export function makeDraft({ name, upi_id, amount, method = 'contact', bank_id, note, ambiguous = [], qr_blocked = false, known, verified }) {
  const c = (upi_id && store.beneficiaryByUpi(upi_id)) || (name && store.beneficiaryByName(name)) || null;
  return {
    recipient_name: (name || c?.name || upi_id || '').toString().slice(0, 80) || null,
    upi_id: upi_id || c?.upi_id || null,
    amount,
    method,
    bank_id: bank_id || store.primaryBank()?.id || null,
    note: note ? String(note).slice(0, 80) : null,
    known: known !== undefined ? known : !!c,
    verified: verified !== undefined ? verified : !!c?.verified,
    qr_blocked,
    ambiguous_candidates: ambiguous,
  };
}

function guardContext(draft) {
  const bank = draft.bank_id ? store.bankById(draft.bank_id) : store.primaryBank();
  return {
    recent: store.recentTransactions(20),
    balance: bank ? bank.balance : 0,
    settings: { highAmount: store.get().settings.highAmount },
  };
}

function mergeGuards(local, server) {
  const seen = new Set(local.warnings.map((w) => w.code));
  const warnings = [...local.warnings, ...server.warnings.filter((w) => !seen.has(w.code))];
  const blocked = warnings.some((w) => w.severity === 'block');
  return { blocked, needs_ack: !blocked && warnings.some((w) => w.severity === 'warn'), warnings };
}

/** Create a flow from a draft, run local guards, then ask the server for a second opinion when reachable. */
export async function startFlow(draft, extraWarnings = []) {
  if (current && !TERMINAL.has(current.state)) cancelSilently();
  const ctx = guardContext(draft);
  let guard = checkPayment(draft, ctx);
  if (extraWarnings.length) guard = mergeGuards(guard, { warnings: extraWarnings });
  const flow = { id: store.uid('flow'), draft, guard, serverFlowId: null, mode: 'local', state: guard.blocked ? 'blocked' : 'awaiting_confirmation', acknowledged: false, auth: null, result: null, error: null, createdAt: Date.now() };
  current = flow;
  emit();

  const body = { draft: { ...draft, amount: validAmount(draft.amount) ?? draft.amount }, recent: recentPayload(ctx.recent), balance: ctx.balance };
  const r = await api.post('/api/payment/validate', body, 3500);
  if (current !== flow) return flow; // superseded while waiting
  if (r.ok) {
    flow.serverFlowId = r.data.flow_id;
    flow.mode = 'server';
    flow.guard = mergeGuards(flow.guard, r.data.guard);
    if (flow.guard.blocked && flow.state === 'awaiting_confirmation') flow.state = 'blocked';
  }
  emit();
  return flow;
}

function cancelSilently() {
  if (!current || TERMINAL.has(current.state)) return;
  const f = current;
  f.state = 'cancelled';
  if (f.serverFlowId) api.post('/api/payment/confirm', { flow_id: f.serverFlowId, decision: 'no' }, 2500);
  emit();
}

/** Yes/No gate (SEC-04). "Yes" only moves to authorization; it never debits. */
export function decide(decision, { acknowledged = false } = {}) {
  const f = current;
  if (!f) return { ok: false, reason: 'no_flow' };
  if (decision === 'no') {
    if (!TERMINAL.has(f.state)) cancelSilently();
    return { ok: true, state: f.state };
  }
  if (f.state === 'blocked') return { ok: false, reason: 'blocked' };
  if (f.state !== 'awaiting_confirmation') return { ok: false, reason: 'invalid_state' };
  if (f.guard.needs_ack && !acknowledged) return { ok: false, reason: 'ack_required' };
  f.acknowledged = !!acknowledged || !f.guard.needs_ack;
  f.state = 'awaiting_auth';
  emit();
  return { ok: true, state: f.state };
}

/** Execute after authorization. Locked: a second call cannot debit twice (SEC-06). */
export async function execute(auth) {
  const f = current;
  if (!f) return { ok: false, reason: 'no_flow' };
  if (f.state === 'success') return { ok: true, duplicate: true, txn: f.result.txn };
  if (lock || f.state !== 'awaiting_auth') return { ok: false, reason: lock ? 'locked' : 'invalid_state' };
  if (!auth || (auth.method !== 'webauthn' && auth.method !== 'demo')) return { ok: false, reason: 'auth_required' };
  lock = true;
  f.state = 'processing';
  f.auth = { method: auth.method };
  emit();
  try {
    let mockId = null;
    let executedAt = Date.now();
    if (f.serverFlowId) {
      const r = await api.post('/api/payment/confirm', {
        flow_id: f.serverFlowId, decision: 'yes', acknowledged: f.acknowledged,
        auth: { method: auth.method, ...(auth.credentialId ? { credential_id: auth.credentialId } : {}) },
      }, 5000);
      if (r.ok) { mockId = r.data.result.mock_txn_id; executedAt = r.data.result.executed_at; }
      else if (!r.offline) {
        f.state = 'failed';
        f.error = r.error;
        emit();
        return { ok: false, reason: 'server_rejected', error: r.error };
      }
    }
    const d = f.draft;
    const { txn, duplicate } = store.applyTransaction({
      id: mockId || store.mockTxnId(), flowId: f.id, recipient: d.recipient_name, upi_id: d.upi_id, amount: validAmount(d.amount),
      ts: executedAt, method: d.method, note: d.note || '', bankId: d.bank_id, authMethod: auth.method,
      authLabel: auth.method === 'webauthn' ? 'Device authenticator (WebAuthn)' : 'Demo authorization (no biometric checked)',
    });
    f.result = { txn, duplicate };
    f.state = 'success';
    emit();
    return { ok: true, duplicate, txn };
  } catch (e) {
    f.state = 'failed';
    f.error = { code: 'LOCAL_ERROR', message: e.message };
    emit();
    return { ok: false, reason: 'error', error: f.error };
  } finally {
    lock = false;
  }
}

/** Emergency stop (SEC-12): abandon any unfinished flow and return to a safe state. */
export function emergencyStop() {
  if (current && !TERMINAL.has(current.state) && current.state !== 'processing') { cancelSilently(); return true; }
  return false;
}

let stash = [];
/** Carry QR-specific warnings across the amount step. */
export const stashWarnings = (w) => { stash = w || []; };
export const takeStash = () => { const s = stash; stash = []; return s; };

export const resetFlow = () => { current = null; lock = false; emit(); };
export const isLocked = () => lock;

export function warningText(w, lang) { return lang === 'ta' ? w.message_ta : w.message_en; }
