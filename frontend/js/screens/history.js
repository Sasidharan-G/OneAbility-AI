// Transaction history + search (F08) and receipts (F14).
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import { listen, voiceSupported } from '../voice.js';
import { h, icon, t, btn, simBanner, pageHeader, field, listRow, formatINR, spokenINR, formatDateTime, relativeDay, emptyState, toast, debounce, navigate } from '../ui.js';

const FILTERS = ['all', 'voice', 'qr', 'contact', 'upi', 'bill'];

function matches(tx, q) {
  if (!q) return true;
  const hay = `${tx.recipient} ${tx.upi_id || ''} ${tx.id} ${tx.amount} ${tx.note || ''} ${t('method.' + tx.method)}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function renderHistory(root, { query }) {
  let filter = 'all';
  const search = field({ label: t('history.search'), id: 'h-search', type: 'search', placeholder: t('history.searchPh'), value: query.get('q') || '' });
  const listEl = h('ul', { class: 'list' });
  const count = h('p', { class: 'muted', role: 'status' });
  const chipBox = h('ul', { class: 'chips', 'aria-label': t('history.filter') });

  const current = () => store.recentTransactions(200).filter((tx) => (filter === 'all' || tx.method === filter) && matches(tx, search.input.value.trim().toLowerCase()));

  const paint = () => {
    const rows = current();
    listEl.replaceChildren(...(rows.length ? rows.map((tx) => h('li', {}, listRow({
      title: tx.recipient, sub: `${formatDateTime(tx.ts)} · ${t('method.' + tx.method)}`,
      trailing: h('span', { class: 'amount-out' }, `− ${formatINR(tx.amount)}`), href: `#/txn/${encodeURIComponent(tx.id)}`,
      label: t('history.rowLabel', { name: tx.recipient, amount: spokenINR(tx.amount), when: relativeDay(tx.ts) }),
    }))) : [h('li', {}, emptyState(t('history.noMatch'), t('history.noMatchHint')))]));
    count.textContent = t('history.count', { n: rows.length });
    chipBox.replaceChildren(...FILTERS.map((k) => h('li', {}, h('button', { type: 'button', class: `chip${filter === k ? ' chip-on' : ''}`, 'aria-pressed': String(filter === k),
      on: { click: () => { filter = k; paint(); } } }, k === 'all' ? t('history.all') : t('method.' + k)))));
  };
  search.input.addEventListener('input', debounce(paint, 150));

  const readLatest = () => {
    const rows = current().slice(0, 3);
    if (!rows.length) { a11y.say(t('history.empty')); return; }
    a11y.say(rows.map((tx) => t('history.readRow', { name: tx.recipient, amount: spokenINR(tx.amount), when: relativeDay(tx.ts) })).join(' '));
  };

  const micBtn = voiceSupported() ? btn(t('history.voiceSearch'), { ic: 'mic', variant: 'secondary', size: 'md', onClick: async () => {
    a11y.stopSpeaking(); a11y.haptic('listen'); a11y.announce(t('voice.listening'));
    const r = await listen({});
    if (r.text) { search.input.value = r.text.replace(/[.,!?]/g, ''); paint(); readLatest(); } else toast(t('voice.errNoSpeech'), 'warn');
  } }) : null;

  root.append(pageHeader(t('history.title')), simBanner(true), search.el, chipBox, count, listEl,
    h('div', { class: 'actions' }, btn(t('history.read'), { ic: 'volume', variant: 'secondary', size: 'md', onClick: readLatest }), micBtn));
  paint();
  if (query.get('q')) readLatest();
}

export function receiptText(tx) {
  return [
    'OneAbility AI - SIMULATED PAYMENT RECEIPT',
    '*** Demo only. No real money was moved. ***',
    '',
    `Receipt ID : ${tx.id}`, `Date       : ${formatDateTime(tx.ts)}`, `Paid to    : ${tx.recipient}`,
    `UPI ID     : ${tx.upi_id || '-'}`, `Amount     : ${formatINR(tx.amount)}`, `From bank  : ${tx.bankName}`,
    `Method     : ${t('method.' + tx.method)}`, `Authorized : ${tx.authLabel}`, `Status     : ${t('receipt.success')}`,
    tx.note ? `Note       : ${tx.note}` : null,
  ].filter((x) => x !== null).join('\n');
}

export function renderReceipt(root, { params }) {
  const tx = store.transactionById(decodeURIComponent(params.id));
  if (!tx) { root.append(pageHeader(t('receipt.title')), emptyState(t('receipt.missing'), '', btn(t('common.home'), { href: '#/home', ic: 'home' }))); return; }

  const readOut = () => a11y.say(t('receipt.say', { amount: spokenINR(tx.amount), name: tx.recipient, when: formatDateTime(tx.ts), id: tx.id.replace(/-/g, ' ') }));

  async function share() {
    const text = receiptText(tx);
    try {
      if (navigator.share) { await navigator.share({ title: t('receipt.shareTitle'), text }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast(t('receipt.copied'), 'success'); a11y.feedback('confirm'); return; } catch { /* fall through */ }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = h('a', { href: url, download: `receipt-${tx.id}.txt` });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast(t('receipt.downloaded'), 'success');
  }

  root.append(pageHeader(t('receipt.title')), simBanner(),
    h('section', { class: 'card receipt' },
      h('p', { class: 'badge badge-ok' }, icon('check', 18), ' ', t('receipt.success')),
      h('p', { class: 'review-amount' }, formatINR(tx.amount)),
      h('dl', { class: 'kv' },
        h('dt', {}, t('receipt.id')), h('dd', {}, tx.id),
        h('dt', {}, t('receipt.when')), h('dd', {}, formatDateTime(tx.ts)),
        h('dt', {}, t('review.to')), h('dd', {}, tx.recipient),
        h('dt', {}, t('review.upi')), h('dd', {}, tx.upi_id || '—'),
        h('dt', {}, t('review.from')), h('dd', {}, tx.bankName),
        h('dt', {}, t('review.method')), h('dd', {}, t('method.' + tx.method)),
        h('dt', {}, t('receipt.auth')), h('dd', {}, tx.authLabel),
        tx.note ? [h('dt', {}, t('review.note')), h('dd', {}, tx.note)] : null)),
    h('div', { class: 'actions' },
      btn(t('receipt.read'), { ic: 'volume', onClick: readOut }),
      btn(t('receipt.share'), { ic: 'share', variant: 'secondary', onClick: share }),
      btn(t('history.title'), { ic: 'clock', variant: 'ghost', href: '#/history' })),
    h('p', { class: 'hint' }, t('result.noReal')));
}
