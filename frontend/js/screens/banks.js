// Bank accounts (F09): list, primary selection, and a guided 6-step SIMULATED linking flow.
// No real bank, SMS or OTP is involved; only masked demo data is stored.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import { h, icon, t, btn, simBanner, pageHeader, field, formatINR, confirmDialog, toast, navigate, emptyState } from '../ui.js';

const BANKS = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Canara Bank', 'Bank of Baroda', 'Indian Bank', 'Indian Overseas Bank'];

function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
const last4 = (seed) => String(1000 + (hash(seed) % 9000));
const mockBalance = (seed) => 8000 + Math.round(((hash(seed + 'bal') % 52000)) / 50) * 50;

export function renderBanks(root) {
  const paint = () => {
    root.replaceChildren();
    const banks = store.get().banks;
    root.append(pageHeader(t('banks.title')), simBanner(true),
      banks.length ? h('ul', { class: 'stack list-plain' }, banks.map((b) => h('li', { class: 'card' },
        h('h2', { class: 'section-title' }, `${b.name} ${b.masked}`, b.primary ? h('span', { class: 'badge badge-ok' }, t('banks.primary')) : null),
        h('p', { class: 'muted' }, `${b.kind} · ${t('banks.demo')}`),
        h('p', { class: 'balance-amount' }, formatINR(b.balance)),
        h('div', { class: 'actions actions-row' },
          b.primary ? null : btn(t('banks.makePrimary'), { ic: 'star', variant: 'secondary', size: 'md', onClick: () => { store.setPrimaryBank(b.id); a11y.say(t('banks.primarySet', { bank: b.name })); paint(); } }),
          btn(t('banks.unlink'), { ic: 'trash', variant: 'danger', size: 'md', onClick: async () => {
            if (await confirmDialog({ title: t('banks.unlinkTitle', { bank: b.name }), message: t('banks.unlinkMsg'), confirmLabel: t('banks.unlink'), danger: true })) {
              store.removeBank(b.id); toast(t('banks.unlinked', { bank: b.name }), 'info'); paint();
            }
          } }))))) : emptyState(t('home.noBank'), t('home.noBankHint')),
      h('div', { class: 'actions' }, btn(t('banks.link'), { ic: 'plus', href: '#/bank-link' })),
      h('p', { class: 'hint' }, t('banks.note')));
  };
  paint();
}

