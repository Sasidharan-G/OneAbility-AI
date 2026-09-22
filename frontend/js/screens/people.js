// Beneficiary management (F11): list, add, edit, delete, favourite, quick pay.
import * as store from '../store.js';
import * as a11y from '../a11y.js';
import { VPA_RE } from '../guards.js';
import { h, icon, t, btn, simBanner, pageHeader, field, listRow, emptyState, switchRow, confirmDialog, toast, navigate, debounce } from '../ui.js';

export function renderPeople(root) {
  const search = field({ label: t('people.search'), id: 'p-search', type: 'search', placeholder: t('people.searchPh') });
  const listEl = h('ul', { class: 'list' });
  const paint = () => {
    const q = search.input.value.trim().toLowerCase();
    const all = store.get().beneficiaries.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.upi_id || '').includes(q))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
    listEl.replaceChildren(...(all.length ? all.map((b) => h('li', { class: 'person' },
      h('a', { class: 'list-row grow', href: `#/person?id=${encodeURIComponent(b.id)}`, 'aria-label': t('people.editLabel', { name: b.name, upi: b.upi_id }) },
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, b.name, ' ', h('span', { class: `badge ${b.verified ? 'badge-ok' : 'badge-warn'}` }, b.verified ? t('people.verified') : t('people.unverified'))), h('span', { class: 'row-sub' }, b.upi_id))),
      h('button', { type: 'button', class: `icon-btn${b.favorite ? ' is-on' : ''}`, 'aria-pressed': String(b.favorite), 'aria-label': t('people.favoriteLabel', { name: b.name }),
        on: { click: () => { store.toggleFavorite(b.id); paint(); a11y.announce(b.favorite ? t('people.unfav', { name: b.name }) : t('people.fav', { name: b.name })); } } }, icon('star')),
      h('a', { class: 'icon-btn', href: `#/amount?to=${encodeURIComponent(b.id)}`, 'aria-label': t('home.payTo', { name: b.name }) }, icon('bolt')))) :
      [h('li', {}, emptyState(t('people.none'), t('people.noneHint')))]));
  };
  search.input.addEventListener('input', debounce(paint, 150));
  root.append(pageHeader(t('people.title')), simBanner(true), search.el, listEl,
    h('div', { class: 'actions' }, btn(t('people.add'), { ic: 'plus', href: '#/person?id=new' })), h('p', { class: 'hint' }, t('people.note')));
  paint();
  return store.subscribe(() => {});
}

export function renderPerson(root, { query }) {
  const id = query.get('id');
  const isNew = id === 'new';
  const existing = isNew ? null : store.get().beneficiaries.find((b) => b.id === id);
  if (!isNew && !existing) { navigate('#/people'); return; }

  const name = field({ label: t('person.name'), id: 'pn', maxlength: 40, value: existing?.name || '', required: true });
  const upi = field({ label: t('person.upi'), id: 'pu', inputmode: 'email', placeholder: 'name@bank', maxlength: 80, value: existing?.upi_id || '', hint: t('upi.hint'), required: true });
  const phone = field({ label: t('person.phone'), id: 'pp', inputmode: 'tel', maxlength: 10, value: existing?.phone || '', hint: t('person.phoneHint') });
  let favorite = existing?.favorite || false;

  const submit = (e) => {
    e.preventDefault();
    let bad = null;
    const n = name.input.value.trim();
    const u = upi.input.value.trim().toLowerCase();
    const p = phone.input.value.trim();
    name.setError(''); upi.setError(''); phone.setError('');
    if (n.length < 2) { name.setError(t('person.errName')); bad = bad || name; }
    if (!VPA_RE.test(u)) { upi.setError(t('upi.invalid')); bad = bad || upi; }
    else {
      const dup = store.beneficiaryByUpi(u);
      if (dup && dup.id !== id) { upi.setError(t('person.errDup', { name: dup.name })); bad = bad || upi; }
    }
    if (p && !/^[6-9]\d{9}$/.test(p)) { phone.setError(t('person.errPhone')); bad = bad || phone; }
    if (bad) { bad.input.focus(); a11y.feedback('error'); return; }
    if (isNew) store.addBeneficiary({ name: n, upi_id: u, phone: p, favorite });
    else store.updateBeneficiary(id, { name: n, upi_id: u, phone: p, favorite });
    a11y.feedback('success');
    toast(t(isNew ? 'person.added' : 'person.saved', { name: n }), 'success');
    navigate('#/people');
  };

  const del = existing ? btn(t('person.delete'), { ic: 'trash', variant: 'danger', size: 'md', onClick: async () => {
    if (await confirmDialog({ title: t('person.deleteTitle', { name: existing.name }), message: t('person.deleteMsg'), confirmLabel: t('person.delete'), danger: true })) {
      store.removeBeneficiary(existing.id);
      toast(t('person.deleted', { name: existing.name }), 'info');
      navigate('#/people');
    }
  } }) : null;

  root.append(pageHeader(t(isNew ? 'person.addTitle' : 'person.editTitle')),
    h('form', { class: 'stack', novalidate: true, on: { submit } }, name.el, upi.el, phone.el,
      switchRow({ label: t('person.favorite'), checked: favorite, onChange: (v) => { favorite = v; } }),
      h('p', { class: 'hint' }, t('person.unverifiedNote')),
      btn(t('common.save'), { type: 'submit', ic: 'check' }), del));
}
