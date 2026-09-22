// Accessibility services: live announcements, captions, speech output, haptics, flash cues, dwell click.
import * as store from './store.js';

const $id = (id) => document.getElementById(id);
const settings = () => store.get().settings;
const synth = () => (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);
let captionTimer = null;

export const speechSupported = () => !!synth() && typeof SpeechSynthesisUtterance !== 'undefined';
export const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// ------------------------------------------------------------ settings -> DOM
export function applySettings() {
  const s = settings();
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.contrast = s.contrast ? 'high' : 'normal';
  root.dataset.simple = s.simple ? 'on' : 'off';
  root.dataset.dwell = s.dwell ? 'on' : 'off';
  root.style.setProperty('--scale', String(s.textScale));
  root.style.setProperty('--dwell-ms', `${s.dwellMs}ms`);
  root.lang = s.language === 'ta' ? 'ta' : 'en';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', s.contrast ? (dark ? '#000000' : '#ffffff') : dark ? '#0f172a' : '#0b5fff');
}

// ------------------------------------------------------------ live regions
export function announce(text, assertive = false) {
  const el = $id(assertive ? 'live-assertive' : 'live-polite');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

// ------------------------------------------------------------ captions (A11Y-07)
export function caption(text, kind = 'info') {
  const s = settings();
  const box = $id('captions');
  if (!box) return;
  clearTimeout(captionTimer);
  if (!s.captions) { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.kind = kind;
  const body = box.querySelector('.caption-text');
  if (body) body.textContent = text;
  captionTimer = setTimeout(() => { box.hidden = true; }, Math.max(6000, text.length * 90));
}

export function hideCaption() { clearTimeout(captionTimer); const b = $id('captions'); if (b) b.hidden = true; }

// ------------------------------------------------------------ speech output (F03)
function pickVoice(lang) {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices();
  const uri = settings().voiceURI;
  const chosen = uri && voices.find((v) => v.voiceURI === uri);
  if (chosen) return chosen;
  const prefix = lang.split('-')[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    || voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || null;
}

export function stopSpeaking() { try { synth()?.cancel(); } catch { /* ignore */ } }

export function speak(text, { lang } = {}) {
  return new Promise((resolve) => {
    const s = synth();
    if (!s || !settings().speech || !text) { resolve(false); return; }
    const l = lang || (settings().language === 'ta' ? 'ta-IN' : 'en-IN');
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = l;
      u.rate = settings().speechRate;
      const v = pickVoice(l);
      if (v) u.voice = v;
      let done = false;
      const fin = (ok) => { if (!done) { done = true; clearTimeout(guard); resolve(ok); } };
      u.onend = () => fin(true);
      u.onerror = () => fin(false);
      const guard = setTimeout(() => fin(false), Math.max(4000, text.length * 120 / settings().speechRate));
      s.speak(u);
    } catch { resolve(false); }
  });
}

/**
 * Dex "says" something on every channel (multimodal redundancy, A11Y-09):
 * visible caption always, spoken when speech is on, screen-reader announcement when it is not.
 */
export function say(text, { assertive = false, kind = 'info', lang } = {}) {
  caption(text, kind);
  if (speechSupported() && settings().speech) return speak(text, { lang });
  announce(text, assertive);
  return Promise.resolve(false);
}

// ------------------------------------------------------------ haptics + flash (F06)
const PATTERNS = { tap: [15], confirm: [40, 60, 40], success: [80, 50, 80, 50, 220], warn: [220, 120, 220], error: [450], listen: [30] };

export function haptic(name = 'tap') {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // browsers block vibration before a tap
  if (settings().haptics && hapticsSupported()) { try { navigator.vibrate(PATTERNS[name] || PATTERNS.tap); } catch { /* ignore */ } }
}

export function flash(kind = 'success') {
  if (!settings().flash) return;
  const el = $id('flash');
  if (!el) return;
  el.dataset.kind = kind;
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 900);
}

/** Feedback bundle: visual flash + vibration; never vibration alone. */
export function feedback(kind) {
  const map = { success: 'success', warn: 'warn', error: 'error', confirm: 'confirm' };
  haptic(map[kind] || 'tap');
  if (kind === 'success' || kind === 'warn' || kind === 'error') flash(kind);
}

// ------------------------------------------------------------ dwell click (motor)
export function initDwell() {
  let timer = null;
  let target = null;
  let fired = null;
  const SEL = 'button, a[href], [role="button"], summary, label.choice, input[type="checkbox"], input[type="radio"]';

  const cancel = () => {
    clearTimeout(timer);
    if (target) target.classList.remove('dwelling');
    target = null;
  };
  document.addEventListener('pointerover', (e) => {
    if (settings().dwell === false || e.pointerType === 'touch') return;
    const el = e.target.closest?.(SEL);
    if (!el || el.disabled || el === fired || el.getAttribute('aria-disabled') === 'true') return;
    if (el === target) return;
    cancel();
    target = el;
    el.classList.add('dwelling');
    timer = setTimeout(() => {
      const t = target;
      cancel();
      fired = t;
      haptic('tap');
      t.click();
    }, settings().dwellMs);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.(SEL);
    if (!el) return;
    if (el === fired && !el.contains(e.relatedTarget)) fired = null;
    if (el === target && !el.contains(e.relatedTarget)) cancel();
  });
  document.addEventListener('click', (e) => { if (!e.isTrusted) return; cancel(); }, true);
}

// ------------------------------------------------------------ focus management (A11Y-01/03)
export function focusHeading(root) {
  const el = root.querySelector('h1') || root;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: false });
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
