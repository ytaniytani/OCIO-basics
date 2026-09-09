// 用語集ページの検索。
//
// 用語の中身は HTML にそのまま書き出してあります(tools/build_glossary.py が作ります)。
// JavaScript が動かなくても全部読めるようにするためです。
// ここでやるのは、その一覧をしぼりこむ機能を足すことだけです。

import { el } from '../core/ui.js';

export default function glossary(mount) {
  const list = document.querySelector('.gl-list');
  if (!list) return;
  const items = [...list.querySelectorAll('.gl-item')];
  if (!items.length) return;

  const sections = [...new Set(items.map((i) => i.dataset.section))];
  let query = '';
  let section = 'all';

  const search = el('input', {
    type: 'search', class: 'gl-search',
    placeholder: '言葉をさがす(日本語でも英語でも)',
    'aria-label': '用語の検索',
  });
  const filters = el('div', {
    class: 'ctl-btns compact', role: 'radiogroup', 'aria-label': '分類でしぼりこむ',
  });
  const count = el('p', { class: 'gl-count', role: 'status', 'aria-live': 'polite' });
  const empty = el('p', {
    class: 'gl-empty', hidden: true,
    text: 'その言葉は見つかりませんでした。ちがう言いかたでさがしてみてください。',
  });

  const makeFilter = (value, label) => {
    const b = el('button', {
      type: 'button', class: 'btn btn-choice', role: 'radio',
      'aria-checked': value === section ? 'true' : 'false', text: label,
    });
    b.addEventListener('click', () => {
      section = value;
      for (const other of filters.children) other.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-checked', 'true');
      apply();
    });
    return b;
  };
  filters.appendChild(makeFilter('all', 'ぜんぶ'));
  for (const s of sections) filters.appendChild(makeFilter(s, s));

  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    apply();
  });

  mount.replaceChildren(el('div', { class: 'gl-controls' }, [search, filters]), count);
  list.parentNode.insertBefore(empty, list);

  function apply() {
    let hits = 0;
    for (const item of items) {
      const okSection = section === 'all' || item.dataset.section === section;
      const okQuery = !query || item.dataset.search.includes(query);
      const show = okSection && okQuery;
      item.hidden = !show;
      if (show) hits++;
    }
    count.textContent = `${hits} 語`;
    empty.hidden = hits > 0;
  }

  apply();
}
