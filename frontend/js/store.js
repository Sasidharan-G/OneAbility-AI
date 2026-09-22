// localStorage-backed demo state (PRD 14). Demo persistence only: never holds PIN, OTP or biometrics.

const KEY = 'oneability.v1';
const SECRET_KEYS = new Set(['pin', 'upipin', 'upi_pin', 'otp', 'cvv', 'password', 'passcode', 'biometric', 'fingerprint', 'facedata', 'mpin', 'secret']);
const DAY = 86400000;

let memory = null; // fallback when storage is blocked
let state = null;
const listeners = new Set();

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const round2 = (n) => Math.round(n * 100) / 100;

export function uid(prefix = 'id') {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(16).slice(2, 14);
  return `${prefix}_${r}`;
}

export function mockTxnId() {
  const bytes = new Uint8Array(5);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes); else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  return 'MOCK-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function defaultSettings() {
  return {
    theme: 'system', contrast: false, textScale: 1, captions: true, speech: true, speechRate: 1, voiceURI: '',
    haptics: true, flash: true, dwell: false, dwellMs: 1200, simple: false, language: 'en', listenLang: 'en-IN',
    requireAuthForBalance: false, hideBalance: false, highAmount: 5000, autoListenConfirm: true,
  };
}

export function seedBeneficiaries() {
  return [
    { id: 'b_kumar', name: 'Kumar', upi_id: 'kumar@okbank', phone: '', verified: true, favorite: true },
    { id: 'b_priya', name: 'Priya Sharma', upi_id: 'priya.sharma@oksbi', phone: '', verified: true, favorite: true },
    { id: 'b_lakshmi', name: 'Lakshmi', upi_id: 'lakshmi@ybl', phone: '', verified: true, favorite: false },
    { id: 'b_arunp', name: 'Arun Prakash', upi_id: 'arun.prakash@okicici', phone: '', verified: true, favorite: false },
    { id: 'b_aruk', name: 'Arun Kumar', upi_id: 'arun.kumar@okhdfcbank', phone: '', verified: true, favorite: false },
    { id: 'b_meena', name: 'Meena', upi_id: 'meena@paytm', phone: '', verified: true, favorite: true },
    { id: 'b_ravi', name: 'Ravi', upi_id: 'ravi@upi', phone: '', verified: false, favorite: false },
  ];
}

export function seedBank() {
  return { id: 'bank_sbi_4321', name: 'State Bank of India', masked: '•••• 4321', kind: 'Savings', primary: true, balance: 25000, linkedAt: Date.now(), demo: true };
}

function seedTransactions(now) {
  const mk = (n, recipient, upi, amount, ago, method, note) => ({
    id: `MOCK-SEED${String(n).padStart(5, '0')}`, flowId: `seed_${n}`, recipient, upi_id: upi, amount, ts: now - ago, status: 'success',
    bankId: 'bank_sbi_4321', bankName: 'State Bank of India', method, note: note || '', authMethod: 'demo', authLabel: 'Demo authorization', simulated: true,
  });
  return [
    mk(1, 'Meena', 'meena@paytm', 800, 1 * DAY + 3600000, 'contact', 'Groceries'),
    mk(2, 'Priya Sharma', 'priya.sharma@oksbi', 1200, 2 * DAY + 7200000, 'voice', ''),
    mk(3, 'TNEB Electricity', 'tneb@billpay', 1460, 4 * DAY, 'bill', 'Consumer 0123456789'),
    mk(4, 'Lakshmi', 'lakshmi@ybl', 350, 6 * DAY + 5400000, 'qr', 'Tea shop'),
    mk(5, 'Kumar', 'kumar@okbank', 150, 8 * DAY, 'contact', ''),
    mk(6, 'Airtel', 'airtel@billpay', 299, 33 * DAY, 'bill', 'Mobile: 9876500000'),
    mk(7, 'Priya Sharma', 'priya.sharma@oksbi', 2200, 36 * DAY, 'voice', 'Rent share'),
    mk(8, 'TNEB Electricity', 'tneb@billpay', 1380, 41 * DAY, 'bill', 'Consumer 0123456789'),
    mk(9, 'Meena', 'meena@paytm', 640, 47 * DAY, 'contact', 'Groceries'),
  ];
}

export function freshState(now = Date.now()) {
  return {
    version: 1,
    profile: { name: '', nickname: '', onboarded: false },
    settings: defaultSettings(),
    banks: [seedBank()],
    beneficiaries: seedBeneficiaries(),
    transactions: seedTransactions(now),
    webauthn: { credentialId: null },
    session: { authedAt: 0 },
  };
}

function strip(obj) {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_KEYS.has(k.toLowerCase().replace(/-/g, '_'))) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return obj;
}

function merge(saved) {
  const base = freshState();
  const s = strip(saved || {});
  return {
    ...base, ...s,
    profile: { ...base.profile, ...(s.profile || {}) },
    settings: { ...base.settings, ...(s.settings || {}) },
    webauthn: { ...base.webauthn, ...(s.webauthn || {}) },
    session: { authedAt: 0 },
    banks: Array.isArray(s.banks) ? s.banks : base.banks,
    beneficiaries: Array.isArray(s.beneficiaries) ? s.beneficiaries : base.beneficiaries,
    transactions: Array.isArray(s.transactions) ? s.transactions : base.transactions,
    version: 1,
  };
}

