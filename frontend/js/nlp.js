// Deterministic Tamil / English / Tanglish parser. Line-for-line port of backend/app/nlp.py.
// Shared lexicon + test vectors live in /shared and are checked by both test suites.

let L = null; // built lexicon sets

export function setLexicon(lex) {
  const S = (a) => new Set(a);
  L = {
    raw: lex,
    currency: S(lex.currency), payVerbs: S(lex.pay_verbs), fillers: S(lex.fillers),
    yes: S(lex.yes_words), no: S(lex.no_words), secret: S(lex.secret_words),
    balance: S(lex.balance_words), history: S(lex.history_words), recharge: S(lex.recharge_words),
    qr: S(lex.qr_words), help: S(lex.help_words), insight: S(lex.insight_words),
    nav: Object.fromEntries(Object.entries(lex.nav_words).map(([k, v]) => [k, S(v)])),
    ambig: S(lex.ambiguous_units), numbers: lex.number_words,
    hundred: S(lex.hundred_words), thousand: S(lex.thousand_words), lakh: S(lex.lakh_words),
    numSkip: S(lex.number_skip),
    suffixes: [...lex.name_suffixes].sort((a, b) => b.length - a.length),
    tanglish: S(lex.tanglish_markers), tr: lex.tamil_translit,
  };
}

export async function loadLexicon(url = new URL('../shared/lexicon.json', import.meta.url)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('lexicon unavailable');
  setLexicon(await res.json());
}

const need = () => { if (!L) throw new Error('lexicon not loaded'); };
const TAMIL_RE = /[஀-௿]/;
const TAMIL_DIGITS = { '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4', '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9' };
const UPI_SRC = '[a-z0-9.\\-_]{2,}@[a-z][a-z0-9]{1,}';
const UPI_RE = new RegExp(UPI_SRC);
const UPI_FULL = new RegExp('^(?:' + UPI_SRC + ')$');
const PHONE_RE = /(?<!\d)[6-9]\d{9}(?!\d)/;

