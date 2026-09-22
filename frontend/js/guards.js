// Deterministic payment guards + QR verifier. Port of backend/app/safety.py and qr.py.
// Runs client-side so safety holds offline; the server re-checks when reachable.
import { normName } from './nlp.js';

export const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,63}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;
export const DEFAULTS = { highAmount: 5000, txnLimit: 100000, duplicateWindowS: 120 };
const w = (code, severity, en, ta) => ({ code, severity, message_en: en, message_ta: ta });

export function validAmount(a) {
  if (a === null || a === undefined || typeof a === 'boolean' || a === '') return null;
  const v = typeof a === 'number' ? a : Number(String(a).replace(/,/g, '').trim());
  if (!Number.isFinite(v) || v <= 0) return null;
  if (Math.round(v * 100) / 100 !== v) return null;
  return v;
}

export function checkPayment(draft, { recent = [], balance = null, settings = {}, now = Date.now() / 1000 } = {}) {
  const s = { ...DEFAULTS, ...settings };
  const ws = [];
  const name = (draft.recipient_name || '').trim();
  const upi = (draft.upi_id || '').trim();
  const amount = validAmount(draft.amount);

  if (draft.qr_blocked) ws.push(w('QR_SUSPICIOUS', 'block', 'This QR code looks suspicious and was blocked.', 'இந்த QR குறியீடு சந்தேகத்திற்குரியது, தடுக்கப்பட்டது.'));
  if (draft.ambiguous_candidates && draft.ambiguous_candidates.length) {
    const names = draft.ambiguous_candidates.join(', ');
    ws.push(w('AMBIGUOUS_RECEIVER', 'block', `More than one contact matches: ${names}. Please choose one.`, `ஒன்றுக்கு மேற்பட்ட தொடர்புகள் பொருந்துகின்றன: ${names}. ஒன்றைத் தேர்ந்தெடுக்கவும்.`));
  } else if (!name && !upi) ws.push(w('MISSING_RECEIVER', 'block', 'No receiver selected.', 'பெறுநர் தேர்ந்தெடுக்கப்படவில்லை.'));

  if (upi && !VPA_RE.test(upi)) ws.push(w('INVALID_UPI_ID', 'block', 'The UPI ID format is not valid.', 'UPI ஐடி வடிவம் சரியில்லை.'));

  if (amount === null) {
    ws.push(w('INVALID_AMOUNT', 'block', 'Enter a valid amount greater than zero, with at most two decimals.', 'பூஜ்ஜியத்திற்கு அதிகமான சரியான தொகையை உள்ளிடவும்.'));
  } else {
    if (amount > s.txnLimit) ws.push(w('LIMIT_EXCEEDED', 'block', `Amount is above the per-payment limit of ${Math.trunc(s.txnLimit)} rupees.`, `ஒரு பணப்பரிவர்த்தனை வரம்பான ${Math.trunc(s.txnLimit)} ரூபாயை தொகை மீறுகிறது.`));
    else if (amount >= s.highAmount) ws.push(w('HIGH_AMOUNT', 'warn', `This is a high amount: ${amount} rupees.`, `இது அதிக தொகை: ${amount} ரூபாய்.`));
    if (balance !== null && balance !== undefined && amount > balance) ws.push(w('INSUFFICIENT_BALANCE', 'block', 'Balance is not enough for this payment.', 'இந்த பணம் செலுத்த இருப்பு போதவில்லை.'));
  }

  if ((name || upi) && !(draft.ambiguous_candidates && draft.ambiguous_candidates.length)) {
    if (!draft.known) ws.push(w('UNKNOWN_RECEIVER', 'warn', 'This receiver is not in your saved contacts.', 'இந்த பெறுநர் உங்கள் சேமித்த தொடர்புகளில் இல்லை.'));
    else if (!draft.verified) ws.push(w('UNVERIFIED_RECEIVER', 'warn', 'This receiver has not been verified.', 'இந்த பெறுநர் சரிபார்க்கப்படவில்லை.'));
  }

  if (amount !== null && recent.length) {
    const key = (upi || name).toLowerCase();
    for (const t of recent) {
      if ((t.status || 'success') !== 'success') continue;
      const tkey = (t.upi_id || t.recipient || '').toLowerCase();
      let ts = t.ts;
      if (typeof ts === 'number' && ts > 1e11) ts /= 1000;
      if (key && tkey === key && validAmount(t.amount) === amount && typeof ts === 'number' && now - ts >= 0 && now - ts <= s.duplicateWindowS) {
        ws.push(w('DUPLICATE_RECENT', 'warn', 'You paid the same amount to this receiver a moment ago.', 'சற்று முன் இதே தொகையை இதே பெறுநருக்கு செலுத்தினீர்கள்.'));
        break;
      }
    }
  }
  const blocked = ws.some((x) => x.severity === 'block');
  return { blocked, needs_ack: !blocked && ws.some((x) => x.severity === 'warn'), warnings: ws };
}

