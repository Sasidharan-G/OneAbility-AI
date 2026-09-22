// Voice-guided QR scanner (F04). Local decode, local + server verification, suspicious-payload block.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import * as pay from '../payment.js';
import { Scanner, cameraSupported, decodeImageFile } from '../qr.js';
import { verifyQr } from '../guards.js';
import { api, contactsPayload } from '../api.js';
import { h, icon, t, btn, simBanner, pageHeader, warningsBlock, formatINR, spokenINR, navigate } from '../ui.js';

export function render(root) {
  let scanner = null;
  const video = h('video', { class: 'scan-video', muted: true, playsinline: true, 'aria-label': t('scan.videoLabel') });
  video.muted = true;
  const canvas = h('canvas', { class: 'scan-canvas', hidden: true });
  const status = h('p', { class: 'scan-status', role: 'status' }, t('scan.starting'));
  const stage = h('div', { class: 'scan-stage' }, video, h('div', { class: 'scan-frame', 'aria-hidden': 'true' }), canvas);
  const result = h('div', { class: 'scan-result', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions' });

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'qr-file', tabindex: '-1',
    on: { change: async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      say(t('scan.reading'));
      try {
        const data = await decodeImageFile(f);
        if (data) await onFound(data); else say(t('scan.noneInImage'), 'warn');
      } catch { say(t('scan.imageError'), 'warn'); }
      e.target.value = '';
    } } });

  function say(text, kind = 'info') {
    status.textContent = text;
    a11y.say(text, { kind, assertive: kind !== 'info' });
  }

  const HINTS = { point: 'scan.hintPoint', distance: 'scan.hintDistance', alternatives: 'scan.hintAlt', dark: 'scan.hintDark' };

  async function start() {
    result.replaceChildren();
    say(t('scan.starting'));
    scanner = new Scanner(video, canvas, {
      onFound: (d) => onFound(d),
      onHint: (k) => say(t(HINTS[k]), 'warn'),
      onError: (code) => {
        const map = { ended: 'scan.errEnded', denied: 'scan.errDenied', nocamera: 'scan.errNoCamera', unsupported: 'scan.errUnsupported', error: 'scan.errGeneric' };
        say(t(map[code] || 'scan.errGeneric'), 'error');
        a11y.feedback('warn');
        stage.classList.add('is-off');
      },
    });
    const ok = await scanner.start();
    if (ok) { stage.classList.remove('is-off'); say(t('scan.ready')); }
  }

  async function onFound(data) {
    scanner?.stop();
    a11y.feedback('confirm');
    let res = verifyQr(data, store.get().beneficiaries);
    const r = await api.post('/api/qr/verify', { payload: String(data).slice(0, 2000), contacts: contactsPayload(store.get().beneficiaries) }, 3500);
    if (r.ok && r.data.blocked && !res.blocked) res = { ...r.data }; // server is stricter: honour it
    show(res);
  }

  function show(res) {
    result.replaceChildren();
    actions.replaceChildren();
    if (res.blocked || !res.valid) {
      a11y.feedback('error');
      const w = res.warnings[0];
      const msg = store.get().settings.language === 'ta' ? w.message_ta : w.message_en;
      say(`${t('scan.blocked')} ${msg}`, 'error');
      result.append(h('div', { class: 'card card-danger' }, h('h2', { class: 'section-title' }, t('scan.blockedTitle')), warningsBlock(res.warnings)));
      actions.append(btn(t('scan.again'), { ic: 'scan', onClick: start }), btn(t('scan.manual'), { ic: 'at', variant: 'secondary', href: '#/upi' }));
      return;
    }
    const p = res.payee;
    const who = p.name || p.vpa;
    a11y.feedback(res.warnings.length ? 'warn' : 'success');
    say(t('scan.found', { name: who, upi: p.vpa }) + (p.amount ? ' ' + t('scan.foundAmount', { amount: spokenINR(p.amount) }) : ''), res.warnings.length ? 'warn' : 'info');
    result.append(h('div', { class: 'card' }, h('h2', { class: 'section-title' }, t('scan.payee')),
      h('dl', { class: 'kv' }, h('dt', {}, t('review.to')), h('dd', {}, who), h('dt', {}, t('review.upi')), h('dd', {}, p.vpa),
        p.amount ? [h('dt', {}, t('review.amount')), h('dd', {}, formatINR(p.amount))] : null, p.note ? [h('dt', {}, t('review.note')), h('dd', {}, p.note)] : null),
      warningsBlock(res.warnings)));
    actions.append(
      btn(t('common.continue'), { ic: 'check', onClick: async () => {
        const known = !!res.known;
        if (p.amount) {
          const draft = pay.makeDraft({ name: who, upi_id: p.vpa, amount: p.amount, method: 'qr', note: p.note, known, verified: !!res.verified });
          await pay.startFlow(draft, res.warnings);
          navigate('#/review');
        } else {
          pay.stashWarnings(res.warnings);
          const q = new URLSearchParams({ upi: p.vpa, m: 'qr' });
          if (p.name) q.set('name', p.name);
          navigate(`#/amount?${q}`);
        }
      } }),
      btn(t('scan.again'), { ic: 'scan', variant: 'secondary', onClick: start }));
  }

  actions.append(
    btn(t('scan.restart'), { ic: 'camera', variant: 'secondary', onClick: () => { scanner?.stop(); start(); } }),
    btn(t('scan.pick'), { ic: 'image', variant: 'secondary', onClick: () => fileInput.click() }),
    btn(t('scan.manual'), { ic: 'at', variant: 'ghost', href: '#/upi' }));

  root.append(pageHeader(t('scan.title')), simBanner(true), stage, status, result, actions, fileInput,
    h('p', { class: 'hint' }, t('scan.privacy')));
  if (cameraSupported()) start(); else { say(t('scan.errUnsupported'), 'error'); stage.classList.add('is-off'); }
  return () => scanner?.stop();
}
