// Monthly expense insights (PRD 21 roadmap): pure functions, no DOM, easy to test.

const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1).getTime();
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Summarise successful payments for the calendar month of `now` and compare with the previous month.
 * Returns totals, per-method categories, top payees and a percentage change (null when there is no baseline).
 */
export function computeInsights(transactions, now = new Date()) {
  const thisStart = monthStart(now);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const ok = transactions.filter((t) => (t.status || 'success') === 'success');
  const inThis = ok.filter((t) => t.ts >= thisStart && t.ts <= now.getTime());
  const inPrev = ok.filter((t) => t.ts >= prevStart && t.ts < thisStart);

  const sum = (list) => round2(list.reduce((a, t) => a + t.amount, 0));
  const total = sum(inThis);
  const prevTotal = sum(inPrev);

  const byCat = new Map();
  for (const t of inThis) byCat.set(t.method, round2((byCat.get(t.method) || 0) + t.amount));
  const categories = [...byCat.entries()].map(([method, amount]) => ({ method, amount, share: total ? amount / total : 0 })).sort((a, b) => b.amount - a.amount);

  const byPayee = new Map();
  for (const t of inThis) byPayee.set(t.recipient, round2((byPayee.get(t.recipient) || 0) + t.amount));
  const topPayees = [...byPayee.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 3);

  let changePct = null;
  if (prevTotal > 0) changePct = Math.round(((total - prevTotal) / prevTotal) * 100);
  const direction = changePct === null ? 'none' : changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'same';

  return {
    monthStart: thisStart, prevMonthStart: prevStart,
    total, count: inThis.length, average: inThis.length ? round2(total / inThis.length) : 0,
    prevTotal, prevCount: inPrev.length, changePct, direction, categories, topPayees,
    biggest: inThis.length ? [...inThis].sort((a, b) => b.amount - a.amount)[0] : null,
  };
}
