// Offline integrity check: every named import must be exported by the module it comes from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });

function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); });
  return names;
}

test('every named import resolves to a real export', () => {
  const problems = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const target = resolve(dirname(file), m[2]);
      if (!existsSync(target)) { problems.push(`${file}: missing module ${m[2]}`); continue; }
      const ex = exportsOf(target);
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (name && !ex.has(name)) problems.push(`${relative(root, file)}: '${name}' is not exported by ${m[2]}`);
      }
    }
    for (const m of src.matchAll(/import\s+\*\s+as\s+\w+\s+from\s*'([^']+)'/g)) {
      if (!existsSync(resolve(dirname(file), m[1]))) problems.push(`${relative(root, file)}: missing module ${m[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('service worker precache list only names files that exist', () => {
  const sw = readFileSync(join(root, '..', 'sw.js'), 'utf8');
  const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  const list = [...shell.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => p !== '/');
  const missing = list.filter((p) => !existsSync(join(root, '..', p)));
  assert.deepEqual(missing, []);
});

test('every js module is precached for offline use', () => {
  const sw = readFileSync(join(root, '..', 'sw.js'), 'utf8');
  const missing = walk(root).map((f) => '/js/' + relative(root, f).split(sep).join('/')).filter((p) => !sw.includes(`'${p}'`));
  assert.deepEqual(missing, []);
});
