import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STRINGS } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
function walk(d) {
  return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
}

const used = new Set();
for (const f of walk(root)) {
  if (f.endsWith('i18n.js')) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  // keys passed through maps/arrays and then to t(): collect any 'ns.name' literal that exists in the dictionary
  for (const m of src.matchAll(/'((?:[a-z]+\.)+[a-zA-Z0-9]+)'/g)) if (m[1] in STRINGS.en) used.add(m[1]);
}
for (const m of ['voice', 'qr', 'contact', 'upi', 'bill']) used.add(`method.${m}`);
for (const c of ['mobile', 'electricity', 'water', 'dth']) { used.add(`bills.cat.${c}`); used.add(`bills.cat.${c}.hint`); }
for (const k of ['pay', 'voice', 'keys', 'access', 'privacy', 'trouble']) { used.add(`help.${k}.title`); used.add(`help.${k}.body`); }
for (let n = 1; n <= 6; n++) used.add(`bank.s${n}.title`);
for (const d of ['up', 'down', 'same']) { used.add(`insights.${d}`); used.add(`insights.say.${d}`); }
used.delete('method.');

test('every used key exists in English and Tamil', () => {
  const missing = [...used].filter((k) => !(k in STRINGS.en) || !(k in STRINGS.ta));
  assert.deepEqual(missing, []);
});

test('English and Tamil define exactly the same keys', () => {
  const en = Object.keys(STRINGS.en).sort(), ta = Object.keys(STRINGS.ta).sort();
  assert.deepEqual(en.filter((k) => !(k in STRINGS.ta)), []);
  assert.deepEqual(ta.filter((k) => !(k in STRINGS.en)), []);
});

test('placeholders match between languages', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.keys(STRINGS.en).filter((k) => ph(STRINGS.en[k]) !== ph(STRINGS.ta[k]));
  assert.deepEqual(bad, []);
});

test('no unused strings pile up (informational: fewer than 5% unused)', () => {
  const unused = Object.keys(STRINGS.en).filter((k) => !used.has(k));
  assert.ok(unused.length / Object.keys(STRINGS.en).length < 0.05, `unused: ${unused.join(', ')}`);
});

test('no rupee glyph inside spoken-style strings', () => {
  const spoken = Object.keys(STRINGS.en).filter((k) => /\.(say|readback|found|foundAmount|heard|readRow)$/.test(k));
  for (const k of spoken) { assert.ok(!STRINGS.en[k].includes('₹') && !STRINGS.ta[k].includes('₹'), k); }
});

test('help bodies have parallel line counts', () => {
  for (const k of ['pay', 'voice', 'keys', 'access', 'privacy', 'trouble']) {
    assert.equal(STRINGS.en[`help.${k}.body`].split('\n').length, STRINGS.ta[`help.${k}.body`].split('\n').length, k);
  }
});
