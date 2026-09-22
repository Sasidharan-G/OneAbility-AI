// Voice input via the Web Speech API (F01/F02). Falls back to typed input when unsupported.
import * as store from './store.js';

const Rec = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = () => !!Rec();

let active = null;

export function stopListening() { try { active?.abort(); } catch { /* ignore */ } active = null; }

/**
 * Listen once. Resolves { text } or { error } where error is one of:
 * unsupported | not-allowed | no-speech | network | aborted | audio-capture | unknown
 */
export function listen({ lang, onInterim } = {}) {
  return new Promise((resolve) => {
    const R = Rec();
    if (!R) { resolve({ error: 'unsupported' }); return; }
    stopListening();
    const rec = new R();
    active = rec;
    rec.lang = lang || store.get().settings.listenLang || 'en-IN';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let finalText = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; if (active === rec) active = null; resolve(r); } };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      if (onInterim) onInterim((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => done({ error: e.error || 'unknown' });
    rec.onend = () => done(finalText.trim() ? { text: finalText.trim() } : { error: 'no-speech' });
    try { rec.start(); } catch { done({ error: 'unknown' }); }
  });
}
