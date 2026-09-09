// I-10 config.ocio ライブエディタ(第7章)
// ねらい: 設定ファイルを自分で書きかえて、絵が変わる体験をする。
//
// 合否の判定は文字列の一致では行いません。エンジンが実際に変換した結果を見て決めます。

import {
  createWidget, el, button, buttonGroup, select,
} from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import { loadConfig } from '../core/ocio-mini.js';
import { saveTaskState, loadTaskState } from '../core/progress.js';

const CONFIG_DIR = 'assets/data/configs/';

const TASKS = [
  {
    id: 'add-colorspace',
    file: 'minimal.ocio',
    title: '課題1 色空間をふやす',
    goal: 'my_gamma22 という色空間を足して、画面の「見せかた」から選べるようにしてください。',
    hints: [
      'colorspaces の下に、もう1つ「- !<ColorSpace>」を足します。',
      'name は my_gamma22 にします。',
      'to_reference: !<ExponentTransform> {value: [2.2, 2.2, 2.2, 1]} と書くと、2.2 乗で光の量にもどす色空間になります。',
      'そのあと displays の下に「- !<View> {name: ガンマ2.2, colorspace: my_gamma22}」を足します。',
    ],
    snippets: [
      {
        label: '色空間のひな形を入れる',
        section: 'colorspaces',
        text: `  - !<ColorSpace>
    name: my_gamma22
    family: 練習
    description: 2.2乗で曲げるだけの色空間
    to_reference: !<ExponentTransform> {value: [2.2, 2.2, 2.2, 1]}
`,
      },
      {
        label: 'View のひな形を入れる',
        section: 'displays',
        text: '    - !<View> {name: ガンマ2.2, colorspace: my_gamma22}\n',
      },
    ],
    check: checkTask1,
  },
  {
    id: 'fix-role',
    file: 'broken-role.ocio',
    title: '課題2 こわれたロールを直す',
    goal: 'この設定は1か所こわれています。エラーを読んで直してください。直す前に、まず何が起きているか見てください。',
    hints: [
      'エラーは roles のところを指しています。',
      'scene_linear は「光の量そのもの」の色空間を指す約束です。',
      'この設定で光の量そのものを表しているのは linear です。',
    ],
    snippets: [],
    check: checkTask2,
  },
  {
    id: 'add-look',
    file: 'looks.ocio',
    title: '課題3 味付けをふやす',
    goal: '少し青くする look を足して、新しい見せかたとして選べるようにしてください。',
    hints: [
      'looks の下に、もう1つ「- !<Look>」を足します。',
      'transform: !<CDLTransform> {slope: [0.95, 1.0, 1.1]} と書くと、青が強くなります。',
      'そのあと displays に「- !<View> {name: ひんやり, colorspace: srgb_display, looks: cool}」を足します。',
    ],
    snippets: [
      {
        label: 'look のひな形を入れる',
        section: 'looks',
        text: `  - !<Look>
    name: cool
    process_space: grading
    description: 少し青くする
    transform: !<CDLTransform> {slope: [0.95, 1.0, 1.1]}
`,
      },
      {
        label: 'View のひな形を入れる',
        section: 'displays',
        text: '    - !<View> {name: ひんやり, colorspace: srgb_display, looks: cool}\n',
      },
    ],
    check: checkTask3,
  },
  {
    id: 'two-displays',
    file: 'two-displays.ocio',
    title: '課題4 出力先を切りかえる',
    goal: '2つの画面(sRGB と Rec709)を切りかえて、同じ映像がどう変わるか見てください。設定は直っています。切りかえて確かめるだけです。',
    hints: [
      'プレビューの上にある「画面」を切りかえてください。',
      '色空間の定義は同じでも、出力の約束がちがうと結果が変わります。',
    ],
    snippets: [],
    check: checkTask4,
  },
];

const SCENES = [
  { value: 'chart', label: 'カラーチャート' },
  { value: 'cgball', label: 'CGの球' },
  { value: 'window', label: '逆光の部屋' },
];

// ---------------------------------------------------------------------------
// 合否の判定。すべて「実際に変換してみた結果」で決めます。
// ---------------------------------------------------------------------------

function findViewWithColorSpace(config, csName) {
  for (const d of config.getDisplayNames()) {
    for (const v of config.displays.get(d)) {
      if (v.colorspace === csName) return { display: d, view: v.name };
    }
  }
  return null;
}

