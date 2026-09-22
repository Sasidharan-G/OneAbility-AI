// Secure authorization (F10, SEC-05). WebAuthn platform authenticator when available.
// The app only receives the OS verdict; it never sees a fingerprint, face, PIN or OTP.
// The demo fallback is explicit, user-triggered and labelled: it never claims biometric verification.
import * as store from './store.js';
import { api } from './api.js';

const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};

export async function webauthnAvailable() {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
    if (/^[\d.]+$/.test(location.hostname) || location.hostname.includes(':')) return false; // WebAuthn rejects IP addresses as RP IDs; use localhost
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

async function challenge() {
  const r = await api.get('/api/auth/challenge', 2500);
  if (r.ok && r.data.challenge) return b64.dec(r.data.challenge);
  return crypto.getRandomValues(new Uint8Array(32)); // offline: local challenge
}

async function enroll() {
  const p = store.get().profile;
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: await challenge(),
      rp: { name: 'OneAbility AI (simulation)' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'demo-user', displayName: p.name || 'Demo user' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60000,
    },
  });
  const id = b64.enc(cred.rawId);
  store.setCredential(id);
  return id;
}

/**
 * Ask the device to verify the user.
 * Returns { ok:true, method:'webauthn', credentialId } | { ok:false, reason:'cancelled'|'unsupported'|'error' }
 */
export async function authorizeWithDevice() {
  if (!(await webauthnAvailable())) return { ok: false, reason: 'unsupported' };
  try {
    let id = store.get().webauthn.credentialId;
    if (!id) id = await enroll();
    await navigator.credentials.get({
      publicKey: {
        challenge: await challenge(),
        allowCredentials: [{ type: 'public-key', id: b64.dec(id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    store.markAuthed();
    return { ok: true, method: 'webauthn', credentialId: id };
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return { ok: false, reason: 'cancelled' };
    if (e && e.name === 'InvalidStateError') { store.setCredential(null); return { ok: false, reason: 'error' }; }
    return { ok: false, reason: 'error' };
  }
}

/** Explicit demo approval. No credential of any kind is collected. */
export function authorizeDemo() {
  store.markAuthed();
  return { ok: true, method: 'demo' };
}

export const authLabel = (method) => (method === 'webauthn' ? 'Device authenticator (WebAuthn)' : 'Demo authorization (no biometric checked)');