export function load() {
  let raw = null;
  try { raw = storage()?.getItem(KEY) ?? null; } catch { raw = null; }
  if (raw === null && memory) raw = memory;
  if (raw) {
    try { state = merge(JSON.parse(raw)); return state; } catch { /* corrupt: fall through to fresh */ }
  }
  state = freshState();
  persist();
  return state;
}

function persist() {
  const json = JSON.stringify(state);
  memory = json;
  try { storage()?.setItem(KEY, json); } catch { /* quota or blocked: memory copy remains */ }
}

export function get() { if (!state) load(); return state; }

export function update(mutator) {
  const s = get();
  mutator(s);
  persist();
  listeners.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
  return s;
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------------------------------------------------------------- selectors
export const primaryBank = () => { const b = get().banks; return b.find((x) => x.primary) || b[0] || null; };
export const bankById = (id) => get().banks.find((b) => b.id === id) || null;
export const balance = (bankId) => { const b = bankId ? bankById(bankId) : primaryBank(); return b ? b.balance : null; };
export const beneficiaryByName = (name) => get().beneficiaries.find((b) => b.name === name) || null;
export const beneficiaryByUpi = (upi) => get().beneficiaries.find((b) => (b.upi_id || '').toLowerCase() === String(upi || '').toLowerCase()) || null;
export const recentTransactions = (n = 20) => [...get().transactions].sort((a, b) => b.ts - a.ts).slice(0, n);
export const transactionById = (id) => get().transactions.find((t) => t.id === id) || null;
export const displayName = () => { const p = get().profile; return p.nickname || p.name || ''; };

// ---------------------------------------------------------------- mutators
export function setSetting(key, value) { update((s) => { s.settings[key] = value; }); }
export function setProfile(patch) { update((s) => { Object.assign(s.profile, patch); }); }

export function addBeneficiary(b) {
  const rec = { id: uid('b'), name: b.name.trim(), upi_id: (b.upi_id || '').trim().toLowerCase(), phone: (b.phone || '').trim(), verified: false, favorite: !!b.favorite };
  update((s) => { s.beneficiaries.push(rec); });
  return rec;
}
export function updateBeneficiary(id, patch) {
  update((s) => {
    const b = s.beneficiaries.find((x) => x.id === id);
    if (!b) return;
    if (patch.name !== undefined) b.name = patch.name.trim();
    if (patch.upi_id !== undefined) { const u = patch.upi_id.trim().toLowerCase(); if (u !== b.upi_id) b.verified = false; b.upi_id = u; }
    if (patch.phone !== undefined) b.phone = patch.phone.trim();
    if (patch.favorite !== undefined) b.favorite = !!patch.favorite;
  });
}
export function removeBeneficiary(id) { update((s) => { s.beneficiaries = s.beneficiaries.filter((b) => b.id !== id); }); }
export function toggleFavorite(id) { update((s) => { const b = s.beneficiaries.find((x) => x.id === id); if (b) b.favorite = !b.favorite; }); }

export function addBank(bank) {
  const rec = { id: uid('bank'), name: bank.name, masked: bank.masked, kind: bank.kind || 'Savings', primary: false, balance: bank.balance, linkedAt: Date.now(), demo: true };
  update((s) => {
    if (bank.primary || !s.banks.length) { s.banks.forEach((b) => { b.primary = false; }); rec.primary = true; }
    s.banks.push(rec);
  });
  return rec;
}
export function setPrimaryBank(id) { update((s) => { s.banks.forEach((b) => { b.primary = b.id === id; }); }); }
export function removeBank(id) {
  update((s) => {
    s.banks = s.banks.filter((b) => b.id !== id);
    if (s.banks.length && !s.banks.some((b) => b.primary)) s.banks[0].primary = true;
  });
}

/** Apply a successful simulated payment exactly once (idempotent on flowId). SEC-06 / acceptance 19. */
export function applyTransaction(txn) {
  const existing = get().transactions.find((t) => t.flowId === txn.flowId);
  if (existing) return { txn: existing, duplicate: true };
  const bank = txn.bankId ? bankById(txn.bankId) : primaryBank();
  if (!bank) throw new Error('No linked bank');
  if (txn.amount > bank.balance) throw new Error('Insufficient balance');
  const rec = { ...txn, bankId: bank.id, bankName: bank.name, status: 'success', simulated: true };
  update((s) => {
    const b = s.banks.find((x) => x.id === bank.id);
    b.balance = round2(b.balance - txn.amount);
    s.transactions.push(rec);
  });
  return { txn: rec, duplicate: false };
}

export function markAuthed() { update((s) => { s.session.authedAt = Date.now(); }); }
export const recentlyAuthed = (ms = 300000) => Date.now() - get().session.authedAt < ms;
export function setCredential(id) { update((s) => { s.webauthn.credentialId = id; }); }

export function resetDemo() { state = freshState(); persist(); listeners.forEach((fn) => fn(state)); return state; }

export function exportData() {
  const s = strip(get());
  return JSON.stringify({ exportedAt: new Date().toISOString(), note: 'OneAbility AI demo data. Simulation only, no real money or credentials.', data: s }, null, 2);
}

export const maskAccount = (last4) => `•••• ${String(last4).slice(-4)}`;
export const _resetForTests = () => { state = null; memory = null; };