function normToken(p) {
  p = p.replace(/(?<=\d),(?=\d{3})/g, '');
  p = p.replace(/(\d)([^\d.])/g, '$1 $2');
  p = p.replace(/([^\d.])(\d)/g, '$1 $2');
  p = p.replace(/(?<!\d)\./g, ' ');
  p = p.replace(/\.(?!\d)/g, ' ');
  p = p.replace(/[,;:!?"'()\[\]{}\/\\|<>~`*]/g, ' ');
  return p.replace(/-/g, ' ').replace(/_/g, ' ');
}

export function normalize(text) {
  const t = String(text || '').toLowerCase().replace(/[௦-௯]/g, (c) => TAMIL_DIGITS[c]).replace(/₹/g, ' rs ');
  const out = [];
  for (const p of t.split(/\s+/).filter(Boolean)) {
    if (p.includes('@')) out.push(p.replace(/^[,;:!?."'()]+|[,;:!?."'()]+$/g, ''));
    else out.push(normToken(p));
  }
  return out.join(' ').split(/\s+/).filter(Boolean).join(' ');
}

export function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export function detectLanguage(text) {
  need();
  if (TAMIL_RE.test(text || '')) return 'ta';
  return tokenize(text).some((t) => L.tanglish.has(t)) ? 'tanglish' : 'en';
}

export function transliterate(s) {
  need();
  const { consonants: cons, vowels: vow, signs } = L.tr;
  const out = [];
  const chars = [...s];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch in cons) {
      const base = cons[ch];
      const nxt = i + 1 < chars.length ? chars[i + 1] : '';
      if (nxt === '்') { out.push(base); i += 2; continue; }
      if (nxt in signs) { out.push(base + signs[nxt]); i += 2; continue; }
      out.push(base + 'a');
    } else if (ch in vow) out.push(vow[ch]);
    else if (ch === '்' || ch in signs) { /* dropped */ }
    else out.push(ch);
    i += 1;
  }
  return out.join('');
}

export function normName(s) {
  let t = transliterate(String(s || '').toLowerCase());
  for (const [a, b] of [['aa', 'a'], ['ee', 'i'], ['ii', 'i'], ['oo', 'u'], ['uu', 'u'], ['ae', 'e'], ['oa', 'o'], ['th', 't'], ['dh', 'd'], ['z', 'l'], ['w', 'v']]) {
    t = t.split(a).join(b);
  }
  t = t.replace(/[^a-z0-9 ]/g, '').replace(/(.)\1+/g, '$1');
  return t.trim();
}

export function stripSuffix(tok) {
  need();
  const chars = [...tok];
  for (const suf of L.suffixes) {
    if (tok.endsWith(suf) && chars.length - [...suf].length >= 2) {
      let base = chars.slice(0, chars.length - [...suf].length).join('');
      const lastCh = [...base].pop();
      if (suf.startsWith('ு') && lastCh in L.tr.consonants) base += '்';
      return base;
    }
  }
  return tok;
}

function numRun(tokens, start) {
  let total = 0, cur = 0, i = start, used = 0;
  while (i < tokens.length) {
    const w = tokens[i];
    if (L.numSkip.has(w) && used) { i += 1; continue; }
    if (Object.prototype.hasOwnProperty.call(L.numbers, w)) cur += L.numbers[w];
    else if (L.hundred.has(w)) cur = (cur || 1) * 100;
    else if (L.thousand.has(w)) { total += (cur || 1) * 1000; cur = 0; }
    else if (L.lakh.has(w)) { total += (cur || 1) * 100000; cur = 0; }
    else break;
    used += 1;
    i += 1;
  }
  if (!used) return [null, start];
  while (i > start && L.numSkip.has(tokens[i - 1])) i -= 1;
  return [total + cur, i];
}

export function extractAmount(tokens) {
  need();
  const consumed = new Set();
  const cands = [];
  tokens.forEach((t, i) => {
    if (/^\d+(\.\d+)?$/.test(t)) {
      if (!t.includes('.') && t.length >= 8) return; // phone / account-like
      cands.push(parseFloat(t));
      consumed.add(i);
    }
  });
  if (!cands.length) {
    let i = 0;
    while (i < tokens.length) {
      const [val, nxt] = numRun(tokens, i);
      if (val !== null && nxt > i) {
        const run = tokens.slice(i, nxt);
        const onlyAmbig = run.every((w) => L.ambig.has(w) || L.numSkip.has(w));
        const curNext = nxt < tokens.length && L.currency.has(tokens[nxt]);
        if (!onlyAmbig || curNext) {
          cands.push(val);
          for (let k = i; k < nxt; k++) consumed.add(k);
        }
        i = nxt;
      } else i += 1;
    }
  }
  const distinct = [...new Set(cands)].sort((a, b) => a - b);
  if (distinct.length > 1) return { amount: null, consumed, multi: true };
  return { amount: distinct.length ? distinct[0] : null, consumed, multi: false };
}

const amountOut = (a) => (a === null ? null : Number.isInteger(a) ? a : Math.round(a * 100) / 100);

// Ratcliff/Obershelp ratio, matching Python difflib.SequenceMatcher.ratio()
function matchingChars(a, al, ah, b, bl, bh) {
  let bi = al, bj = bl, bk = 0;
  for (let i = al; i < ah; i++) {
    for (let j = bl; j < bh; j++) {
      let k = 0;
      while (i + k < ah && j + k < bh && a[i + k] === b[j + k]) k++;
      if (k > bk) { bi = i; bj = j; bk = k; }
    }
  }
  if (!bk) return 0;
  return bk + matchingChars(a, al, bi, b, bl, bj) + matchingChars(a, bi + bk, ah, b, bj + bk, bh);
}
export function ratio(a, b) {
  const A = [...a], B = [...b];
  if (!A.length && !B.length) return 1;
  return (2 * matchingChars(A, 0, A.length, B, 0, B.length)) / (A.length + B.length);
}

export function resolveContact(nameTokens, contacts) {
  need();
  if (!nameTokens.length) return { status: 'none', contact: null, candidates: [] };
  if (!contacts || !contacts.length) return { status: 'unknown', contact: null, candidates: [] };
  const rawPhrase = normName(nameTokens.join(' '));
  const strippedPhrase = normName(nameTokens.map(stripSuffix).join(' '));
  const variants = [...new Set([rawPhrase, strippedPhrase])];
  const q = new Set();
  variants.forEach((v) => v.split(' ').forEach((t) => t && q.add(t)));

  for (const v of variants) {
    const exact = contacts.filter((c) => normName(c.name) === v);
    if (exact.length === 1) return { status: 'matched', contact: exact[0], candidates: exact, method: 'exact' };
    if (exact.length > 1) return { status: 'ambiguous', contact: null, candidates: exact, method: 'exact' };
  }
  const hits = contacts.filter((c) => normName(c.name).split(' ').some((t) => q.has(t)));
  if (hits.length === 1) return { status: 'matched', contact: hits[0], candidates: hits, method: 'token' };
  if (hits.length > 1) return { status: 'ambiguous', contact: null, candidates: hits, method: 'token' };
  const close = contacts.filter((c) => {
    let best = 0;
    for (const ct of normName(c.name).split(' ')) for (const qt of q) best = Math.max(best, ratio(ct, qt));
    return best >= 0.8;
  });
  if (close.length === 1) return { status: 'matched', contact: close[0], candidates: close, method: 'fuzzy' };
  if (close.length > 1) return { status: 'ambiguous', contact: null, candidates: close, method: 'fuzzy' };
  return { status: 'unknown', contact: null, candidates: [] };
}

export function parseConfirmation(text) {
  need();
  const toks = new Set(tokenize(text));
  const y = [...toks].some((t) => L.yes.has(t));
  const n = [...toks].some((t) => L.no.has(t));
  if (y && !n) return 'yes';
  if (n && !y) return 'no';
  return 'unclear';
}

export function parseUtterance(text, contacts = []) {
  need();
  text = String(text || '').slice(0, 500);
  const tokens = tokenize(text);
  const tset = new Set(tokens);
  const has = (set) => tokens.some((t) => set.has(t));
  const out = {
    intent: 'unknown', language: detectLanguage(text), amount: null, recipient_raw: null,
    recipient: null, recipient_status: 'none', candidates: [], upi_id: null, phone: null,
    query: null, target: null, missing: [], notes: [], confidence: 0, source: 'local',
  };
  if (!tokens.length) { out.notes.push('empty'); return out; }
  if (has(L.secret)) { out.intent = 'secret_warning'; out.confidence = 1; return out; }

  const { amount, consumed, multi } = extractAmount(tokens);
  const joined = normalize(text);
  const m = UPI_RE.exec(joined);
  if (m) out.upi_id = m[0];
  const pm = PHONE_RE.exec(joined);
  if (pm) out.phone = pm[0];

  const hasVerb = has(L.payVerbs);
  const payish = hasVerb || amount !== null || multi;

  const nameTokens = tokens.filter((t, i) => !consumed.has(i) && !L.currency.has(t) && !L.payVerbs.has(t)
    && !L.fillers.has(t) && !L.yes.has(t) && !L.no.has(t) && !/^[\d.]+$/.test(t) && !UPI_FULL.test(t)).slice(0, 3);

  if (tokens.length <= 3 && !payish) {
    const c = parseConfirmation(text);
    if (c === 'yes') return Object.assign(out, { intent: 'confirm_yes', confidence: 0.95 });
    if (c === 'no') return Object.assign(out, { intent: 'confirm_no', confidence: 0.95 });
  }

  if (has(L.recharge) && !has(L.history)) {
    return Object.assign(out, { intent: 'bill_recharge', amount: amountOut(amount), confidence: 0.85 });
  }

  if (payish && !(has(L.balance) && !hasVerb) && !(has(L.history) && !hasVerb)) {
    out.intent = 'payment_request';
    out.amount = amountOut(amount);
    if (multi) out.notes.push('multiple_amounts');
    const pool = nameTokens.filter((t) => !(out.phone && t.includes(out.phone)));
    out.recipient_raw = pool.map(stripSuffix).join(' ') || null;
    const res = resolveContact(pool, contacts);
    out.recipient_status = res.status;
    out.candidates = res.candidates.map((c) => c.name);
    if (res.contact) out.recipient = res.contact.name;
    if (out.amount === null) out.missing.push('amount');
    if (!(out.recipient || out.recipient_raw || out.upi_id || out.phone)) out.missing.push('recipient');
    out.confidence = !out.missing.length && res.status === 'matched' ? 0.9 : 0.6;
    return out;
  }

  if (has(L.insight)) return Object.assign(out, { intent: 'insights', confidence: 0.85 });
  if (has(L.balance)) return Object.assign(out, { intent: 'balance_check', confidence: 0.9 });
  if (has(L.history)) {
    const q = nameTokens.filter((t) => !L.history.has(t)).map(stripSuffix).join(' ') || null;
    return Object.assign(out, { intent: 'transaction_history', query: q, confidence: 0.85 });
  }
  if (has(L.qr)) return Object.assign(out, { intent: 'scan_qr_help', confidence: 0.9 });
  for (const [target, words] of Object.entries(L.nav)) {
    if (tokens.some((t) => words.has(t))) return Object.assign(out, { intent: 'navigate', target, confidence: 0.85 });
  }
  if (has(L.help)) return Object.assign(out, { intent: 'help', confidence: 0.85 });
  out.notes.push('no_intent');
  void tset;
  return out;
}
