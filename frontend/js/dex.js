// Dex: the conversational layer. Understands intent (local parser first, Gemini via backend when the
// local parse is unsure), fills missing slots by asking, then hands a *draft* to the payment engine.
// Dex never confirms, authorizes or executes anything.
import * as store from './store.js';
import { parseUtterance, resolveContact, tokenize, stripSuffix } from './nlp.js';
import { api, health, contactsPayload } from './api.js';
import * as pay from './payment.js';
import * as a11y from './a11y.js';
import { t } from './i18n.js';
import { navigate } from './ui.js';

export const log = [];
const subs = new Set();
let pending = null;
let busy = false;

export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const isBusy = () => busy;
export const reset = () => { pending = null; };
export const hasPending = () => !!pending;
const emit = () => subs.forEach((fn) => fn(log, busy));

function push(role, text, extra = {}) {
  log.push({ role, text, ts: Date.now(), ...extra });
  if (log.length > 60) log.shift();
  emit();
}

function dexSay(text, opts = {}) {
  push('dex', text, { kind: opts.kind || 'info' });
  a11y.say(text, opts); // fire and forget: never block the next utterance on speech playback
}

const nameForSpeech = () => store.displayName();

async function understand(text, contacts) {
  const local = parseUtterance(text, contacts);
  if (local.intent === 'secret_warning') return local;
  const settings = store.get().settings;
  const needsModel = local.intent === 'unknown' || local.confidence < 0.85;
  if (!needsModel) return local;
  const hs = await health();
  if (!hs.online || !hs.gemini) return local;
  const r = await api.post('/api/assistant/chat', {
    message: text, profile_name: nameForSpeech() || null, language: settings.language === 'ta' ? 'ta' : 'en',
    contacts: contactsPayload(contacts),
  }, 7000);
  if (r.ok && r.data && r.data.parsed) return { ...r.data.parsed, reply: r.data.reply || null };
  return local;
}

const ORDINALS = { first: 0, '1': 0, one: 0, onnu: 0, mudhal: 0, 'முதல்': 0, second: 1, '2': 1, two: 1, rendu: 1, irandu: 1, 'இரண்டாவது': 1, third: 2, '3': 2, moonu: 2 };

async function advance(s) {
  const name = s.recipient || s.recipient_raw || s.upi_id || s.phone || '';
  if (s.notes && s.notes.includes('multiple_amounts')) {
    pending = { slots: { ...s, amount: null, notes: [] } };
    return dexSay(t('dex.multiAmount'), { kind: 'warn' });
  }
  if (s.candidates && s.candidates.length) {
    pending = { slots: s };
    return dexSay(t('dex.ambiguous', { names: s.candidates.join(` ${t('common.or')} `) }), { kind: 'warn' });
  }
  if (!name) { pending = { slots: s }; return dexSay(t('dex.askRecipient')); }
  if (s.amount === null || s.amount === undefined) { pending = { slots: s }; return dexSay(t('dex.askAmount', { name })); }
  if (!s.recipient && !s.upi_id) {
    pending = null;
    dexSay(t('dex.unknownRecipient', { name }), { kind: 'warn' });
    const q = new URLSearchParams({ amount: String(s.amount) });
    if (s.recipient_raw) q.set('name', s.recipient_raw);
    return navigate(`#/upi?${q}`);
  }
  pending = null;
  const draft = pay.makeDraft({ name: s.recipient || s.upi_id, upi_id: s.recipient ? undefined : s.upi_id, amount: s.amount, method: 'voice' });
  await pay.startFlow(draft);
  return navigate('#/review');
}

