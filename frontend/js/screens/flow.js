// Review (Yes/No gate, SEC-04), authorization (SEC-05) and result screens.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import * as pay from '../payment.js';
import * as auth from '../auth.js';
import { parseConfirmation } from '../nlp.js';
import { listen, stopListening, voiceSupported } from '../voice.js';
import { h, icon, t, btn, simBanner, pageHeader, warningsBlock, formatINR, spokenINR, formatDateTime, navigate, avatar, toast } from '../ui.js';

const lang = () => (store.get().settings.language === 'ta' ? 'ta' : 'en');
const wtext = (w) => (lang() === 'ta' ? w.message_ta : w.message_en);
const bankOf = (d) => (d.bank_id ? store.bankById(d.bank_id) : store.primaryBank());

function readback(f) {
  const d = f.draft;
  const bank = bankOf(d);
  let text = t('review.readback', { amount: spokenINR(Number(d.amount)), name: d.recipient_name, upi: (d.upi_id || '').replace('@', ` ${t('common.at')} `), bank: bank ? bank.name : '' });
  if (f.guard.warnings.length) text += ' ' + f.guard.warnings.map(wtext).join(' ');
  text += ' ' + (f.guard.blocked ? t('review.blockedSay') : t('review.ask'));
  return text;
}

// ================================================================= REVIEW
export function renderReview(root) {
  const f = pay.getCurrent();
  if (!f || pay.TERMINAL.has(f.state) || f.state === 'processing') { navigate('#/home'); return undefined; }
  if (f.state === 'awaiting_auth') { navigate('#/auth?purpose=payment'); return undefined; }
  const d = f.draft;
  const bank = bankOf(d);
  let asking = false;
  let retries = 0;

  const ack = f.guard.needs_ack ? h('label', { class: 'choice ack' }, h('input', { type: 'checkbox', id: 'ack' }), h('span', {}, t('review.ack'))) : null;
  const ackErr = h('p', { class: 'field-error', role: 'alert', hidden: true }, t('review.ackNeeded'));

  const yes = btn(t('review.yes'), { ic: 'check', variant: 'success', disabled: f.guard.blocked, id: 'btn-yes', onClick: () => onYes(false) });
  const no = btn(t('review.no'), { ic: 'x', variant: 'danger', id: 'btn-no', onClick: () => onNo() });
  const fix = f.guard.blocked ? btn(t('review.fix'), { ic: 'back', variant: 'secondary', onClick: () => { pay.decide('no'); history.back(); } }) : null;

  function onYes(viaVoice) {
    const acknowledged = viaVoice ? true : !!(ack && ack.querySelector('input').checked);
    const r = pay.decide('yes', { acknowledged });
    if (!r.ok) {
      if (r.reason === 'ack_required') { ackErr.hidden = false; ack.querySelector('input').focus(); a11y.feedback('warn'); a11y.say(t('review.ackNeeded'), { assertive: true, kind: 'warn' }); }
      return;
    }
    a11y.stopSpeaking(); stopListening();
    a11y.haptic('confirm');
    navigate('#/auth?purpose=payment');
  }

  function onNo() {
    a11y.stopSpeaking(); stopListening();
    pay.decide('no');
    a11y.feedback('warn');
    a11y.say(t('review.cancelled'), { kind: 'warn' });
    toast(t('review.cancelled'), 'info');
    navigate('#/home');
  }

  async function askByVoice() {
    if (asking || !voiceSupported()) return;
    asking = true;
    listenBtn?.setAttribute('aria-pressed', 'true');
    a11y.stopSpeaking(); a11y.haptic('listen'); a11y.announce(t('voice.listening'));
    const r = await listen({ lang: store.get().settings.listenLang });
    asking = false;
    listenBtn?.setAttribute('aria-pressed', 'false');
    if (!r.text) { a11y.say(t('review.noAnswer'), { kind: 'warn' }); return; }
    const answer = parseConfirmation(r.text);
    if (answer === 'yes' && !f.guard.blocked) return onYes(true);
    if (answer === 'yes' && f.guard.blocked) { a11y.say(t('review.blockedSay'), { kind: 'warn' }); return; }
    if (answer === 'no') return onNo();
    retries += 1;
    a11y.feedback('warn');
    await a11y.say(t('review.unclear'), { kind: 'warn' });
    if (retries < 3) askByVoice();
  }

  const listenBtn = voiceSupported() ? btn(t('review.answerVoice'), { ic: 'mic', variant: 'secondary', size: 'md', aria: { 'aria-pressed': 'false' }, onClick: askByVoice }) : null;
  const again = btn(t('review.readAgain'), { ic: 'volume', variant: 'ghost', size: 'md', onClick: () => a11y.say(readback(f), { kind: f.guard.warnings.length ? 'warn' : 'info' }) });

  root.append(
    pageHeader(t('review.title'), { back: false }), simBanner(),
    h('section', { class: 'card review-card', 'aria-labelledby': 'rv-h' },
      h('h2', { id: 'rv-h', class: 'visually-hidden' }, t('review.details')),
      h('div', { class: 'payee-card' }, avatar(d.recipient_name), h('div', {}, h('p', { class: 'row-title' }, d.recipient_name), h('p', { class: 'muted' }, d.upi_id || '—'))),
      h('p', { class: 'review-amount', 'aria-label': t('review.amountLabel', { amount: spokenINR(Number(d.amount)) }) }, formatINR(Number(d.amount))),
      h('dl', { class: 'kv' },
        h('dt', {}, t('review.to')), h('dd', {}, d.recipient_name),
        h('dt', {}, t('review.upi')), h('dd', {}, d.upi_id || '—'),
        h('dt', {}, t('review.from')), h('dd', {}, bank ? `${bank.name} ${bank.masked}` : '—'),
        h('dt', {}, t('review.method')), h('dd', {}, t('method.' + d.method)),
        d.note ? [h('dt', {}, t('review.note')), h('dd', {}, d.note)] : null)),
    warningsBlock(f.guard.warnings), ack, ackErr,
    h('div', { class: 'actions actions-split' }, yes, no), fix, listenBtn, again,
    h('p', { class: 'hint' }, t('review.simNote')));

  const unsub = pay.subscribe((cur) => { if (cur !== f || pay.TERMINAL.has(cur.state)) { /* leaving */ } });
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onNo(); };
  document.addEventListener('keydown', onKey);

  // Read back on entry (F05). Voice-initiated flows then listen for Yes/No if speech actually played.
  a11y.feedback(f.guard.blocked ? 'error' : f.guard.warnings.length ? 'warn' : 'confirm');
  a11y.say(readback(f), { kind: f.guard.warnings.length ? 'warn' : 'info', assertive: f.guard.blocked }).then((spoke) => {
    if (spoke && d.method === 'voice' && !f.guard.blocked && store.get().settings.autoListenConfirm && voiceSupported() && pay.getCurrent() === f && f.state === 'awaiting_confirmation') askByVoice();
  });
  return () => { unsub(); document.removeEventListener('keydown', onKey); stopListening(); };
}

