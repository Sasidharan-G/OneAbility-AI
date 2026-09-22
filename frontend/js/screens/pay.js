// Pay Contact (F11), Pay UPI ID, and the shared amount step.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import * as pay from '../payment.js';
import { VPA_RE, validAmount } from '../guards.js';
import { parseUtterance, tokenize } from '../nlp.js';
import { listen, voiceSupported } from '../voice.js';
import { h, icon, t, btn, simBanner, pageHeader, field, listRow, avatar, formatINR, navigate, emptyState, toast, debounce } from '../ui.js';

const matches = (b, q) => !q || b.name.toLowerCase().includes(q) || (b.upi_id || '').toLowerCase().includes(q);

export function renderContacts(root) {
  const search = field({ label: t('people.search'), id: 'c-search', type: 'search', placeholder: t('people.searchPh') });
  const listEl = h('ul', { class: 'list', 'aria-live': 'polite' });
  const paint = () => {
    const q = search.input.value.trim().toLowerCase();
    const all = store.get().beneficiaries.filter((b) => matches(b, q)).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
    listEl.replaceChildren(...(all.length ? all.map((b) => h('li', {}, listRow({
      title: b.name, sub: b.upi_id, href: `#/amount?to=${encodeURIComponent(b.id)}`,
      trailing: h('span', { class: `badge ${b.verified ? 'badge-ok' : 'badge-warn'}` }, b.verified ? t('people.verified') : t('people.unverified')),
      label: t('people.payLabel', { name: b.name, upi: b.upi_id, state: b.verified ? t('people.verified') : t('people.unverified') }),
    }))) : [h('li', {}, emptyState(t('people.none'), t('people.noneHint'), btn(t('people.add'), { ic: 'plus', href: '#/person?id=new', size: 'md' })))]));
    if (q) a11y.announce(t('people.count', { n: all.length }));
  };
  search.input.addEventListener('input', debounce(paint, 150));

  const micBtn = voiceSupported() ? btn(t('people.voiceSearch'), { ic: 'mic', variant: 'secondary', size: 'md', onClick: async () => {
    a11y.stopSpeaking(); a11y.haptic('listen'); a11y.announce(t('voice.listening'));
    const r = await listen({});
    if (r.text) { const p = parseUtterance(r.text, store.get().beneficiaries); search.input.value = p.recipient || p.recipient_raw || tokenize(r.text).join(' '); paint(); } else toast(t('voice.errNoSpeech'), 'warn');
  } }) : null;

  root.append(pageHeader(t('contact.title')), simBanner(true), search.el, micBtn, listEl,
    h('div', { class: 'actions' }, btn(t('people.add'), { ic: 'plus', href: '#/person?id=new', variant: 'secondary', size: 'md' })));
  paint();
}

export function renderUpi(root, { query }) {
  const upi = field({ label: t('upi.label'), id: 'upi-id', hint: t('upi.hint'), inputmode: 'email', placeholder: 'name@bank', maxlength: 80, value: query.get('upi') || '' });
  const name = field({ label: t('upi.name'), id: 'upi-name', hint: t('upi.nameHint'), maxlength: 60, value: query.get('name') || '' });
  if (query.get('name') && !query.get('upi')) a11y.announce(t('upi.prefill', { name: query.get('name') }));
  const amount = query.get('amount') || '';

  const submit = (e) => {
    e.preventDefault();
    const v = upi.input.value.trim().toLowerCase();
    upi.setError('');
    if (!VPA_RE.test(v)) { upi.setError(t('upi.invalid')); upi.input.focus(); a11y.feedback('error'); return; }
    const q = new URLSearchParams({ upi: v, m: 'upi' });
    if (name.input.value.trim()) q.set('name', name.input.value.trim());
    if (amount) q.set('amount', amount);
    navigate(`#/amount?${q}`);
  };
  root.append(pageHeader(t('upi.title')), simBanner(true),
    h('form', { class: 'stack', novalidate: true, on: { submit } }, upi.el, name.el,
      h('p', { class: 'hint' }, t('upi.warn')), btn(t('common.continue'), { type: 'submit', ic: 'check' })));
}