// ------------------------------------------------------------------ QR
const ALLOWED = new Set(['pa', 'pn', 'am', 'cu', 'tn', 'tr', 'tid', 'mc', 'url', 'mode', 'purpose', 'orgid', 'sign', 'mid', 'msid', 'mtid', 'cq', 'refurl', 'ver', 'qrmedium']);
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at'];
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const short = (host) => SHORTENERS.some((x) => host.endsWith(x));
const hostOf = (u) => { try { return new URL(u.includes('://') ? u : 'http://' + u).hostname; } catch { return ''; } };
const res = (valid, blocked, warnings, payee = null, kind = 'unknown') => ({ valid, blocked, kind, payee, warnings, known: false, verified: false, contact: null });

function decode(v) { try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return v; } }

export function verifyQr(payload, contacts = []) {
  const raw = typeof payload === 'string' ? payload : '';
  if (!raw.trim()) return res(false, true, [w('QR_EMPTY', 'block', 'The QR code is empty.', 'QR குறியீடு காலியாக உள்ளது.')]);
  if (raw.length > 1000 || CTRL_RE.test(raw)) return res(false, true, [w('QR_MALFORMED', 'block', 'The QR code data is malformed or too long.', 'QR தரவு தவறானது அல்லது மிக நீளமானது.')]);
  const text = raw.trim();
  const low = text.toLowerCase();
  if (/^(javascript:|data:|file:|vbscript:|intent:|blob:)/.test(low)) return res(false, true, [w('QR_DANGEROUS_SCHEME', 'block', 'This QR code contains a dangerous link type.', 'இந்த QR குறியீட்டில் ஆபத்தான இணைப்பு உள்ளது.')], null, 'link');
  if (/^(http:\/\/|https:\/\/|www\.)/.test(low)) {
    const why = short(hostOf(text)) ? 'shortened link' : 'web link';
    return res(false, true, [w('QR_URL_NOT_PAYMENT', 'block', `This QR code is a ${why}, not a payment code. It was blocked.`, 'இது பணம் செலுத்தும் QR அல்ல, இணைப்பு. தடுக்கப்பட்டது.')], null, 'link');
  }
  const params = {};
  let kind;
  if (low.startsWith('upi://')) {
    const rest = text.slice(6);
    const qi = rest.indexOf('?');
    const host = (qi === -1 ? rest : rest.slice(0, qi)).toLowerCase();
    if (host !== 'pay') return res(false, true, [w('QR_UPI_NOT_PAY', 'block', 'This UPI code is not a pay request.', 'இது பணம் செலுத்தும் UPI குறியீடு அல்ல.')], null, 'upi');
    const seen = new Set();
    for (const pair of (qi === -1 ? '' : rest.slice(qi + 1)).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = decode(eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
      const v = decode(eq === -1 ? '' : pair.slice(eq + 1)).trim();
      if (seen.has(k) && ['pa', 'am', 'cu'].includes(k)) return res(false, true, [w('QR_DUPLICATE_FIELD', 'block', 'The QR code repeats a payment field, which is unsafe.', 'QR குறியீடு ஒரே புலத்தை மீண்டும் கொண்டுள்ளது, பாதுகாப்பற்றது.')], null, 'upi');
      seen.add(k);
      params[k] = v;
    }
    kind = 'upi';
  } else if (VPA_RE.test(text)) { params.pa = text; kind = 'vpa'; }
  else return res(false, true, [w('QR_UNRECOGNISED', 'block', 'This QR code is not a payment code.', 'இது பணம் செலுத்தும் QR குறியீடு அல்ல.')]);

  const ws = [];
  if (Object.keys(params).some((k) => !ALLOWED.has(k))) ws.push(w('QR_UNEXPECTED_FIELDS', 'warn', 'The QR code has unexpected extra fields.', 'QR குறியீட்டில் எதிர்பாராத கூடுதல் புலங்கள் உள்ளன.'));
  for (const k of ['url', 'refurl']) {
    if (params[k]) {
      if (short(hostOf(params[k]))) return res(false, true, [w('QR_SHORTENED_LINK', 'block', 'The QR code hides a shortened link.', 'QR குறியீட்டில் மறைக்கப்பட்ட இணைப்பு உள்ளது.')], null, kind);
      ws.push(w('QR_HAS_LINK', 'warn', 'The QR code carries a web link. Ignore it and check the payee.', 'QR குறியீட்டில் இணைய இணைப்பு உள்ளது. பெறுநரை சரிபார்க்கவும்.'));
    }
  }
  const vpa = params.pa || '';
  if (!VPA_RE.test(vpa)) return res(false, true, [w('QR_BAD_VPA', 'block', 'The payee UPI ID in the QR code is invalid.', 'QR குறியீட்டில் உள்ள பெறுநர் UPI ஐடி தவறானது.')], null, kind);
  if (params.cu && params.cu.toUpperCase() !== 'INR') return res(false, true, [w('QR_BAD_CURRENCY', 'block', 'Only rupee (INR) payments are supported.', 'ரூபாய் (INR) மட்டுமே ஆதரிக்கப்படுகிறது.')], null, kind);
  let amount = null;
  if (params.am) {
    amount = validAmount(params.am);
    if (amount === null) return res(false, true, [w('QR_BAD_AMOUNT', 'block', 'The amount in the QR code is not valid.', 'QR குறியீட்டில் உள்ள தொகை சரியில்லை.')], null, kind);
  }
  const name = (params.pn || '').trim().slice(0, 60);
  const note = (params.tn || '').trim().slice(0, 80);
  const payee = { vpa: vpa.toLowerCase(), name: name || null, amount, note: note || null, merchant_code: params.mc || null };
  const out = res(true, false, ws, payee, kind);
  const contact = contacts.find((c) => (c.upi_id || '').toLowerCase() === vpa.toLowerCase());
  if (contact) {
    Object.assign(out, { known: true, verified: !!contact.verified, contact });
    const a = normName(name).split(' ')[0], b = normName(contact.name).split(' ')[0];
    if (name && a !== b && !normName(contact.name).includes(normName(name))) {
      ws.push(w('QR_NAME_MISMATCH', 'warn', `The QR name '${name}' differs from your saved contact '${contact.name}'.`, `QR பெயர் '${name}' உங்கள் தொடர்பு '${contact.name}' உடன் பொருந்தவில்லை.`));
    }
  } else ws.push(w('QR_UNKNOWN_PAYEE', 'warn', 'This payee is not in your contacts. Check the name carefully.', 'இந்த பெறுநர் உங்கள் தொடர்புகளில் இல்லை. பெயரை கவனமாக பார்க்கவும்.'));
  if (!name) ws.push(w('QR_NO_NAME', 'warn', 'The QR code has no payee name.', 'QR குறியீட்டில் பெறுநர் பெயர் இல்லை.'));
  return out;
}