export function renderBankLink(root) {
  const TOTAL = 6;
  const st = { step: 1, bank: null, mobile: '', mobileMasked: '', account: null, primary: store.get().banks.length === 0, verified: false };
  const body = h('div', { class: 'stack' });
  const progress = h('progress', { max: TOTAL, value: 1, 'aria-label': t('bank.progress') });
  const stepLabel = h('p', { class: 'muted', role: 'status' });
  const heading = h('h2', { class: 'section-title', tabindex: '-1' });

  const go = (n) => { st.step = n; paint(true); };

  function accounts() {
    const seed = `${st.bank}|${st.mobile}`;
    return [{ kind: 'Savings', last4: last4(seed + 's') }, { kind: 'Current', last4: last4(seed + 'c') }];
  }

  function paint(focus) {
    progress.value = st.step;
    stepLabel.textContent = t('bank.step', { n: st.step, total: TOTAL });
    heading.textContent = t(`bank.s${st.step}.title`);
    body.replaceChildren();
    const next = (label, fn, disabled = false) => btn(label, { ic: 'check', onClick: fn, disabled });
    const back = st.step > 1 ? btn(t('common.back'), { ic: 'back', variant: 'ghost', size: 'md', onClick: () => go(st.step - 1) }) : null;

    if (st.step === 1) {
      body.append(h('p', { class: 'lede' }, t('bank.s1.body')),
        h('fieldset', { class: 'fieldset' }, h('legend', { class: 'visually-hidden' }, t('bank.s1.title')),
          BANKS.map((b) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'bank', value: b, checked: st.bank === b, on: { change: () => { st.bank = b; } } }), h('span', {}, b)))),
        next(t('common.continue'), () => { if (!st.bank) { a11y.say(t('bank.s1.pick'), { kind: 'warn', assertive: true }); return; } go(2); }));
    } else if (st.step === 2) {
      const mob = field({ label: t('bank.s2.label'), id: 'mob', inputmode: 'tel', maxlength: 10, hint: t('bank.s2.hint'), value: st.mobile });
      body.append(mob.el, next(t('common.continue'), () => {
        const v = mob.input.value.trim();
        if (!/^[6-9]\d{9}$/.test(v)) { mob.setError(t('person.errPhone')); mob.input.focus(); a11y.feedback('error'); return; }
        st.mobile = v; st.mobileMasked = `••••••${v.slice(-4)}`; go(3);
      }));
    } else if (st.step === 3) {
      const status = h('p', { role: 'status', class: 'status' });
      const run = btn(t('bank.s3.run'), { ic: 'shield', onClick: async () => {
        run.disabled = true;
        status.textContent = t('bank.s3.working'); a11y.announce(t('bank.s3.working'));
        await new Promise((r) => setTimeout(r, 1300));
        st.verified = true; status.textContent = t('bank.s3.done'); a11y.say(t('bank.s3.done'));
        a11y.haptic('confirm');
        setTimeout(() => go(4), 700);
      } });
      body.append(h('p', { class: 'lede' }, t('bank.s3.body', { mobile: st.mobileMasked })), h('div', { class: 'callout' }, icon('shield', 24), h('p', {}, t('bank.s3.noOtp'))), status, run);
    } else if (st.step === 4) {
      const accs = accounts();
      body.append(h('p', { class: 'lede' }, t('bank.s4.body', { bank: st.bank })),
        h('fieldset', { class: 'fieldset' }, h('legend', { class: 'visually-hidden' }, t('bank.s4.title')),
          accs.map((a) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'acc', value: a.last4, checked: st.account?.last4 === a.last4, on: { change: () => { st.account = a; } } }), h('span', {}, `${a.kind} •••• ${a.last4}`)))),
        next(t('common.continue'), () => { if (!st.account) { a11y.say(t('bank.s4.pick'), { kind: 'warn', assertive: true }); return; } go(5); }));
    } else if (st.step === 5) {
      body.append(h('p', { class: 'lede' }, t('bank.s5.body')),
        h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: st.primary, on: { change: (e) => { st.primary = e.target.checked; } } }), h('span', {}, t('bank.s5.primary'))),
        next(t('common.continue'), () => go(6)));
    } else {
      const seed = `${st.bank}|${st.mobile}|${st.account.last4}`;
      body.append(h('div', { class: 'card' }, h('dl', { class: 'kv' },
        h('dt', {}, t('bank.s6.bank')), h('dd', {}, st.bank), h('dt', {}, t('bank.s6.account')), h('dd', {}, `${st.account.kind} •••• ${st.account.last4}`),
        h('dt', {}, t('bank.s6.mobile')), h('dd', {}, st.mobileMasked), h('dt', {}, t('banks.primary')), h('dd', {}, st.primary ? t('common.yes') : t('common.no')))),
        h('p', { class: 'hint' }, t('bank.s6.note')),
        next(t('bank.s6.finish'), () => {
          const rec = store.addBank({ name: st.bank, masked: `•••• ${st.account.last4}`, kind: st.account.kind, balance: mockBalance(seed), primary: st.primary });
          a11y.feedback('success');
          a11y.say(t('bank.s6.done', { bank: rec.name }), { kind: 'success' });
          navigate('#/banks');
        }));
    }
    body.append(back);
    a11y.announce(`${stepLabel.textContent}. ${heading.textContent}`);
    if (focus) heading.focus();
  }

  root.append(pageHeader(t('bank.title')), simBanner(true), progress, stepLabel, heading, body);
  paint(false);
}
