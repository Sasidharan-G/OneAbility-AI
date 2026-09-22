import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setLexicon } from '../js/nlp.js';
import * as store from '../js/store.js';
import * as pay from '../js/payment.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
setLexicon(JSON.parse(readFileSync(join(dir, 'lexicon.json'), 'utf8')));

// ---- fake backend: mimics FastAPI contract closely enough for the client state machine
let mode = 'offline';
let confirmCalls = 0;
globalThis.fetch = async (url, opts = {}) => {
  if (mode === 'offline') throw new Error('offline');
  const body = opts.body ? JSON.parse(opts.body) : {};
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (url === '/api/payment/validate') return json(200, { flow_id: 'flow_srv1', guard: { blocked: false, needs_ack: false, warnings: mode === 'server-warn' ? [{ code: 'HIGH_AMOUNT', severity: 'warn', message_en: 'x', message_ta: 'x' }] : [] } });
  if (url === '/api/payment/confirm') {
    confirmCalls++;
    if (mode === 'server-reject') return json(409, { error: { code: 'FLOW_BLOCKED', message: 'blocked' } });
    if (body.decision === 'no') return json(200, { state: 'cancelled' });
    return json(200, { state: 'executed', result: { mock_txn_id: 'MOCK-SERVER0001', executed_at: Date.now() } });
  }
  return json(404, { error: { code: 'NOT_FOUND' } });
};

beforeEach(() => { store._resetForTests(); store.load(); pay.resetFlow(); mode = 'offline'; confirmCalls = 0; });

const kumar = (amount = 500, extra = {}) => pay.makeDraft({ name: 'Kumar', amount, method: 'voice', ...extra });
const bal = () => store.balance();

test('happy path debits exactly once and records history', async () => {
  const before = bal(); const n = store.get().transactions.length;
  await pay.startFlow(kumar());
  assert.equal(pay.getCurrent().state, 'awaiting_confirmation');
  assert.deepEqual(pay.decide('yes'), { ok: true, state: 'awaiting_auth' });
  const r = await pay.execute({ method: 'demo' });
  assert.ok(r.ok && !r.duplicate);
  assert.equal(bal(), before - 500);
  assert.equal(store.get().transactions.length, n + 1);
  assert.match(r.txn.id, /^MOCK-/);
  assert.equal(pay.getCurrent().state, 'success');
});

test('double submit is locked: concurrent executes debit once', async () => {
  const before = bal();
  await pay.startFlow(kumar(300));
  pay.decide('yes');
  const [a, b] = await Promise.all([pay.execute({ method: 'demo' }), pay.execute({ method: 'demo' })]);
  assert.equal([a, b].filter((x) => x.ok && !x.duplicate).length, 1);
  assert.equal(bal(), before - 300);
  const c = await pay.execute({ method: 'demo' }); // after success
  assert.ok(c.ok && c.duplicate);
  assert.equal(bal(), before - 300);
});

test('cancel leaves no debit and no transaction', async () => {
  const before = bal(); const n = store.get().transactions.length;
  await pay.startFlow(kumar());
  pay.decide('no');
  assert.equal(pay.getCurrent().state, 'cancelled');
  assert.deepEqual(await pay.execute({ method: 'demo' }), { ok: false, reason: 'invalid_state' });
  assert.equal(bal(), before);
  assert.equal(store.get().transactions.length, n);
});

test('cannot execute without confirmation or without authorization', async () => {
  await pay.startFlow(kumar());
  assert.equal((await pay.execute({ method: 'demo' })).reason, 'invalid_state');
  pay.decide('yes');
  assert.equal((await pay.execute(null)).reason, 'auth_required');
  assert.equal((await pay.execute({ method: 'pin' })).reason, 'auth_required');
  assert.equal(pay.getCurrent().state, 'awaiting_auth');
});

test('blocked drafts can never be confirmed', async () => {
  for (const d of [kumar(0), kumar(-5), kumar(200000), kumar(999999)]) {
    await pay.startFlow(d);
    assert.equal(pay.getCurrent().state, 'blocked');
    assert.deepEqual(pay.decide('yes', { acknowledged: true }), { ok: false, reason: 'blocked' });
  }
});

test('insufficient balance blocks', async () => {
  await pay.startFlow(kumar(30000));
  assert.equal(pay.getCurrent().state, 'blocked');
});

test('warnings require acknowledgement (unverified receiver)', async () => {
  await pay.startFlow(pay.makeDraft({ name: 'Ravi', amount: 100, method: 'contact' }));
  assert.ok(pay.getCurrent().guard.needs_ack);
  assert.equal(pay.decide('yes').reason, 'ack_required');
  assert.equal(pay.decide('yes', { acknowledged: true }).ok, true);
});

test('duplicate recent payment is flagged after a real one', async () => {
  await pay.startFlow(kumar(100)); pay.decide('yes'); await pay.execute({ method: 'demo' });
  await pay.startFlow(kumar(100));
  assert.ok(pay.getCurrent().guard.warnings.some((w) => w.code === 'DUPLICATE_RECENT'));
});

test('server mode: uses server id, merges warnings, only one confirm call', async () => {
  mode = 'server-warn';
  await pay.startFlow(kumar(100));
  const f = pay.getCurrent();
  assert.equal(f.mode, 'server');
  assert.ok(f.guard.warnings.some((w) => w.code === 'HIGH_AMOUNT') && f.guard.needs_ack);
  pay.decide('yes', { acknowledged: true });
  mode = 'server';
  const r = await pay.execute({ method: 'webauthn', credentialId: 'abc' });
  assert.equal(r.txn.id, 'MOCK-SERVER0001');
  assert.equal(confirmCalls, 1);
});

test('server rejection fails safely with no debit', async () => {
  mode = 'server';
  await pay.startFlow(kumar(100));
  pay.decide('yes');
  mode = 'server-reject';
  const before = bal();
  const r = await pay.execute({ method: 'demo' });
  assert.equal(r.reason, 'server_rejected');
  assert.equal(bal(), before);
  assert.equal(pay.getCurrent().state, 'failed');
});

test('emergency stop cancels unfinished flow, not finished ones', async () => {
  await pay.startFlow(kumar());
  assert.equal(pay.emergencyStop(), true);
  assert.equal(pay.getCurrent().state, 'cancelled');
  assert.equal(pay.emergencyStop(), false);
});

test('starting a new flow cancels the previous one', async () => {
  await pay.startFlow(kumar(100));
  const first = pay.getCurrent();
  await pay.startFlow(kumar(200));
  assert.equal(first.state, 'cancelled');
  assert.equal(pay.getCurrent().draft.amount, 200);
});

test('store never persists secret-like keys', async () => {
  const raw = { profile: { name: 'A', pin: '1234' }, settings: { otp: '9' }, banks: [], beneficiaries: [], transactions: [] };
  globalThis.localStorage = { _d: { 'oneability.v1': JSON.stringify(raw) }, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
  store._resetForTests(); store.load();
  await pay.startFlow(kumar(50)).catch(() => {});
  const dump = JSON.stringify(store.get()) + JSON.stringify(globalThis.localStorage._d) + store.exportData();
  assert.ok(!/"(pin|otp|upi_pin|cvv)"/i.test(dump));
  delete globalThis.localStorage;
});

test('sequential payments keep balance consistent', async () => {
  const start = bal();
  for (const amt of [100, 250.5, 49.5]) {
    await pay.startFlow(pay.makeDraft({ name: 'Meena', amount: amt })); pay.decide('yes'); await pay.execute({ method: 'demo' });
  }
  assert.equal(bal(), Math.round((start - 400) * 100) / 100);
});
