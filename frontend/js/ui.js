// Shared UI building blocks. Every component is keyboard-operable and has a programmatic name.
import { h, clear, nextId, debounce } from './dom.js';
import { icon } from './icons.js';
import { t, lang } from './i18n.js';
import * as a11y from './a11y.js';

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export const goBack = () => { if (history.length > 1) history.back(); else navigate('#/home'); };

// ---------------------------------------------------------------- formatting
export function formatINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
}

/** Speech-friendly amount ("500 rupees"), never the ₹ glyph which many voices skip or mispronounce. */
export function spokenINR(n) {
  const whole = Math.trunc(n);
  const paise = Math.round((n - whole) * 100);
  if (lang() === 'ta') return `${whole} ரூபாய்${paise ? ` ${paise} பைசா` : ''}`;
  return `${whole} rupees${paise ? ` and ${paise} paise` : ''}`;
}

export function formatDateTime(ts) {
  return new Intl.DateTimeFormat(lang() === 'ta' ? 'ta-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}

export function relativeDay(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return t('time.today');
  if (days === 1) return t('time.yesterday');
  return t('time.daysAgo', { n: days });
}

// ---------------------------------------------------------------- components
export function simBanner(compact = false) {
  return h('div', { class: `sim-banner${compact ? ' compact' : ''}`, role: 'note' },
    icon('shield', 20), h('span', {}, h('strong', {}, t('sim.label')), ' ', t(compact ? 'sim.short' : 'sim.long')));
}

export function btn(label, { ic, variant = 'primary', size = 'lg', onClick, type = 'button', disabled, id, cls = '', href, aria = {}, describedby } = {}) {
  const attrs = {
    class: `btn btn-${variant} btn-${size} ${cls}`.trim(), id, disabled,
    'aria-describedby': describedby, ...aria,
  };
  const kids = [ic ? icon(ic, size === 'lg' ? 28 : 22) : null, h('span', { class: 'btn-label' }, label)];
  if (href) return h('a', { ...attrs, href, role: 'button' }, kids);
  return h('button', { ...attrs, type, on: onClick ? { click: onClick } : undefined }, kids);
}

export function pageHeader(title, { back = true, sub } = {}) {
  return h('header', { class: 'page-head' },
    back ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.back'), on: { click: goBack } }, icon('back')) : null,
    h('div', { class: 'page-head-text' }, h('h1', { tabindex: '-1' }, title), sub ? h('p', { class: 'muted' }, sub) : null));
}

export function card(...kids) { return h('section', { class: 'card' }, kids); }

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  box.append(el);
  a11y.announce(message, kind === 'error');
  setTimeout(() => el.remove(), 4500);
}

export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title', 'aria-describedby': 'dlg-msg' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('h2', { id: 'dlg-title' }, title), h('p', { id: 'dlg-msg' }, message),
      h('div', { class: 'dialog-actions' },
        btn(cancelLabel || t('common.cancel'), { variant: 'secondary', onClick: () => close(false), cls: 'autofocus-target' }),
        btn(confirmLabel || t('common.confirm'), { variant: danger ? 'danger' : 'primary', onClick: () => close(true) })));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.autofocus-target')?.focus();
  });
}

export function field({ label, id = nextId('f'), type = 'text', value = '', hint, inputmode, autocomplete = 'off', maxlength, placeholder, required = false, pattern }) {
  const hintId = `${id}-hint`, errId = `${id}-err`;
  const input = h('input', { id, name: id, type, value, inputmode, autocomplete, maxlength, placeholder, required, pattern, class: 'input',
    'aria-describedby': `${hint ? hintId : ''} ${errId}`.trim(), autocapitalize: 'off', spellcheck: 'false' });
  const err = h('p', { id: errId, class: 'field-error', role: 'alert', hidden: true });
  const el = h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), hint ? h('p', { id: hintId, class: 'hint' }, hint) : null, input, err);
  return {
    el, input,
    setError(msg) {
      err.hidden = !msg;
      err.textContent = msg || '';
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    },
  };
}

export function switchRow({ label, hint, checked, onChange, id = nextId('sw') }) {
  const input = h('input', { type: 'checkbox', role: 'switch', id, checked, class: 'switch-input', 'aria-describedby': hint ? `${id}-h` : undefined,
    on: { change: (e) => onChange(e.target.checked) } });
  return h('div', { class: 'row switch-row' },
    h('div', { class: 'row-text' }, h('label', { for: id, class: 'label' }, label), hint ? h('p', { id: `${id}-h`, class: 'hint' }, hint) : null),
    input);
}

export function warningsBlock(warnings) {
  if (!warnings || !warnings.length) return null;
  return h('ul', { class: 'warnings', 'aria-label': t('review.warnings') },
    warnings.map((w) => h('li', { class: `warning warning-${w.severity}` },
      icon(w.severity === 'block' ? 'x' : 'alert', 22),
      h('span', {}, h('strong', {}, w.severity === 'block' ? t('warn.blocked') : t('warn.caution'), ': '), lang() === 'ta' ? w.message_ta : w.message_en))));
}

export function listRow({ title, sub, trailing, href, onClick, ic, label }) {
  const inner = [ic ? h('span', { class: 'row-icon' }, icon(ic, 24)) : null,
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
    trailing ? h('span', { class: 'row-trailing' }, trailing) : null];
  if (href) return h('a', { class: 'list-row', href, 'aria-label': label }, inner);
  return h('button', { type: 'button', class: 'list-row', on: { click: onClick }, 'aria-label': label }, inner);
}

export function emptyState(title, body, action) {
  return h('div', { class: 'empty' }, icon('search', 40), h('p', { class: 'row-title' }, title), body ? h('p', { class: 'muted' }, body) : null, action || null);
}

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function avatar(name) { return h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(name)); }

export { h, clear, icon, t, debounce };