function checkTask1(config) {
  if (!config.colorspaces.has('my_gamma22')) {
    return { ok: false, why: 'まだ my_gamma22 という色空間がありません。colorspaces に足してください。' };
  }
  const hit = findViewWithColorSpace(config, 'my_gamma22');
  if (!hit) {
    return { ok: false, why: 'my_gamma22 は作れました。あとは displays の View から選べるようにしてください。' };
  }
  const p = config.getProcessor({ src: config.getRole('scene_linear'), ...hit });
  for (const x of [0.05, 0.18, 0.5]) {
    const got = p.applyCPU([x, x, x])[0];
    const want = Math.pow(x, 1 / 2.2);
    if (Math.abs(got - want) > 0.005) {
      return {
        ok: false,
        why: `View から選べるようになりましたが、変換の中身が 2.2 乗になっていません。`
          + `光の量 ${x} を入れると ${want.toFixed(4)} になるはずですが、いまは ${got.toFixed(4)} です。`,
      };
    }
  }
  return { ok: true, why: 'できました。2.2 乗の色空間を自分で定義して、画面から選べるようにしました。' };
}

function checkTask2(config) {
  const sl = config.getRole('scene_linear');
  if (!sl) return { ok: false, why: 'scene_linear のロールがありません。' };
  const cs = config.colorspaces.get(sl);
  if (!cs) return { ok: false, why: `scene_linear が指している "${sl}" が見つかりません。` };
  if (cs.encoding && cs.encoding !== 'scene-linear') {
    return { ok: false, why: `scene_linear がまだ "${sl}" を指しています。光の量そのものの色空間を指してください。` };
  }
  // 光の量として正しく扱えているかを、足し算で確かめます。
  const d = config.getDisplayNames()[0];
  const v = config.getViewNames(d)[0];
  const p = config.getProcessor({ src: sl, display: d, view: v });
  const a = p.applyCPU([0.18, 0.18, 0.18])[0];
  const b = p.applyCPU([0.36, 0.36, 0.36])[0];
  if (!(b > a + 0.05)) {
    return { ok: false, why: '光を2倍にしても結果がほとんど変わりません。まだどこかがおかしいようです。' };
  }
  return { ok: true, why: 'できました。scene_linear が光の量そのものを指すようになり、明るさの計算が正しく動きます。' };
}

function checkTask3(config) {
  if (config.looks.size < 2) {
    return { ok: false, why: 'まだ look が1つだけです。looks にもう1つ足してください。' };
  }
  const base = findViewNoLooks(config);
  const withLook = findViewWithNewLook(config);
  if (!withLook) {
    return { ok: false, why: 'look は作れました。あとは View の looks に、その名前を書いてください。' };
  }
  if (!base) return { ok: false, why: '比べるための「味付けなし」の View が見つかりません。' };
  const p0 = config.getProcessor({ src: config.getRole('scene_linear'), ...base });
  const p1 = config.getProcessor({ src: config.getRole('scene_linear'), ...withLook });
  const grey = [0.18, 0.18, 0.18];
  const c0 = p0.applyCPU(grey), c1 = p1.applyCPU(grey);
  const blueGain = c1[2] - c0[2];
  const redGain = c1[0] - c0[0];
  if (blueGain <= 0.005 || blueGain <= redGain) {
    return {
      ok: false,
      why: `View には look が付きましたが、まだ青が強くなっていません。`
        + `いまの差は 青 ${(blueGain * 100).toFixed(1)}% / 赤 ${(redGain * 100).toFixed(1)}% です。`
        + `slope の3つ目の数(青)を大きくしてみてください。`,
    };
  }
  return { ok: true, why: `できました。青が ${(blueGain * 100).toFixed(1)}% 強くなっています。味付けを自分で定義できました。` };
}

function findViewNoLooks(config) {
  for (const d of config.getDisplayNames()) {
    for (const v of config.displays.get(d)) {
      if (!v.looks.length && !config.colorspaces.get(v.colorspace).isdata) return { display: d, view: v.name };
    }
  }
  return null;
}

function findViewWithNewLook(config) {
  for (const d of config.getDisplayNames()) {
    for (const v of config.displays.get(d)) {
      if (v.looks.some((l) => l.name !== 'warm')) return { display: d, view: v.name };
    }
  }
  return null;
}

