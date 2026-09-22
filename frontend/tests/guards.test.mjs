import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setLexicon } from '../js/nlp.js';
import { checkPayment, verifyQr, validAmount } from '../js/guards.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
setLexicon(JSON.parse(readFileSync(join(dir, 'lexicon.json'), 'utf8')));
const QR = JSON.parse(readFileSync(join(dir, 'qr_cases.json'), 'utf8'));

const codes = (r) => new Set(r.warnings.map((x) => x.code));
const draft = (o = {}) => ({ recipient_name: 'Kumar', upi_id: 'kumar@okbank', amount: 500, known: true, verified: true, ...o });

for (const bad of [0, -5, 'abc', null, NaN, Infinity, true, 10.123, '']) {
  test(`invalid amount blocked: ${String(bad)}`, () => {
    const r = checkPayment(draft({ amount: bad }));
    assert.ok(r.blocked && codes(r).has('INVALID_AMOUNT'));
  });
}

test('clean payment passes', () => {
  const r = checkPayment(draft());
  assert.equal(r.blocked, false);
  assert.equal(r.needs_ack, false);
  assert.deepEqual(r.warnings, []);
});

test('high amount warns, limit blocks, balance blocks', () => {
  assert.ok(codes(checkPayment(draft({ amount: 6000 }))).has('HIGH_AMOUNT'));
  const l = checkPayment(draft({ amount: 100001 }));
  assert.ok(l.blocked && codes(l).has('LIMIT_EXCEEDED'));
  const b = checkPayment(draft({ amount: 900 }), { balance: 500 });
  assert.ok(b.blocked && codes(b).has('INSUFFICIENT_BALANCE'));
});

test('receiver warnings and blocks', () => {
  assert.ok(codes(checkPayment(draft({ known: false, verified: false }))).has('UNKNOWN_RECEIVER'));
  const u = checkPayment(draft({ verified: false }));
  assert.ok(codes(u).has('UNVERIFIED_RECEIVER') && u.needs_ack);
  assert.ok(codes(checkPayment(draft({ ambiguous_candidates: ['A', 'B'] }))).has('AMBIGUOUS_RECEIVER'));
  assert.ok(codes(checkPayment(draft({ recipient_name: null, upi_id: null }))).has('MISSING_RECEIVER'));
  assert.ok(codes(checkPayment(draft({ upi_id: 'not a vpa' }))).has('INVALID_UPI_ID'));
});

test('duplicate window', () => {
  const now = 1_800_000_000;
  const recent = [{ recipient: 'Kumar', upi_id: 'kumar@okbank', amount: 500, ts: (now - 30) * 1000, status: 'success' }];
  assert.ok(codes(checkPayment(draft(), { recent, now })).has('DUPLICATE_RECENT'));
  assert.ok(!codes(checkPayment(draft(), { recent: [{ ...recent[0], ts: (now - 3600) * 1000 }], now })).has('DUPLICATE_RECENT'));
  assert.ok(!codes(checkPayment(draft(), { recent: [{ ...recent[0], status: 'failed' }], now })).has('DUPLICATE_RECENT'));
});

test('validAmount helper', () => {
  assert.equal(validAmount('250.50'), 250.5);
  assert.equal(validAmount('1,500'), 1500);
});

for (const c of QR.blocked) {
  test(`qr blocked ${c.code}: ${c.payload.slice(0, 40)}`, () => {
    const r = verifyQr(c.payload, QR.contacts);
    assert.ok(r.blocked && !r.valid && codes(r).has(c.code), JSON.stringify(r.warnings));
  });
}

for (const c of QR.valid) {
  test(`qr valid: ${c.payload.slice(0, 50)}`, () => {
    const r = verifyQr(c.payload, QR.contacts);
    assert.ok(r.valid && !r.blocked);
    assert.equal(r.known, c.known);
    assert.equal(r.payee.amount, c.amount);
    assert.deepEqual([...codes(r)].sort(), [...c.warn].sort());
  });
}
