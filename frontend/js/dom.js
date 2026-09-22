// Tiny DOM helpers. Everything user-controlled goes through textContent, never innerHTML.

// Native append/replaceChildren turn null/undefined/false into the text "null". Screens conditionally
// pass optional elements, so make the insertion methods skip empty values and flatten arrays.
const skip = (a) => a === null || a === undefined || a === false;
for (const m of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function patched(...args) { return orig.apply(this, args.flat(Infinity).filter((a) => !skip(a))); };
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'required' || k === 'open') { if (v) el.setAttribute(k, ''); }
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  } else if (attrs !== undefined && attrs !== null) kids.unshift(attrs);
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let uid = 0;
export const nextId = (p = 'id') => `${p}-${++uid}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