export function renderAmount(root, { query }) {
  const settings = store.get().settings;
  const banks = store.get().banks;
  let payee;
  let method = query.get('m') || 'contact';
  if (query.get('to')) {
    const b = store.get().beneficiaries.find((x) => x.id === query.get('to'));
    if (!b) { navigate('#/contacts'); return undefined; }
    payee = { name: b.name, upi: b.upi_id, known: true, verified: b.verified };
    method = 'contact';
  } else if (query.get('upi')) {
    const c = store.beneficiaryByUpi(query.get('upi'));
    payee = { name: c ? c.name : (query.get('name') || query.get('upi')), upi: query.get('upi'), known: !!c, verified: !!c?.verified };
  } else { navigate('#/home'); return undefined; }

  if (!banks.length) {
    root.append(pageHeader(t('amount.title')), emptyState(t('home.noBank'), t('home.noBankHint'), btn(t('banks.link'), { ic: 'bank', href: '#/bank-link' })));
    return undefined;
  }

  const amt = field({ label: t('amount.label'), id: 'amt', inputmode: 'decimal', hint: t('amount.hint'), maxlength: 10, value: query.get('amount') || '' });
  amt.input.classList.add('input-amount');
  const note = field({ label: t('amount.note'), id: 'note', maxlength: 80 });

  const chips = h('ul', { class: 'chips', 'aria-label': t('amount.quick') }, [100, 200, 500, 1000, 2000].map((n) =>
    h('li', {}, h('button', { type: 'button', class: 'chip', on: { click: () => { amt.input.value = String(n); amt.setError(''); a11y.announce(formatINR(n)); } } }, formatINR(n)))));

  let bankId = store.primaryBank()?.id;
  const bankBlock = banks.length > 1 ? h('fieldset', { class: 'fieldset' }, h('legend', {}, t('amount.from')),
    banks.map((b) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'bank', value: b.id, checked: b.id === bankId, on: { change: () => { bankId = b.id; } } }),
      h('span', {}, `${b.name} ${b.masked} · ${formatINR(b.balance)}`)))) : h('p', { class: 'muted' }, t('amount.fromOne', { bank: `${banks[0].name} ${banks[0].masked}` }));

  const voiceBtn = voiceSupported() ? btn(t('amount.say'), { ic: 'mic', variant: 'secondary', size: 'md', onClick: async () => {
    a11y.stopSpeaking(); a11y.haptic('listen'); a11y.announce(t('voice.listening'));
    const r = await listen({ lang: settings.listenLang });
    if (r.text) {
      const p = parseUtterance(r.text, []);
      if (p.amount) { amt.input.value = String(p.amount); amt.setError(''); a11y.say(t('amount.heard', { n: p.amount }), { kind: 'info' }); } else a11y.say(t('amount.notHeard'), { kind: 'warn' });
    } else toast(t('voice.errNoSpeech'), 'warn');
  } }) : null;

  const submit = async (e) => {
    e.preventDefault();
    const v = validAmount(amt.input.value.replace(/^₹/, ''));
    if (v === null) { amt.setError(t('amount.invalid')); amt.input.focus(); a11y.feedback('error'); a11y.say(t('amount.invalid'), { assertive: true, kind: 'error' }); return; }
    amt.setError('');
    const draft = pay.makeDraft({ name: payee.name, upi_id: payee.upi, amount: v, method, bank_id: bankId, note: note.input.value, known: payee.known, verified: payee.verified });
    await pay.startFlow(draft, method === 'qr' ? pay.takeStash() : []);
    navigate('#/review');
  };

  root.append(pageHeader(t('amount.title')), simBanner(true),
    h('div', { class: 'payee-card' }, avatar(payee.name), h('div', {}, h('p', { class: 'row-title' }, payee.name), h('p', { class: 'muted' }, payee.upi),
      h('span', { class: `badge ${payee.verified ? 'badge-ok' : 'badge-warn'}` }, payee.verified ? t('people.verified') : payee.known ? t('people.unverified') : t('people.notSaved')))),
    h('form', { class: 'stack', novalidate: true, on: { submit } }, amt.el, chips, voiceBtn, note.el, bankBlock, btn(t('amount.review'), { type: 'submit', ic: 'check' })));
  return undefined;
}
