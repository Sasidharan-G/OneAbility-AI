// Settings (F13), onboarding, and help.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import { hapticsSupported, speechSupported } from '../a11y.js';
import { voiceSupported } from '../voice.js';
import { h, icon, t, btn, simBanner, pageHeader, field, switchRow, confirmDialog, toast, navigate, card } from '../ui.js';

const set = (k, v) => { store.setSetting(k, v); };

function radioGroup(legend, name, options, current, onPick) {
  return h('fieldset', { class: 'fieldset' }, h('legend', {}, legend),
    options.map(([value, label]) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name, value: String(value), id: `${name}-${value}`, checked: String(current) === String(value), on: { change: () => onPick(value) } }), h('span', {}, label))));
}

function group(id, title, ...kids) {
  return h('section', { class: 'card settings-group', 'aria-labelledby': `sg-${id}` }, h('h2', { id: `sg-${id}`, class: 'section-title' }, title), ...kids);
}

function range({ id, label, min, max, step, value, fmt, onChange }) {
  const out = h('output', { for: id, class: 'range-out' }, fmt(value));
  const input = h('input', { type: 'range', id, min, max, step, value, class: 'range', 'aria-valuetext': fmt(value),
    on: { input: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); e.target.setAttribute('aria-valuetext', fmt(v)); }, change: (e) => onChange(Number(e.target.value)) } });
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), h('div', { class: 'range-row' }, input, out));
}

