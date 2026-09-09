// ui.js — インタラクティブ部品の共通の枠と、操作部品を作るための道具。
//
// 仕様 (docs/INTERACTIVES.md) の「共通仕様」をここで実装しています。
//   ・どの部品にも必ずリセットボタンがある(壊しても戻せる)
//   ・数値は常に見える(スライダーだけで隠さない)
//   ・状態に応じた1行コメントを出す

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

let widgetSeq = 0;

/**
 * 部品の外枠を作ります。
 * @param {HTMLElement} mount 置き場所
 * @param {{title: string, aim: string, simplified?: boolean, wide?: boolean}} o
 */
export function createWidget(mount, o) {
  const id = 'w' + (++widgetSeq);
  const aim = el('p', { class: 'w-aim', text: o.aim });
  const view = el('div', { class: 'w-view' });
  const controls = el('div', { class: 'w-controls' });
  const readout = el('div', { class: 'w-readout', role: 'status', 'aria-live': 'polite' });
  const detailsBody = el('div', { class: 'w-details-body' });
  const details = el('details', { class: 'w-details' }, [
    el('summary', { text: 'もっとくわしく' }), detailsBody,
  ]);
  const resetBtn = el('button', { class: 'btn btn-reset', type: 'button', text: 'リセット' });
  const badges = el('div', { class: 'w-badges' });
  if (o.simplified) {
    badges.appendChild(el('span', {
      class: 'badge badge-simplified',
      title: '本物の処理とは細部が異なります',
      text: '学習用の簡略版',
    }));
  }
  const head = el('div', { class: 'w-head' }, [
    el('h3', { class: 'w-title', id: id + '-t', text: o.title }), badges,
  ]);
  const foot = el('div', { class: 'w-foot' }, [resetBtn, details]);
  const root = el('section', {
    class: 'widget' + (o.wide ? ' widget-wide' : ''),
    'aria-labelledby': id + '-t',
  }, [head, aim, view, controls, readout, foot]);

  mount.replaceChildren(root);

  const api = {
    root, view, controls, readout, details, detailsBody, id,
    _resetFns: [],
    /** 「よみとり」欄を書き換えます。 */
    say(html) { readout.innerHTML = html; },
    /** リセット時にやることを登録します。 */
    onReset(fn) { this._resetFns.push(fn); },
    /** 「もっとくわしく」の中身を差し込みます。 */
    setDetails(node) { detailsBody.replaceChildren(typeof node === 'string' ? el('div', { html: node }) : node); },
  };
  resetBtn.addEventListener('click', () => api._resetFns.forEach((f) => f()));
  return api;
}

/**
 * スライダー。数値表示と直接入力を必ず付けます。
 * @returns {{root: HTMLElement, get: () => number, set: (v:number, silent?:boolean)=>void}}
 */
export function slider(o) {
  const {
    label, min, max, step = 0.01, value = 0, unit = '',
    format = (v) => v.toFixed(step >= 1 ? 0 : 2),
    onChange = () => {},
  } = o;
  const input = el('input', {
    type: 'range', min, max, step, value,
    class: 'ctl-range', 'aria-label': label,
  });
  const num = el('input', { type: 'number', min, max, step, value, class: 'ctl-num', 'aria-label': label + '(数値)' });
  const unitEl = unit ? el('span', { class: 'ctl-unit', text: unit }) : null;
  const labelEl = el('label', { class: 'ctl-label', text: label });
  const root = el('div', { class: 'ctl ctl-slider' }, [
    labelEl,
    el('div', { class: 'ctl-row' }, [input, num, unitEl]),
  ]);
  let current = Number(value);
  const emit = () => { num.value = format(current); onChange(current); };
  input.addEventListener('input', () => { current = Number(input.value); emit(); });
  num.addEventListener('change', () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) { current = Math.min(max, Math.max(min, v)); input.value = current; emit(); }
  });
  num.value = format(current);
  return {
    root,
    get: () => current,
    set(v, silent) {
      current = Math.min(max, Math.max(min, Number(v)));
      input.value = current; num.value = format(current);
      if (!silent) onChange(current);
    },
  };
}

/** ボタンをならべた選択。ラジオボタンとして読み上げられます。 */
export function buttonGroup(o) {
  const { label, options, value, onChange = () => {}, compact = false } = o;
  const group = el('div', { class: 'ctl-btns' + (compact ? ' compact' : ''), role: 'radiogroup', 'aria-label': label });
  let current = value;
  const buttons = new Map();
  for (const opt of options) {
    const key = typeof opt === 'string' ? opt : opt.value;
    const text = typeof opt === 'string' ? opt : opt.label;
    const b = el('button', {
      type: 'button', class: 'btn btn-choice', role: 'radio',
      'aria-checked': key === current ? 'true' : 'false',
      text,
      title: (typeof opt === 'object' && opt.note) || null,
    });
    b.addEventListener('click', () => { setValue(key); onChange(key); });
    buttons.set(key, b);
    group.appendChild(b);
  }
  function setValue(key) {
    current = key;
    for (const [k, b] of buttons) b.setAttribute('aria-checked', k === key ? 'true' : 'false');
  }
  const root = el('div', { class: 'ctl ctl-choice' }, [
    label ? el('span', { class: 'ctl-label', text: label }) : null, group,
  ]);
  return { root, get: () => current, set(v, silent) { setValue(v); if (!silent) onChange(v); } };
}

