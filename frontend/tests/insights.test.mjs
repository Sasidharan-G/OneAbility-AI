import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInsights } from '../js/insights.js';

const D = (y, m, d) => new Date(y, m, d, 12).getTime();
const now = new Date(2026, 8, 22, 15); // 22 Sep 2026
const tx = (ts, amount, method, recipient, status = 'success') => ({ ts, amount, method, recipient, status });

test('totals, categories, payees and change vs last month', () => {
  const list = [
    tx(D(2026, 8, 3), 1000, 'voice', 'Priya'), tx(D(2026, 8, 10), 500, 'bill', 'TNEB'), tx(D(2026, 8, 12), 500, 'voice', 'Priya'),
    tx(D(2026, 7, 5), 1000, 'voice', 'Priya'), tx(D(2026, 7, 20), 1000, 'bill', 'TNEB'),
    tx(D(2026, 6, 1), 9999, 'qr', 'Old'), // two months ago: ignored
  ];
  const s = computeInsights(list, now);
  assert.equal(s.total, 2000);
  assert.equal(s.count, 3);
  assert.equal(s.average, 666.67);
  assert.equal(s.prevTotal, 2000);
  assert.equal(s.changePct, 0);
  assert.equal(s.direction, 'same');
  assert.deepEqual(s.categories.map((c) => [c.method, c.amount]), [['voice', 1500], ['bill', 500]]);
  assert.equal(Math.round(s.categories[0].share * 100), 75);
  assert.deepEqual(s.topPayees[0], { name: 'Priya', amount: 1500 });
  assert.equal(s.biggest.amount, 1000);
});

test('up and down direction', () => {
  const up = computeInsights([tx(D(2026, 8, 2), 300, 'qr', 'A'), tx(D(2026, 7, 2), 200, 'qr', 'A')], now);
  assert.equal(up.changePct, 50);
  assert.equal(up.direction, 'up');
  const down = computeInsights([tx(D(2026, 8, 2), 100, 'qr', 'A'), tx(D(2026, 7, 2), 400, 'qr', 'A')], now);
  assert.equal(down.changePct, -75);
  assert.equal(down.direction, 'down');
});

test('no baseline when last month is empty; failed payments and future dates ignored', () => {
  const s = computeInsights([tx(D(2026, 8, 2), 100, 'qr', 'A'), tx(D(2026, 8, 3), 999, 'qr', 'B', 'failed'), tx(now.getTime() + 86400000, 50, 'qr', 'C')], now);
  assert.equal(s.total, 100);
  assert.equal(s.changePct, null);
  assert.equal(s.direction, 'none');
});

test('january looks back to december of the previous year', () => {
  const jan = new Date(2027, 0, 15);
  const s = computeInsights([tx(new Date(2026, 11, 20).getTime(), 700, 'bill', 'X'), tx(new Date(2027, 0, 2).getTime(), 350, 'bill', 'X')], jan);
  assert.equal(s.prevTotal, 700);
  assert.equal(s.total, 350);
  assert.equal(s.changePct, -50);
});

test('empty input is safe', () => {
  const s = computeInsights([], now);
  assert.equal(s.total, 0);
  assert.equal(s.count, 0);
  assert.deepEqual(s.categories, []);
  assert.equal(s.biggest, null);
});