async function handlePending(text, contacts) {
  const s = { ...pending.slots };
  const parsed = parseUtterance(text, contacts);
  if (parsed.intent === 'confirm_no') { pending = null; await dexSay(t('dex.cancelled')); return true; }
  if (parsed.intent === 'secret_warning') return false;
  const toks = tokenize(text);

  if (s.candidates && s.candidates.length) {
    const pool = contacts.filter((c) => s.candidates.includes(c.name));
    let pick = null;
    if (toks.length <= 2 && toks.some((x) => x in ORDINALS)) pick = pool[ORDINALS[toks.find((x) => x in ORDINALS)]] || null;
    if (!pick) { const r = resolveContact(toks.map(stripSuffix), pool); if (r.status === 'matched') pick = r.contact; }
    if (!pick) { await dexSay(t('dex.ambiguous', { names: s.candidates.join(` ${t('common.or')} `) }), { kind: 'warn' }); return true; }
    Object.assign(s, { recipient: pick.name, recipient_raw: pick.name, candidates: [], status: 'matched' });
    await advance(s);
    return true;
  }

  const needAmount = s.amount === null || s.amount === undefined;
  const needName = !(s.recipient || s.recipient_raw || s.upi_id || s.phone);
  if (parsed.intent === 'payment_request') {
    if (needAmount && parsed.amount !== null) s.amount = parsed.amount;
    if (needName && (parsed.recipient || parsed.recipient_raw || parsed.upi_id || parsed.phone)) {
      Object.assign(s, { recipient: parsed.recipient, recipient_raw: parsed.recipient_raw, upi_id: parsed.upi_id, phone: parsed.phone, candidates: parsed.recipient_status === 'ambiguous' ? parsed.candidates : [] });
    }
    await advance(s);
    return true;
  }
  if (needName && parsed.intent === 'unknown' && toks.length) {
    const r = resolveContact(toks.map(stripSuffix).slice(0, 3), contacts);
    Object.assign(s, { recipient: r.contact ? r.contact.name : null, recipient_raw: toks.map(stripSuffix).slice(0, 3).join(' '), candidates: r.status === 'ambiguous' ? r.candidates.map((c) => c.name) : [] });
    await advance(s);
    return true;
  }
  return false;
}

const NAV = { home: '#/home', settings: '#/settings', beneficiaries: '#/people' };

async function route(u) {
  switch (u.intent) {
    case 'secret_warning':
      a11y.feedback('warn');
      return dexSay(t('dex.secret'), { assertive: true, kind: 'warn' });
    case 'payment_request':
      return advance({
        recipient: u.recipient, recipient_raw: u.recipient_raw, upi_id: u.upi_id, phone: u.phone, amount: u.amount,
        candidates: u.recipient_status === 'ambiguous' ? u.candidates : [], notes: u.notes || [],
      });
    case 'balance_check': return navigate('#/balance');
    case 'insights': return navigate('#/insights');
    case 'transaction_history':
      dexSay(t('dex.openHistory'));
      return navigate(`#/history${u.query ? `?q=${encodeURIComponent(u.query)}` : ''}`);
    case 'scan_qr_help':
      dexSay(t('dex.scanHelp'));
      return navigate('#/scan');
    case 'bill_recharge':
      dexSay(t('dex.openBills'));
      return navigate(`#/bills${u.amount ? `?amount=${u.amount}` : ''}`);
    case 'navigate':
      if (u.target === 'back') { history.back(); return null; }
      return navigate(NAV[u.target] || '#/home');
    case 'help': return dexSay(t('dex.help'));
    case 'confirm_yes':
    case 'confirm_no': {
      const f = pay.getCurrent();
      if (f && f.state === 'awaiting_confirmation') { navigate('#/review'); return null; }
      return dexSay(t('dex.nothingToConfirm'));
    }
    default: return dexSay(u.reply || t('dex.unknown'), { kind: 'info' });
  }
}

/** Entry point for every spoken or typed utterance. */
export async function handle(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  push('user', text);
  busy = true;
  emit();
  try {
    const contacts = store.get().beneficiaries;
    if (pending) {
      const consumed = await handlePending(text, contacts);
      if (consumed) return;
      pending = null;
    }
    await route(await understand(text, contacts));
  } catch (e) {
    console.error(e);
    a11y.feedback('error');
    await dexSay(t('dex.error'), { kind: 'error' });
  } finally {
    busy = false;
    emit();
  }
}

export function greet() {
  const n = nameForSpeech();
  return n ? t('dex.greetName', { name: n }) : t('dex.greet');
}

export { dexSay };
