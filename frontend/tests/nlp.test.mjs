import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setLexicon, parseUtterance, parseConfirmation, ratio } from '../js/nlp.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
setLexicon(JSON.parse(readFileSync(join(dir, 'lexicon.json'), 'utf8')));
const DATA = JSON.parse(readFileSync(join(dir, 'nlp_cases.json'), 'utf8'));

for (const c of DATA.cases) {
  test(`parse: ${c.text || '<empty>'}`, () => {
    const got = parseUtterance(c.text, DATA.contacts);
    for (const [k, want] of Object.entries(c.expect)) {
      if (k === 'missing') assert.deepEqual([...got.missing].sort(), [...want].sort(), JSON.stringify(got));
      else if (k === 'query') assert.equal((got.query || '').toLowerCase(), want);
      else assert.equal(got[k], want, `${k}: ${JSON.stringify(got)}`);
    }
  });
}

for (const c of DATA.confirmations) {
  test(`confirm: ${c.text}`, () => assert.equal(parseConfirmation(c.text), c.expect));
}

test('difflib-compatible ratio', () => {
  assert.equal(ratio('kumar', 'kumar'), 1);
  assert.ok(Math.abs(ratio('kumar', 'kumara') - 10 / 11) < 1e-9);
  assert.equal(ratio('abc', 'xyz'), 0);
});

test('lone "one" is not an amount; phone is not an amount', () => {
  const a = parseUtterance('send money to one person', DATA.contacts);
  assert.equal(a.amount, null);
  const b = parseUtterance('pay 9876543210', DATA.contacts);
  assert.equal(b.amount, null);
  assert.equal(b.phone, '9876543210');
});