export function renderSettings(root) {
  const s = store.get().settings;
  const p = store.get().profile;

  const name = field({ label: t('set.name'), id: 'set-name', value: p.name, maxlength: 30 });
  const nick = field({ label: t('set.nick'), id: 'set-nick', value: p.nickname, maxlength: 20, hint: t('set.nickHint') });
  name.input.addEventListener('change', () => { const v = name.input.value.trim(); if (v.length >= 2) store.setProfile({ name: v }); else name.setError(t('person.errName')); });
  nick.input.addEventListener('change', () => store.setProfile({ nickname: nick.input.value.trim() }));

  const voiceSelect = h('select', { id: 'set-voice', class: 'input', on: { change: (e) => set('voiceURI', e.target.value) } });
  const fillVoices = () => {
    if (!speechSupported()) return;
    const langPrefix = s.language === 'ta' ? 'ta' : 'en';
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
    voiceSelect.replaceChildren(h('option', { value: '' }, t('set.voiceAuto')), ...vs.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.voiceURI }, `${v.name} (${v.lang})`)));
  };
  fillVoices();
  if (speechSupported()) speechSynthesis.addEventListener('voiceschanged', fillVoices);

  const highAmt = field({ label: t('set.highAmount'), id: 'set-high', inputmode: 'numeric', value: String(s.highAmount), hint: t('set.highAmountHint'), maxlength: 6 });
  highAmt.input.addEventListener('change', () => {
    const v = Number(highAmt.input.value);
    if (!Number.isInteger(v) || v < 100 || v > 100000) { highAmt.setError(t('set.highAmountErr')); return; }
    highAmt.setError(''); set('highAmount', v);
  });

  root.append(pageHeader(t('set.title'), { back: true }), simBanner(true),
    group('profile', t('set.profile'), name.el, nick.el),
    group('lang', t('set.langVoice'),
      radioGroup(t('set.uiLang'), 'language', [['en', 'English'], ['ta', 'தமிழ்']], s.language, (v) => { set('language', v); }),
      radioGroup(t('set.listenLang'), 'listenLang', [['en-IN', t('set.listenEn')], ['ta-IN', 'தமிழ் (ta-IN)']], s.listenLang, (v) => set('listenLang', v)),
      voiceSupported() ? null : h('p', { class: 'hint' }, t('voice.unsupportedHint')),
      switchRow({ label: t('set.speech'), hint: speechSupported() ? t('set.speechHint') : t('set.speechNone'), checked: s.speech, onChange: (v) => { set('speech', v); if (!v) a11y.stopSpeaking(); } }),
      range({ id: 'set-rate', label: t('set.rate'), min: 0.6, max: 1.4, step: 0.1, value: s.speechRate, fmt: (v) => `${v.toFixed(1)}×`, onChange: (v) => set('speechRate', v) }),
      speechSupported() ? h('div', { class: 'field' }, h('label', { class: 'label', for: 'set-voice' }, t('set.voice')), voiceSelect) : null,
      btn(t('set.testVoice'), { ic: 'volume', variant: 'secondary', size: 'md', onClick: () => a11y.say(t('set.testVoiceSay', { name: store.displayName() || '' })) })),
    group('look', t('set.appearance'),
      radioGroup(t('set.theme'), 'theme', [['system', t('set.themeSystem')], ['light', t('set.themeLight')], ['dark', t('set.themeDark')]], s.theme, (v) => set('theme', v)),
      switchRow({ label: t('set.contrast'), hint: t('set.contrastHint'), checked: s.contrast, onChange: (v) => set('contrast', v) }),
      radioGroup(t('set.textSize'), 'textScale', [[1, t('set.size1')], [1.25, t('set.size2')], [1.5, t('set.size3')], [1.75, t('set.size4')]], s.textScale, (v) => set('textScale', Number(v))),
      switchRow({ label: t('set.simple'), hint: t('set.simpleHint'), checked: s.simple, onChange: (v) => set('simple', v) })),
    group('feedback', t('set.feedback'),
      switchRow({ label: t('set.captions'), hint: t('set.captionsHint'), checked: s.captions, onChange: (v) => set('captions', v) }),
      switchRow({ label: t('set.haptics'), hint: hapticsSupported() ? t('set.hapticsHint') : t('set.hapticsNone'), checked: s.haptics, onChange: (v) => set('haptics', v) }),
      switchRow({ label: t('set.flash'), hint: t('set.flashHint'), checked: s.flash, onChange: (v) => set('flash', v) }),
      btn(t('set.testFeedback'), { ic: 'bolt', variant: 'secondary', size: 'md', onClick: () => { a11y.feedback('success'); a11y.say(t('set.testFeedbackSay'), { kind: 'success' }); } })),
    group('motor', t('set.motor'),
      switchRow({ label: t('set.dwell'), hint: t('set.dwellHint'), checked: s.dwell, onChange: (v) => set('dwell', v) }),
      range({ id: 'set-dwell', label: t('set.dwellTime'), min: 600, max: 3000, step: 200, value: s.dwellMs, fmt: (v) => `${(v / 1000).toFixed(1)} s`, onChange: (v) => set('dwellMs', v) })),
    group('safety', t('set.safety'),
      highAmt.el,
      switchRow({ label: t('set.authBalance'), hint: t('set.authBalanceHint'), checked: s.requireAuthForBalance, onChange: (v) => set('requireAuthForBalance', v) }),
      switchRow({ label: t('set.hideBalance'), checked: s.hideBalance, onChange: (v) => set('hideBalance', v) }),
      switchRow({ label: t('set.autoListen'), hint: t('set.autoListenHint'), checked: s.autoListenConfirm, onChange: (v) => set('autoListenConfirm', v) })),
    group('banks', t('set.banksSec'), btn(t('banks.title'), { ic: 'bank', variant: 'secondary', size: 'md', href: '#/banks' }), btn(t('people.title'), { ic: 'users', variant: 'secondary', size: 'md', href: '#/people' })),
    group('data', t('set.data'), h('p', { class: 'hint' }, t('set.dataHint')),
      btn(t('set.export'), { ic: 'download', variant: 'secondary', size: 'md', onClick: () => {
        const url = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }));
        const a = h('a', { href: url, download: 'oneability-demo-data.json' });
        document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        toast(t('set.exported'), 'success');
      } }),
      btn(t('set.reset'), { ic: 'trash', variant: 'danger', size: 'md', onClick: async () => {
        if (await confirmDialog({ title: t('set.resetTitle'), message: t('set.resetMsg'), confirmLabel: t('set.reset'), danger: true })) {
          store.resetDemo(); a11y.applySettings(); toast(t('set.resetDone'), 'info'); navigate('#/welcome');
        }
      } })),
    group('about', t('set.about'), h('p', {}, t('set.aboutBody')), h('p', { class: 'hint' }, `OneAbility AI 1.0 · ${t('sim.short')}`),
      btn(t('help.title'), { ic: 'help', variant: 'secondary', size: 'md', href: '#/help' })));

  return () => { if (speechSupported()) speechSynthesis.removeEventListener('voiceschanged', fillVoices); };
}

