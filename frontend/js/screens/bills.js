// Bills and recharge (F12): mock billers routed through the same review / confirm / authorize pipeline.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import * as pay from '../payment.js';
import { validAmount } from '../guards.js';
import { h, icon, t, btn, simBanner, pageHeader, field, formatINR, navigate, emptyState } from '../ui.js';

const CATS = {
  mobile: { ic: 'phone', idLabel: 'bills.mobileNo', idRe: /^[6-9]\d{9}$/, idErr: 'person.errPhone', plans: [149, 199, 239, 299, 349, 479, 666, 749],
    billers: [['Jio', 'jio@billpay'], ['Airtel', 'airtel@billpay'], ['Vi (Vodafone Idea)', 'vi@billpay'], ['BSNL', 'bsnl@billpay']] },
  electricity: { ic: 'bulb', idLabel: 'bills.consumerNo', idRe: /^\d{10,12}$/, idErr: 'bills.errConsumer', plans: [],
    billers: [['TNEB Electricity', 'tneb@billpay'], ['BESCOM', 'bescom@billpay']] },
  water: { ic: 'drop', idLabel: 'bills.consumerNo', idRe: /^\d{8,12}$/, idErr: 'bills.errConsumer', plans: [],
    billers: [['Metro Water Board', 'metrowater@billpay'], ['Municipal Water', 'muniwater@billpay']] },
  dth: { ic: 'tv', idLabel: 'bills.subscriberId', idRe: /^\d{10,12}$/, idErr: 'bills.errSubscriber', plans: [200, 300, 500, 700],
    billers: [['Tata Play', 'tataplay@billpay'], ['Airtel Digital TV', 'airteldth@billpay'], ['Sun Direct', 'sundirect@billpay']] },
};

export function renderBills(root, { query }) {
  const presetAmount = query.get('amount') || '';
  const holder = h('div', { class: 'stack' });

  function pickCategory() {
    holder.replaceChildren(h('div', { class: 'tiles' }, Object.entries(CATS).map(([k, c]) => h('button', { type: 'button', class: 'tile', on: { click: () => form(k) } },
      h('span', { class: 'tile-icon' }, icon(c.ic, 34)), h('span', { class: 'tile-label' }, t(`bills.cat.${k}`)), h('span', { class: 'tile-hint' }, t(`bills.cat.${k}.hint`))))));
    a11y.announce(t('bills.pick'));
  }

  function form(key) {
    const c = CATS[key];
    let biller = c.billers[0];
    const idf = field({ label: t(c.idLabel), id: 'bill-id', inputmode: 'numeric', maxlength: 12 });
    const amt = field({ label: t('amount.label'), id: 'bill-amt', inputmode: 'decimal', maxlength: 9, value: presetAmount, hint: c.plans.length ? t('bills.planHint') : t('bills.billHint') });
    amt.input.classList.add('input-amount');
    const plans = c.plans.length ? h('ul', { class: 'chips', 'aria-label': t('bills.plans') }, c.plans.map((n) => h('li', {}, h('button', { type: 'button', class: 'chip',
      on: { click: () => { amt.input.value = String(n); amt.setError(''); a11y.announce(formatINR(n)); } } }, formatINR(n))))) : null;

    const submit = async (e) => {
      e.preventDefault();
      let bad = null;
      idf.setError(''); amt.setError('');
      const idv = idf.input.value.trim();
      if (!c.idRe.test(idv)) { idf.setError(t(c.idErr)); bad = idf; }
      const v = validAmount(amt.input.value);
      if (v === null) { amt.setError(t('amount.invalid')); bad = bad || amt; }
      if (bad) { bad.input.focus(); a11y.feedback('error'); a11y.say(bad === idf ? t(c.idErr) : t('amount.invalid'), { assertive: true, kind: 'error' }); return; }
      const draft = pay.makeDraft({ name: biller[0], upi_id: biller[1], amount: v, method: 'bill', note: `${t(c.idLabel)}: ${idv}`, known: true, verified: true });
      await pay.startFlow(draft);
      navigate('#/review');
    };

    holder.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-ghost btn-md', on: { click: pickCategory } }, icon('back', 22), h('span', { class: 'btn-label' }, t('bills.change'))),
      h('h2', { class: 'section-title', tabindex: '-1', id: 'bill-h' }, t(`bills.cat.${key}`)),
      h('form', { class: 'stack', novalidate: true, on: { submit } },
        h('fieldset', { class: 'fieldset' }, h('legend', {}, t('bills.biller')),
          c.billers.map((b, i) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'biller', value: b[0], checked: i === 0, on: { change: () => { biller = b; } } }), h('span', {}, b[0])))),
        idf.el, amt.el, plans, btn(t('amount.review'), { type: 'submit', ic: 'check' }), h('p', { class: 'hint' }, t('bills.note'))));
    document.getElementById('bill-h')?.focus();
  }

  if (!store.get().banks.length) { root.append(pageHeader(t('bills.title')), emptyState(t('home.noBank'), t('home.noBankHint'), btn(t('banks.link'), { ic: 'bank', href: '#/bank-link' }))); return; }
  root.append(pageHeader(t('bills.title')), simBanner(true), holder);
  pickCategory();
}
