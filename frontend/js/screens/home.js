import * as store from '../store.js';
import * as a11y from '../a11y.js';
import { h, icon, t, btn, simBanner, formatINR, spokenINR, relativeDay, listRow, avatar, navigate, pageHeader, card, emptyState } from '../ui.js';

function greetingKey() {
  const hr = new Date().getHours();
  return hr < 12 ? 'home.morning' : hr < 17 ? 'home.afternoon' : 'home.evening';
}

function tile(ic, label, hint, href, { primary = false, adv = false } = {}) {
  return h('a', { class: `tile${primary ? ' tile-primary' : ''}${adv ? ' adv' : ''}`, href },
    h('span', { class: 'tile-icon' }, icon(ic, 34)), h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-hint' }, hint));
}

export function render(root) {
  const s = store.get();
  const name = store.displayName();
  const bank = store.primaryBank();
  let revealed = !s.settings.hideBalance;

  const amountEl = h('p', { class: 'balance-amount', 'aria-live': 'off' });
  const toggle = h('button', { type: 'button', class: 'btn btn-ghost btn-md', 'aria-pressed': String(revealed) });
  const paint = () => {
    amountEl.textContent = bank ? (revealed ? formatINR(bank.balance) : '₹ ••••••') : '—';
    toggle.replaceChildren(icon('eye', 22), h('span', { class: 'btn-label' }, revealed ? t('home.hide') : t('home.show')));
    toggle.setAttribute('aria-pressed', String(revealed));
  };
  toggle.addEventListener('click', () => { revealed = !revealed; paint(); a11y.announce(revealed ? t('home.balanceShown') : t('home.balanceHidden')); });
  paint();

  const balanceCard = h('section', { class: 'balance-card', 'aria-labelledby': 'bal-h' },
    h('h2', { id: 'bal-h', class: 'balance-title' }, bank ? t('home.balanceOf', { bank: `${bank.name} ${bank.masked}` }) : t('home.noBank')),
    bank ? amountEl : h('p', { class: 'muted' }, t('home.noBankHint')),
    h('div', { class: 'balance-actions' },
      bank ? toggle : null,
      bank ? btn(t('home.hearBalance'), { ic: 'volume', variant: 'secondary', size: 'md', href: '#/balance' }) : btn(t('banks.link'), { ic: 'bank', href: '#/bank-link', size: 'md' })));

  const favs = s.beneficiaries.filter((b) => b.favorite).slice(0, 6);
  const favRow = favs.length ? h('section', { class: 'adv', 'aria-labelledby': 'fav-h' },
    h('h2', { id: 'fav-h', class: 'section-title' }, t('home.quickPay')),
    h('ul', { class: 'fav-row' }, favs.map((b) => h('li', {}, h('a', { class: 'fav', href: `#/amount?to=${encodeURIComponent(b.id)}`, 'aria-label': t('home.payTo', { name: b.name }) }, avatar(b.name), h('span', {}, b.name.split(' ')[0])))))) : null;

  const recent = store.recentTransactions(3);
  const recentBlock = h('section', { 'aria-labelledby': 'rec-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'rec-h', class: 'section-title' }, t('home.recent')), h('a', { href: '#/history', class: 'link' }, t('home.seeAll'))),
    recent.length ? h('ul', { class: 'list' }, recent.map((tx) => h('li', {}, listRow({
      title: tx.recipient, sub: `${relativeDay(tx.ts)} · ${t('method.' + tx.method)}`, ic: undefined,
      trailing: h('span', { class: 'amount-out' }, `− ${formatINR(tx.amount)}`), href: `#/txn/${encodeURIComponent(tx.id)}`,
      label: t('history.rowLabel', { name: tx.recipient, amount: spokenINR(tx.amount), when: relativeDay(tx.ts) }),
    })))) : emptyState(t('history.empty'), t('history.emptyHint')));

  root.append(
    h('header', { class: 'home-head' },
      h('p', { class: 'muted' }, t(greetingKey())),
      h('h1', { tabindex: '-1' }, name ? t('home.hello', { name }) : t('home.helloAnon'))),
    simBanner(),
    balanceCard,
    h('section', { 'aria-labelledby': 'act-h' },
      h('h2', { id: 'act-h', class: 'section-title' }, t('home.actions')),
      h('div', { class: 'tiles' },
        tile('mic', t('home.voice'), t('home.voiceHint'), '#/voice', { primary: true }),
        tile('scan', t('home.scan'), t('home.scanHint'), '#/scan'),
        tile('user', t('home.contact'), t('home.contactHint'), '#/contacts'),
        tile('at', t('home.upi'), t('home.upiHint'), '#/upi', { adv: true }),
        tile('bolt', t('home.bills'), t('home.billsHint'), '#/bills', { adv: true }),
        tile('clock', t('home.history'), t('home.historyHint'), '#/history'),
        tile('wallet', t('home.balance'), t('home.balanceHint'), '#/balance'),
        tile('chart', t('home.insights'), t('home.insightsHint'), '#/insights', { adv: true }))),
    favRow,
    recentBlock,
  );
}

export async function renderBalance(root) {
  const s = store.get();
  if (s.settings.requireAuthForBalance && !store.recentlyAuthed()) { navigate('#/auth?purpose=balance'); return undefined; }
  const banks = s.banks;
  const primary = store.primaryBank();
  const say = () => a11y.say(primary
    ? t('balance.say', { bank: primary.name, amount: spokenINR(primary.balance) })
    : t('home.noBankHint'));
  root.append(
    pageHeader(t('balance.title')), simBanner(true),
    banks.length ? h('div', {}, banks.map((b) => card(
      h('h2', { class: 'section-title' }, `${b.name} ${b.masked}`, b.primary ? h('span', { class: 'badge' }, t('banks.primary')) : null),
      h('p', { class: 'balance-amount' }, formatINR(b.balance)),
      h('p', { class: 'muted' }, t('balance.mock'))))) : emptyState(t('home.noBank'), t('home.noBankHint'), btn(t('banks.link'), { ic: 'bank', href: '#/bank-link' })),
    h('div', { class: 'actions' }, btn(t('balance.readAgain'), { ic: 'volume', variant: 'secondary', onClick: say }), btn(t('common.home'), { ic: 'home', href: '#/home', variant: 'ghost' })));
  say();
  return undefined;
}