// ================================================================= AUTH
export function renderAuth(root, { query }) {
  const purpose = query.get('purpose') === 'balance' ? 'balance' : 'payment';
  const f = pay.getCurrent();
  if (purpose === 'payment' && (!f || f.state !== 'awaiting_auth')) { navigate(f && f.state === 'awaiting_confirmation' ? '#/review' : '#/home'); return undefined; }

  const status = h('p', { class: 'status', role: 'status' }, '');
  const actions = h('div', { class: 'actions' });
  let busy = false;

  const setBusy = (b) => { busy = b; actions.querySelectorAll('button').forEach((x) => { x.disabled = b; }); root.setAttribute('aria-busy', String(b)); };

  async function finish(res) {
    if (purpose === 'balance') { a11y.feedback('success'); navigate('#/balance'); return; }
    status.textContent = t('auth.processing');
    a11y.announce(t('auth.processing'));
    const r = await pay.execute(res);
    if (r.ok) { navigate('#/result'); return; }
    setBusy(false);
    if (r.reason === 'server_rejected' || r.reason === 'error') { navigate('#/result'); return; }
    a11y.say(t('auth.cannotProcess'), { kind: 'error', assertive: true });
  }

  async function device() {
    if (busy) return;
    setBusy(true);
    status.textContent = t('auth.waiting');
    a11y.say(t('auth.waiting'), { kind: 'info' });
    const res = await auth.authorizeWithDevice();
    if (res.ok) return finish(res);
    setBusy(false);
    a11y.feedback('warn');
    const key = res.reason === 'cancelled' ? 'auth.cancelled' : res.reason === 'unsupported' ? 'auth.unsupported' : 'auth.failed';
    status.textContent = t(key);
    a11y.say(t(key), { kind: 'warn', assertive: true });
    return undefined;
  }

  async function demo() {
    if (busy) return;
    setBusy(true);
    a11y.haptic('confirm');
    return finish(auth.authorizeDemo());
  }

  function cancel() {
    a11y.stopSpeaking();
    if (purpose === 'payment') pay.decide('no');
    a11y.say(t('review.cancelled'), { kind: 'warn' });
    navigate('#/home');
  }

  const summary = purpose === 'payment' && f ? h('div', { class: 'card' },
    h('p', { class: 'review-amount' }, formatINR(Number(f.draft.amount))),
    h('p', { class: 'muted center' }, t('auth.to', { name: f.draft.recipient_name }))) : h('p', { class: 'lede' }, t('auth.balanceWhy'));

  root.append(pageHeader(t(purpose === 'balance' ? 'auth.titleBalance' : 'auth.title'), { back: false }), simBanner(), summary,
    h('p', { class: 'lede' }, t('auth.explain')), status, actions,
    h('div', { class: 'callout' }, icon('shield', 24), h('p', {}, t('auth.privacy'))));

  auth.webauthnAvailable().then((ok) => {
    actions.replaceChildren(
      ok ? btn(t('auth.device'), { ic: 'fingerprint', onClick: device }) : null,
      btn(t('auth.demo'), { ic: 'check', variant: ok ? 'secondary' : 'primary', onClick: demo, describedby: 'demo-note' }),
      btn(t('common.cancel'), { ic: 'x', variant: 'ghost', onClick: cancel }));
    const note = h('p', { id: 'demo-note', class: 'hint' }, ok ? t('auth.demoNote') : t('auth.unsupported') + ' ' + t('auth.demoNote'));
    actions.after(note);
    a11y.say(ok ? t('auth.sayDevice') : t('auth.sayDemo'), { kind: 'info' });
  });
  return () => {};
}