function checkTask4(config) {
  const ds = config.getDisplayNames();
  if (ds.length < 2) return { ok: false, why: '画面が2つ必要です。' };
  const grey = [0.18, 0.18, 0.18];
  const a = config.getProcessor({ src: config.getRole('scene_linear'), display: ds[0], view: config.getViewNames(ds[0])[0] }).applyCPU(grey);
  const b = config.getProcessor({ src: config.getRole('scene_linear'), display: ds[1], view: config.getViewNames(ds[1])[0] }).applyCPU(grey);
  const diff = Math.abs(a[0] - b[0]);
  if (diff < 0.001) {
    return { ok: false, why: '2つの画面で結果が同じです。ちがう出力変換になっているか確かめてください。' };
  }
  return {
    ok: true,
    why: `2つの画面で、同じ中間グレーの数値が ${a[0].toFixed(3)} と ${b[0].toFixed(3)} になりました。`
      + `作業の中身は変えずに、出力先だけ差しかえられます。`,
  };
}

// ---------------------------------------------------------------------------
// 色分け表示
// ---------------------------------------------------------------------------

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(text, errorLines) {
  return text.split('\n').map((line, i) => {
    let h = escapeHTML(line);
    // コメント
    h = h.replace(/(#.*)$/, '<span class="y-cm">$1</span>');
    // 型タグ
    h = h.replace(/(!&lt;[A-Za-z0-9_]+&gt;)/g, '<span class="y-tag">$1</span>');
    // キー
    h = h.replace(/^(\s*-?\s*)([A-Za-z_][\w.-]*)(:)/, '$1<span class="y-key">$2</span>$3');
    // 文字列
    h = h.replace(/(&quot;[^&]*?&quot;|'[^']*')/g, '<span class="y-str">$1</span>');
    // 数値
    h = h.replace(/(?<![\w.-])(-?\d+\.?\d*)(?![\w.-])/g, '<span class="y-num">$1</span>');
    const bad = errorLines.has(i + 1) ? ' y-bad' : '';
    return `<span class="y-line${bad}">${h || ' '}</span>`;
  }).join('');
}

// ---------------------------------------------------------------------------

export default function i10(mount) {
  const w = createWidget(mount, {
    title: 'config.ocio を書きかえてみる',
    aim: '左のファイルを直すと、右の絵がすぐ変わります。こわしても、リセットで元にもどせます。',
    simplified: true,
    wide: true,
  });

  // --- 課題 ---
  let taskIndex = 0;
  const taskPick = buttonGroup({
    label: '課題',
    options: TASKS.map((t, i) => ({ value: String(i), label: t.title })),
    value: '0', compact: true,
    onChange: (v) => { taskIndex = Number(v); loadTask(); },
  });
  const goal = el('p', { class: 'task-goal' });
  const hintBox = el('div', { class: 'task-hints' });
  const hintBtn = button('ヒントを見る', showNextHint);
  const result = el('p', { class: 'task-result' });
  let hintsShown = 0;

  // --- エディタ ---
  const gutter = el('div', { class: 'ed-gutter', 'aria-hidden': 'true' });
  const hl = el('pre', { class: 'ed-hl', 'aria-hidden': 'true' });
  const ta = el('textarea', {
    class: 'ed-input', spellcheck: 'false', autocapitalize: 'off',
    autocorrect: 'off', wrap: 'off', 'aria-label': 'config.ocio の中身',
  });
  const editor = el('div', { class: 'editor' }, [
    gutter, el('div', { class: 'ed-wrap' }, [hl, ta]),
  ]);
  const snippetBar = el('div', { class: 'ctl-btns compact' });
  const problems = el('div', { class: 'ed-problems', role: 'status', 'aria-live': 'polite' });

  // --- プレビュー ---
  const canvas = el('canvas', { class: 'preview-canvas' });
  const displaySel = select({ label: '画面 (display)', options: ['sRGB'], value: 'sRGB', onChange: () => render() });
  const viewSel = select({ label: '見せかた (view)', options: ['標準'], value: '標準', onChange: () => render() });
  const srcSel = select({ label: '素材の色空間', options: ['linear'], value: 'linear', onChange: () => render() });
  const scenePick = buttonGroup({
    label: '素材', options: SCENES, value: 'chart', compact: true,
    onChange: (v) => { sceneName = v; loadScene(); render(); },
  });

  const left = el('div', { class: 'ed-col' }, [
    el('div', { class: 'pane-label' }, [el('span', { text: 'config.ocio' })]),
    editor, snippetBar, problems,
  ]);
  const right = el('div', { class: 'ed-col' }, [
    el('div', { class: 'pane-label' }, [el('span', { text: 'プレビュー' })]),
    canvas,
    el('div', { class: 'preview-controls' }, [displaySel.root, viewSel.root, srcSel.root]),
    scenePick.root,
  ]);
  w.view.appendChild(el('div', { class: 'editor-layout' }, [left, right]));
  w.controls.append(taskPick.root, goal, hintBox, el('div', { class: 'ctl-group' }, [hintBtn]), result);

  const renderer = new Renderer(canvas);
  let sceneName = 'chart';
  let originalText = '';
  let currentConfig = null;

  function loadScene() {
    renderer.setImage(getScene(sceneName, 480, sceneName === 'chart' ? 320 : 270));
  }

  // --- 課題の読みこみ ---
  async function loadTask() {
    const t = TASKS[taskIndex];
    goal.textContent = t.goal;
    hintBox.replaceChildren();
    hintsShown = 0;
    hintBtn.hidden = t.hints.length === 0;
    hintBtn.textContent = 'ヒントを見る';
    result.textContent = '';
    result.className = 'task-result';
    snippetBar.replaceChildren(...t.snippets.map(
      (s) => button(s.label, () => insertIntoSection(s.section, s.text), 'btn-snippet')));

    const saved = loadTaskState(t.id);
    let text = saved && saved.text;
    if (!text) {
      try {
        const res = await fetch(CONFIG_DIR + t.file);
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
      } catch (err) {
        text = `# ${t.file} を読みこめませんでした (${err.message})\n`;
      }
    }
    originalText = await fetchOriginal(t.file);
    ta.value = text;
    update();
  }

  const originalCache = new Map();
  async function fetchOriginal(file) {
    if (originalCache.has(file)) return originalCache.get(file);
    try {
      const res = await fetch(CONFIG_DIR + file);
      const text = res.ok ? await res.text() : '';
      originalCache.set(file, text);
      return text;
    } catch (err) {
      return '';
    }
  }

  function showNextHint() {
    const t = TASKS[taskIndex];
    if (hintsShown >= t.hints.length) return;
    hintBox.appendChild(el('p', { class: 'hint', text: `ヒント${hintsShown + 1}: ${t.hints[hintsShown]}` }));
    hintsShown++;
    hintBtn.textContent = hintsShown >= t.hints.length ? 'ヒントは以上です' : 'つぎのヒント';
    hintBtn.disabled = hintsShown >= t.hints.length;
  }

  /**
   * 指定した節(colorspaces / displays / looks)の終わりに文を足します。
   * カーソルの位置に入れると設定を壊してしまうので、入れる場所をこちらで決めます。
   */
  function insertIntoSection(section, text) {
    const lines = ta.value.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp('^' + section + ':').test(lines[i])) { start = i; break; }
    }
    if (start < 0) {
      // その節がまだ無ければ、ファイルの終わりに節ごと足します。
      ta.value = ta.value.replace(/\n*$/, '\n\n') + section + ':\n' + text;
      afterInsert(ta.value.length);
      return;
    }
    // 節の終わり(次に来る、行頭から始まる行)を探します。
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[^\s#]/.test(lines[i])) { end = i; break; }
    }
    while (end > start + 1 && lines[end - 1].trim() === '') end--;
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    lines.splice(end, 0, ...body.split('\n'));
    ta.value = lines.join('\n');
    const caret = lines.slice(0, end).join('\n').length + 1;
    afterInsert(caret);
  }

  function afterInsert(caret) {
    ta.focus();
    ta.selectionStart = ta.selectionEnd = Math.min(caret, ta.value.length);
    update();
    // 足した場所が見えるように、そこまでスクロールします。
    const lineHeight = ta.scrollHeight / Math.max(1, ta.value.split('\n').length);
    const lineNo = ta.value.slice(0, caret).split('\n').length;
    ta.scrollTop = Math.max(0, (lineNo - 6) * lineHeight);
    syncScroll();
  }

  // --- 反映 ---
  let timer = null;
  ta.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 300);
  });
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 2;
      update();
    }
  });

  function syncScroll() {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }

  function update() {
    const text = ta.value;
    const t = TASKS[taskIndex];
    saveTaskState(t.id, { text });

    const { config, errors, warnings } = loadConfig(text);
    currentConfig = config;
    const errorLines = new Set(errors.map((e) => e.line));

    hl.innerHTML = highlight(text, errorLines);
    const lines = text.split('\n').length;
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    syncScroll();

    // エラーと注意
    problems.replaceChildren();
    for (const e of errors) {
      problems.appendChild(el('div', { class: 'prob prob-err' }, [
        el('span', { class: 'prob-line', text: `${e.line}行目` }),
        el('span', { class: 'prob-body' }, [
          el('b', { text: e.problem }),
          ...e.fixes.map((f) => el('span', { class: 'prob-fix', text: '→ ' + f })),
        ]),
      ]));
    }
    for (const e of warnings) {
      problems.appendChild(el('div', { class: 'prob prob-warn' }, [
        el('span', { class: 'prob-line', text: `${e.line}行目` }),
        el('span', { class: 'prob-body' }, [el('b', { text: e.problem })]),
      ]));
    }
    if (!errors.length && !warnings.length) {
      problems.appendChild(el('div', { class: 'prob prob-ok', text: 'エラーはありません。' }));
    }

    // 選べるものを入れかえる
    if (!errors.length) {
      refreshSelectors(config);
      render();
    } else {
      const ctx2 = canvas.getContext('2d');
      if (renderer.backend !== 'webgl2' && ctx2) ctx2.clearRect(0, 0, canvas.width, canvas.height);
      w.say('設定にエラーがあるので、絵は更新していません。まちがった絵を見せないためです。下のエラーを読んでください。');
    }

    // 合否
    if (!errors.length) {
      try {
        const r = t.check(config);
        result.textContent = (r.ok ? '合格: ' : 'まだです: ') + r.why;
        result.className = 'task-result ' + (r.ok ? 'is-ok' : 'is-pending');
      } catch (err) {
        result.textContent = 'まだです: ' + (err.problem || err.message);
        result.className = 'task-result is-pending';
      }
    } else {
      result.textContent = 'まずエラーを直してください。';
      result.className = 'task-result is-pending';
    }
  }

  function refreshSelectors(config) {
    const displays = config.getDisplayNames();
    const prevD = displaySel.get();
    rebuildSelect(displaySel, displays, displays.includes(prevD) ? prevD : displays[0]);
    const views = config.getViewNames(displaySel.get());
    const prevV = viewSel.get();
    rebuildSelect(viewSel, views, views.includes(prevV) ? prevV : views[0]);
    const spaces = config.getColorSpaceNames();
    const prevS = srcSel.get();
    const defaultSrc = config.getRole('scene_linear') || spaces[0];
    rebuildSelect(srcSel, spaces, spaces.includes(prevS) ? prevS : defaultSrc);
  }

  function rebuildSelect(s, options, value) {
    const sel = s.root.querySelector('select');
    sel.replaceChildren(...options.map((o) => el('option', { value: o, text: o, selected: o === value })));
    sel.value = value;
  }

  displaySel.root.querySelector('select').addEventListener('change', () => {
    if (!currentConfig) return;
    const views = currentConfig.getViewNames(displaySel.get());
    rebuildSelect(viewSel, views, views[0]);
    render();
  });

  function render() {
    if (!currentConfig || currentConfig.errors.length) return;
    try {
      const chain = currentConfig.getProcessor({
        src: srcSel.get(), display: displaySel.get(), view: viewSel.get(),
      });
      renderer.resizeToDisplay(640);
      renderer.draw({ chainA: chain });
      const steps = chain.describe();
      w.say(`いまの変換: <span class="kv">${srcSel.get()}</span> → ${steps.join(' → ') || 'そのまま'}
        → <span class="kv">${displaySel.get()} / ${viewSel.get()}</span>`);
    } catch (err) {
      w.say('この組み合わせでは変換を作れませんでした: ' + (err.problem || err.message));
    }
  }

  w.onReset(() => {
    ta.value = originalText;
    update();
  });

  loadScene();
  loadTask();
  window.addEventListener('resize', () => render());

  w.setDetails(`
    <div class="callout callout-warn">
      <p class="note-title">このエディタは学習用の簡略版です</p>
      <p>本物の OpenColorIO の機能のうち、話に必要な部分だけを再現しています。
         対応していない書きかたは、黙って無視せずエラーとして表示します。</p>
      <p>ここで書いた設定は、<code>LEARNING -</code> で始まる行を除けば、本物の OpenColorIO でも読める形です。</p>
    </div>
    <p>覚えるキーは5つだけです。</p>
    <ul>
      <li><code>roles</code> — どの色空間を何に使うかの割りあて。ソフトはこの名前で色空間を探します。</li>
      <li><code>colorspaces</code> — 扱う色空間の一覧。</li>
      <li><code>displays</code> — どの画面に出すか。</li>
      <li><code>views</code> — その画面での見せかた。displays の中に書きます。</li>
      <li><code>looks</code> — 味付け。View から名前で呼びます。</li>
    </ul>
    <p>実際の現場では、環境変数 <code>OCIO</code> に config.ocio の場所を設定します。
       そうすると、対応しているソフトがそろって同じ設定を使うようになります。</p>
  `);
}
