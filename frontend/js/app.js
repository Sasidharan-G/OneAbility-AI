// OneAbility AI: app shell, hash router and boot sequence. Simulated payments only.
import * as store from './store.js';
import { loadLexicon } from './nlp.js';
import * as a11y from './a11y.js';
import * as pay from './payment.js';
import * as dex from './dex.js';
import { stopListening } from './voice.js';
import { t, lang } from './i18n.js';
import { h, clear, $ } from './dom.js';
import { icon } from './icons.js';
import { navigate, toast } from './ui.js';
import * as home from './screens/home.js';
import * as voiceScreen from './screens/voice.js';
import * as payScreens from './screens/pay.js';
import * as scan from './screens/scan.js';
import * as flow from './screens/flow.js';
import * as history from './screens/history.js';
import * as people from './screens/people.js';
import * as banks from './screens/banks.js';
import * as bills from './screens/bills.js';
import * as settings from './screens/settings.js';
import * as insights from './screens/insights.js';

const ROUTES = [
  [/^\/home$/, home.render],
  [/^\/balance$/, home.renderBalance],
  [/^\/voice$/, voiceScreen.render],
  [/^\/scan$/, scan.render],
  [/^\/contacts$/, payScreens.renderContacts],
  [/^\/upi$/, payScreens.renderUpi],
  [/^\/amount$/, payScreens.renderAmount],
  [/^\/review$/, flow.renderReview],
  [/^\/auth$/, flow.renderAuth],
  [/^\/result$/, flow.renderResult],
  [/^\/history$/, history.renderHistory],
  [/^\/txn\/(?<id>.+)$/, history.renderReceipt],
  [/^\/people$/, people.renderPeople],
  [/^\/person$/, people.renderPerson],
  [/^\/banks$/, banks.renderBanks],
  [/^\/bank-link$/, banks.renderBankLink],
  [/^\/bills$/, bills.renderBills],
  [/^\/insights$/, insights.renderInsights],
  [/^\/settings$/, settings.renderSettings],
  [/^\/welcome$/, settings.renderWelcome],
  [/^\/help$/, settings.renderHelp],
];

const NAV = [['#/home', 'home', 'nav.home'], ['#/voice', 'mic', 'nav.voice'], ['#/scan', 'scan', 'nav.scan'], ['#/history', 'clock', 'nav.history'], ['#/settings', 'settings', 'nav.settings']];

let cleanup = null;
let token = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/home';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

async function renderRoute(keepFocusId) {
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const { path, query } = parseHash();
  if (!store.get().profile.onboarded && path !== '/welcome' && path !== '/help') { navigate('#/welcome'); return; }

  const main = $('#app');
  clear(main);
  const root = h('div', { class: 'page' });
  main.append(root);

  let match = null;
  for (const [re, fn] of ROUTES) { const m = re.exec(path); if (m) { match = { fn, params: { ...(m.groups || {}) } }; break; } }
  if (!match) {
    root.append(h('h1', { tabindex: '-1' }, t('common.notFound')), h('a', { class: 'btn btn-primary btn-lg', href: '#/home' }, t('common.home')));
  } else {
    try {
      const ret = await match.fn(root, { params: match.params, query });
      if (my !== token) { if (typeof ret === 'function') ret(); return; }
      cleanup = typeof ret === 'function' ? ret : null;
    } catch (e) {
      console.error(e);
      clear(root);
      root.append(h('h1', { tabindex: '-1' }, t('common.errorTitle')), h('p', { class: 'lede' }, t('common.errorBody')), h('a', { class: 'btn btn-primary btn-lg', href: '#/home' }, t('common.home')));
    }
  }
  if (my !== token) return;
  markNav(path);
  document.documentElement.dataset.flow = ['/review', '/auth', '/result'].includes(path) ? 'on' : 'off';
  const heading = root.querySelector('h1');
  document.title = `${heading ? heading.textContent : 'OneAbility AI'} · OneAbility AI`;
  window.scrollTo(0, 0);
  const keep = keepFocusId && document.getElementById(keepFocusId);
  if (keep) keep.focus();
  else if (!root.contains(document.activeElement) || document.activeElement === document.body) a11y.focusHeading(root);
}

function markNav(path) {
  document.querySelectorAll('#nav a').forEach((a) => {
    const target = a.getAttribute('href').replace(/^#/, '');
    const on = path === target || (target === '/home' && ['/balance'].includes(path)) || (target === '/history' && path.startsWith('/txn'));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function buildShell() {
  const nav = $('#nav ul');
  clear(nav);
  NAV.forEach(([href, ic, key]) => nav.append(h('li', {}, h('a', { href, class: 'nav-link' }, icon(ic, 26), h('span', {}, t(key))))));
  const stop = $('#stop-btn');
  stop.replaceChildren(icon('stop', 24), h('span', {}, t('stop.label')));
  stop.setAttribute('aria-label', t('stop.aria'));
  const lb = $('#lang-btn');
  lb.textContent = lang() === 'ta' ? 'EN' : 'த';
  lb.setAttribute('aria-label', lang() === 'ta' ? 'Switch to English' : 'தமிழுக்கு மாறு');
  lb.setAttribute('lang', lang() === 'ta' ? 'en' : 'ta');
  const help = $('#help-link');
  help.setAttribute('aria-label', t('help.title'));
  help.replaceChildren(icon('help', 24));
  $('#skip-link').textContent = t('common.skip');
  $('#net-status').textContent = t('net.offline');
  $('#nav').setAttribute('aria-label', t('nav.label'));
  $('.caption-close').setAttribute('aria-label', t('common.close'));
  $('#captions').setAttribute('aria-label', t('captions.label'));
  const brand = $('#brand');
  brand.setAttribute('aria-label', t('nav.home'));
}

function emergencyStop() {
  a11y.stopSpeaking();
  stopListening();
  const stopped = pay.emergencyStop();
  dex.reset();
  a11y.feedback('warn');
  a11y.say(stopped ? t('stop.cancelled') : t('stop.safe'), { kind: 'warn', assertive: true });
  navigate('#/home');
}

function updateNet() {
  const off = !navigator.onLine;
  $('#net-status').hidden = !off;
  if (off) a11y.announce(t('net.offline'), true);
}

async function boot() {
  store.load();
  a11y.applySettings();
  buildShell();
  a11y.initDwell();

  let lastLang = lang();
  store.subscribe((s) => {
    a11y.applySettings();
    if (s.settings.language !== lastLang) {
      lastLang = s.settings.language;
      buildShell();
      const id = document.activeElement && document.activeElement.id;
      renderRoute(id);
    }
  });

  $('#skip-link').addEventListener('click', (e) => { e.preventDefault(); $('#main').focus(); });
  $('#stop-btn').addEventListener('click', emergencyStop);
  $('#lang-btn').addEventListener('click', () => store.setSetting('language', lang() === 'ta' ? 'en' : 'ta'));
  $('.caption-close').addEventListener('click', a11y.hideCaption);
  window.addEventListener('hashchange', () => renderRoute());
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  window.addEventListener('error', (e) => { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => a11y.applySettings());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]') && !location.hash.startsWith('#/review')) a11y.stopSpeaking(); });
  updateNet();

  try { await loadLexicon(); } catch (e) { console.error(e); toast(t('common.lexiconFail'), 'error'); }
  if (!location.hash) location.hash = '#/home';
  await renderRoute();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast(t('common.updateReady'), 'info'); });
      });
    }).catch((e) => console.warn('SW registration failed', e));
  }
}

boot();