/** オン/オフのトグル。 */
export function toggle(o) {
  const { label, value = false, onChange = () => {}, note = null } = o;
  const input = el('input', { type: 'checkbox', class: 'ctl-check', checked: value });
  const root = el('label', { class: 'ctl ctl-toggle' }, [
    input, el('span', { class: 'ctl-label', text: label }),
    note ? el('span', { class: 'ctl-note', text: note }) : null,
  ]);
  input.addEventListener('change', () => onChange(input.checked));
  return { root, get: () => input.checked, set(v, silent) { input.checked = !!v; if (!silent) onChange(input.checked); } };
}

/** ドロップダウン。選択肢が多いときに使います。 */
export function select(o) {
  const { label, options, value, onChange = () => {} } = o;
  const sel = el('select', { class: 'ctl-select', 'aria-label': label });
  for (const opt of options) {
    const key = typeof opt === 'string' ? opt : opt.value;
    const text = typeof opt === 'string' ? opt : opt.label;
    sel.appendChild(el('option', { value: key, text, selected: key === value }));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  const root = el('div', { class: 'ctl ctl-select-wrap' }, [
    label ? el('label', { class: 'ctl-label', text: label }) : null, sel,
  ]);
  return { root, get: () => sel.value, set(v, silent) { sel.value = v; if (!silent) onChange(sel.value); } };
}

/** 押しボタン。 */
export function button(label, onClick, cls = '') {
  return el('button', { type: 'button', class: 'btn ' + cls, text: label, onclick: onClick });
}

/** 操作部品を1行にまとめます。 */
export function row(children, cls = '') {
  return el('div', { class: 'ctl-group ' + cls }, children);
}

/** 色見本の四角。 */
export function swatch(cssColor, label) {
  return el('span', { class: 'swatch' }, [
    el('span', { class: 'swatch-box', style: `background:${cssColor}` }),
    label ? el('span', { class: 'swatch-label', text: label }) : null,
  ]);
}

/** 数値を読みやすく。大きい値は桁を省略します。 */
export function fmtNum(v, digits = 2) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return Math.round(v).toLocaleString('ja-JP');
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(digits);
}

/** 0..1 の値を 8bit のコード値に。 */
export function fmt8bit(v) {
  return String(Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/**
 * 画面に入るまで初期化を待ちます。重い部品を一度に動かさないためです。
 * @param {HTMLElement} node
 * @param {() => void} init
 */
export function whenVisible(node, init) {
  if (!('IntersectionObserver' in window)) { init(); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { io.disconnect(); init(); }
    }
  }, { rootMargin: '200px' });
  io.observe(node);
}

/** 描画をまとめて1フレームに1回にします。 */
export function throttleFrame(fn) {
  let queued = false;
  return function scheduled(...args) {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

/** JavaScript が要る部品の置き場所に、動かないときの案内を入れておきます。 */
export function mountPoint(id) {
  const node = document.getElementById(id);
  if (!node) return null;
  return node;
}

/**
 * 部品の中で例外が出ても、ページ全体は読めるようにします。
 * @param {HTMLElement} mount
 * @param {() => void} fn
 */
export function guard(mount, fn) {
  try {
    fn();
  } catch (err) {
    console.error(err);
    mount.replaceChildren(el('div', { class: 'widget widget-error' }, [
      el('p', { text: 'この部品を表示できませんでした。ページを読みこみ直してみてください。' }),
      el('pre', { class: 'err', text: String(err && err.message ? err.message : err) }),
    ]));
  }
}

/**
 * 画像を出す枠を1つ作ります。ラベルと、右に小さな補足を付けられます。
 * @returns {{root: HTMLElement, canvas: HTMLCanvasElement, setTag: (s:string)=>void}}
 */
export function imagePane(label, tag = '') {
  const canvas = el('canvas', { class: 'pane-canvas' });
  const tagEl = el('span', { class: 'tag', text: tag });
  const labelEl = el('div', { class: 'pane-label' }, [
    el('span', { text: label }), tagEl,
  ]);
  const root = el('div', { class: 'pane' }, [labelEl, canvas]);
  return { root, canvas, setTag: (s) => { tagEl.textContent = s; } };
}

/** 画像の枠を横にならべる入れものを作ります。 */
export function paneGrid(cols, panes) {
  return el('div', { class: `pane-grid cols-${cols}` }, panes.map((p) => p.root || p));
}
