// Monthly expense insights screen. Every figure is shown as text and a bar, never colour alone.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import { computeInsights } from '../insights.js';
import { h, icon, t, btn, simBanner, pageHeader, card, formatINR, spokenINR, emptyState } from '../ui.js';
import { lang } from '../i18n.js';

const monthName = (ts) => new Intl.DateTimeFormat(lang() === 'ta' ? 'ta-IN' : 'en-IN', { month: 'long', year: 'numeric' }).format(new Date(ts));

function summaryText(s) {
  let text = t('insights.say', { month: monthName(s.monthStart), total: spokenINR(s.total), count: s.count });
  if (s.changePct !== null) text += ' ' + t(`insights.say.${s.direction}`, { pct: Math.abs(s.changePct), prev: spokenINR(s.prevTotal) });
  if (s.categories[0]) text += ' ' + t('insights.sayTop', { cat: t('method.' + s.categories[0].method), amount: spokenINR(s.categories[0].amount) });
  return text;
}

export function renderInsights(root) {
  const s = computeInsights(store.get().transactions, new Date());
  if (!s.count && !s.prevTotal) {
    root.append(pageHeader(t('insights.title')), simBanner(true), emptyState(t('insights.none'), t('insights.noneHint'), btn(t('home.voice'), { ic: 'mic', href: '#/voice' })));
    return;
  }

  const change = s.changePct === null ? h('p', { class: 'muted' }, t('insights.noBaseline'))
    : h('p', { class: `insight-change insight-${s.direction}` }, icon(s.direction === 'up' ? 'alert' : 'check', 22),
      h('span', {}, t(`insights.${s.direction}`, { pct: Math.abs(s.changePct), prev: formatINR(s.prevTotal) })));

  const bars = h('ul', { class: 'bars', 'aria-label': t('insights.byType') }, s.categories.map((c) => {
    const pct = Math.max(2, Math.round(c.share * 100));
    const bar = h('span', { class: 'bar-fill', 'aria-hidden': 'true' });
    bar.style.setProperty('--w', `${pct}%`);
    return h('li', { class: 'bar-row' },
      h('div', { class: 'bar-head' }, h('span', { class: 'row-title' }, t('method.' + c.method)), h('span', { class: 'row-trailing' }, `${formatINR(c.amount)} · ${Math.round(c.share * 100)}%`)),
      h('span', { class: 'bar-track' }, bar));
  }));

  root.append(pageHeader(t('insights.title'), { sub: monthName(s.monthStart) }), simBanner(true),
    card(h('h2', { class: 'section-title' }, t('insights.spent')), h('p', { class: 'balance-amount' }, formatINR(s.total)),
      h('p', { class: 'muted' }, t('insights.stats', { count: s.count, avg: formatINR(s.average) })), change),
    s.categories.length ? card(h('h2', { class: 'section-title' }, t('insights.byType')), bars) : null,
    s.topPayees.length ? card(h('h2', { class: 'section-title' }, t('insights.top')),
      h('ol', { class: 'list-plain stack' }, s.topPayees.map((p) => h('li', { class: 'row' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-trailing' }, formatINR(p.amount)))))) : null,
    card(h('h2', { class: 'section-title' }, t('insights.compare')),
      h('dl', { class: 'kv' }, h('dt', {}, monthName(s.monthStart)), h('dd', {}, formatINR(s.total)), h('dt', {}, monthName(s.prevMonthStart)), h('dd', {}, formatINR(s.prevTotal)))),
    h('div', { class: 'actions' }, btn(t('insights.read'), { ic: 'volume', onClick: () => a11y.say(summaryText(s)) }), btn(t('history.title'), { ic: 'clock', variant: 'secondary', href: '#/history' })),
    h('p', { class: 'hint' }, t('insights.note')));
  a11y.say(summaryText(s));
}