// ------------------------------------------------------------------ onboarding
export function renderWelcome(root) {
  const p = store.get().profile;
  const name = field({ label: t('welcome.name'), id: 'w-name', value: p.name, maxlength: 30, autocomplete: 'given-name', required: true });
  const nick = field({ label: t('welcome.nick'), id: 'w-nick', value: p.nickname, maxlength: 20, hint: t('set.nickHint') });
  const picks = { screenReader: false, lowVision: false, motor: false, hearing: false, simple: false };
  const needs = [
    ['screenReader', 'welcome.needSR', 'welcome.needSRHint'], ['lowVision', 'welcome.needLV', 'welcome.needLVHint'],
    ['hearing', 'welcome.needHH', 'welcome.needHHHint'], ['motor', 'welcome.needMotor', 'welcome.needMotorHint'], ['simple', 'welcome.needSimple', 'welcome.needSimpleHint'],
  ];

  const submit = (e) => {
    e.preventDefault();
    const n = name.input.value.trim();
    if (n.length < 2) { name.setError(t('person.errName')); name.input.focus(); a11y.feedback('error'); return; }
    store.update((s) => {
      s.profile.name = n; s.profile.nickname = nick.input.value.trim(); s.profile.onboarded = true;
      if (picks.screenReader) { s.settings.speech = false; s.settings.captions = true; }
      if (picks.lowVision) { s.settings.contrast = true; s.settings.textScale = 1.5; }
      if (picks.hearing) { s.settings.captions = true; s.settings.flash = true; s.settings.haptics = true; s.settings.speech = false; }
      if (picks.motor) { s.settings.dwell = true; s.settings.textScale = Math.max(s.settings.textScale, 1.25); }
      if (picks.simple) s.settings.simple = true;
    });
    a11y.applySettings();
    a11y.feedback('success');
    navigate('#/home');
  };

  root.append(h('header', { class: 'page-head' }, h('div', { class: 'page-head-text' }, h('h1', { tabindex: '-1' }, t('welcome.title')), h('p', { class: 'muted' }, t('welcome.sub')))),
    simBanner(),
    h('form', { class: 'stack', novalidate: true, on: { submit } },
      name.el, nick.el,
      radioGroup(t('set.uiLang'), 'language', [['en', 'English'], ['ta', 'தமிழ்']], store.get().settings.language, (v) => set('language', v)),
      h('fieldset', { class: 'fieldset' }, h('legend', {}, t('welcome.needs')), h('p', { class: 'hint' }, t('welcome.needsHint')),
        needs.map(([k, label, hint]) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', on: { change: (e) => { picks[k] = e.target.checked; } } }),
          h('span', {}, h('strong', {}, t(label)), h('br'), h('span', { class: 'hint' }, t(hint)))))),
      btn(t('welcome.start'), { type: 'submit', ic: 'check' })));
}

// ------------------------------------------------------------------ help
export function renderHelp(root) {
  const sections = ['pay', 'voice', 'keys', 'access', 'privacy', 'trouble'];
  root.append(pageHeader(t('help.title')), simBanner(),
    ...sections.map((k) => card(h('h2', { class: 'section-title' }, t(`help.${k}.title`)),
      h('ul', { class: 'bullets' }, t(`help.${k}.body`).split('\n').map((line) => h('li', {}, line))))),
    h('div', { class: 'actions' }, btn(t('common.home'), { ic: 'home', href: '#/home' })));
}
