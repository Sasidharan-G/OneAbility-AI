// Dex voice assistant screen (F01, F02, F03). Mic, typed fallback, captions, suggestions.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import * as dex from '../dex.js';
import { listen, stopListening, voiceSupported } from '../voice.js';
import { h, icon, t, btn, simBanner, pageHeader, field } from '../ui.js';

let greeted = false;

export function render(root) {
  const supported = voiceSupported();
  let listening = false;

  const logEl = h('ul', { class: 'chat', 'aria-label': t('voice.log'), 'aria-live': 'off' });
  const interim = h('p', { class: 'interim muted', 'aria-hidden': 'true' });
  const status = h('p', { class: 'mic-status', role: 'status' }, supported ? t('voice.tapMic') : t('voice.unsupported'));

  const mic = h('button', { type: 'button', class: 'mic', disabled: !supported, 'aria-pressed': 'false', 'aria-label': t('voice.micStart') },
    icon('mic', 56), h('span', { class: 'mic-label' }, t('voice.speak')));

  const paintLog = () => {
    logEl.replaceChildren(...dex.log.slice(-12).map((m) => h('li', { class: `bubble bubble-${m.role} ${m.kind ? 'kind-' + m.kind : ''}` },
      h('span', { class: 'bubble-who' }, m.role === 'dex' ? 'Dex' : t('voice.you')), h('span', { class: 'bubble-text' }, m.text))));
    logEl.lastElementChild?.scrollIntoView({ block: 'nearest' });
  };

  const setListening = (on) => {
    listening = on;
    mic.setAttribute('aria-pressed', String(on));
    mic.setAttribute('aria-label', on ? t('voice.micStop') : t('voice.micStart'));
    mic.classList.toggle('is-listening', on);
    mic.querySelector('.mic-label').textContent = on ? t('voice.listening') : t('voice.speak');
    status.textContent = on ? t('voice.listening') : (supported ? t('voice.tapMic') : t('voice.unsupported'));
  };

  async function toggleMic() {
    if (listening) { stopListening(); return; }
    a11y.stopSpeaking();
    a11y.haptic('listen');
    setListening(true);
    a11y.announce(t('voice.listening'));
    const r = await listen({ lang: store.get().settings.listenLang, onInterim: (txt) => { interim.textContent = txt; } });
    setListening(false);
    interim.textContent = '';
    if (r.text) { await dex.handle(r.text); return; }
    const msg = { 'not-allowed': 'voice.errDenied', 'service-not-allowed': 'voice.errDenied', 'no-speech': 'voice.errNoSpeech', network: 'voice.errNetwork', 'audio-capture': 'voice.errNoMic', unsupported: 'voice.unsupported' }[r.error];
    if (r.error !== 'aborted') { a11y.feedback('warn'); dex.dexSay(t(msg || 'voice.errGeneric'), { kind: 'warn' }); }
  }
  mic.addEventListener('click', toggleMic);

  const text = field({ label: t('voice.typeLabel'), id: 'say-input', hint: t('voice.typeHint'), maxlength: 200 });
  const form = h('form', { class: 'type-form', on: { submit: (e) => { e.preventDefault(); const v = text.input.value.trim(); if (v) { text.input.value = ''; dex.handle(v); } } } },
    text.el, btn(t('voice.send'), { type: 'submit', ic: 'check', size: 'md', variant: 'secondary' }));

  const chips = h('ul', { class: 'chips', 'aria-label': t('voice.try') },
    ['voice.ex1', 'voice.ex2', 'voice.ex3', 'voice.ex4'].map((k) => h('li', {}, h('button', { type: 'button', class: 'chip', on: { click: () => dex.handle(t(k)) } }, t(k)))));

  root.append(
    pageHeader('Dex', { sub: t('voice.sub') }), simBanner(true),
    h('div', { class: 'voice-stage' }, mic, status, interim),
    logEl, form, h('section', {}, h('h2', { class: 'section-title' }, t('voice.try')), chips),
    h('p', { class: 'hint' }, supported ? t('voice.privacy') : t('voice.unsupportedHint')));

  const unsub = dex.subscribe(paintLog);
  paintLog();

  const onKey = (e) => {
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(input|textarea|select)$/i.test(document.activeElement?.tagName || '') && supported) { e.preventDefault(); toggleMic(); }
  };
  document.addEventListener('keydown', onKey);

  if (!greeted) { greeted = true; dex.dexSay(`${dex.greet()} ${t('voice.tapMic')}`); }
  return () => { unsub(); document.removeEventListener('keydown', onKey); stopListening(); };
}