// ================================================================= RESULT
export function renderResult(root) {
  const f = pay.getCurrent();
  if (!f || (f.state !== 'success' && f.state !== 'failed')) { navigate('#/home'); return undefined; }

  if (f.state === 'failed') {
    a11y.feedback('error');
    a11y.say(t('result.failedSay'), { kind: 'error', assertive: true });
    root.append(pageHeader(t('result.failedTitle'), { back: false }), simBanner(),
      h('div', { class: 'result result-fail' }, icon('alert', 64), h('p', { class: 'lede' }, t('result.failedBody')),
        h('p', { class: 'muted' }, t('result.noMoney'))),
      h('div', { class: 'actions' }, btn(t('common.home'), { ic: 'home', href: '#/home' })));
    return () => pay.resetFlow();
  }

  const txn = f.result.txn;
  const bank = txn.bankId ? store.bankById(txn.bankId) : null;
  a11y.feedback('success');
  a11y.say(t('result.say', { amount: spokenINR(txn.amount), name: txn.recipient, balance: bank ? spokenINR(bank.balance) : '' }), { kind: 'success' });

  root.append(pageHeader(t('result.title'), { back: false }), simBanner(),
    h('div', { class: 'result result-ok' },
      h('span', { class: 'result-icon' }, icon('check', 64)),
      h('p', { class: 'review-amount' }, formatINR(txn.amount)),
      h('p', { class: 'lede' }, t('result.to', { name: txn.recipient })),
      h('dl', { class: 'kv' },
        h('dt', {}, t('receipt.id')), h('dd', {}, txn.id),
        h('dt', {}, t('receipt.when')), h('dd', {}, formatDateTime(txn.ts)),
        h('dt', {}, t('receipt.auth')), h('dd', {}, txn.authLabel),
        bank ? [h('dt', {}, t('result.newBalance')), h('dd', {}, formatINR(bank.balance))] : null)),
    h('div', { class: 'actions' },
      btn(t('result.receipt'), { ic: 'receipt', href: `#/txn/${encodeURIComponent(txn.id)}` }),
      btn(t('common.home'), { ic: 'home', variant: 'secondary', href: '#/home' })),
    h('p', { class: 'hint' }, t('result.noReal')));
  return () => pay.resetFlow();
}
