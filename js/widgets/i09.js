// I-09 パイプライン組み立てパズル(第6章)
// ねらい: 処理の順番に意味があると知る。
//
// まちがった並べかたごとに、決まった壊れかたをします(でたらめではありません)。

import {
  createWidget, imagePane, el, button,
} from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, CDLNode, gamutNode,
  buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';

const BLOCKS = [
  { id: 'input', label: '入力変換', note: '素材を共通の場所に翻訳する' },
  { id: 'work', label: '作業空間で作業', note: '合成や計算をする' },
  { id: 'look', label: 'ルック(味付け)', note: '作品の雰囲気を作る' },
  { id: 'output', label: '出力変換', note: '見る機械に合わせて仕上げる' },
  { id: 'save', label: 'ファイルに保存', note: 'これは色の変換ではありません', dummy: true },
  { id: 'post', label: 'SNSに投稿', note: 'これは色の変換ではありません', dummy: true },
];

const ANSWER = ['input', 'work', 'look', 'output'];

const WRONG_NOTES = {
  'output-first': '出力変換を先にかけたので、そのあとの処理が二重にかかって白っぽくなりました。',
  'look-after-output': '味付けを出力変換のあとに入れたので、効きすぎて破綻しています。第9章でくわしく調べます。',
  'no-input': '入力変換がないので、素材が何の色空間なのか決まっていません。',
  'no-output': '出力変換がないので、光の量をそのまま画面に流しています。明るいところが真っ白です。',
  'dummy': '色の変換ではないブロックが混ざっています。',
  'other': '順番がちがうので、結果がずれています。',
};

export default function i09(mount) {
  const w = createWidget(mount, {
    title: '正しい順番にならべる',
    aim: '4つのブロックを正しい順にならべてください。まちがっていると、結果の絵が壊れます。',
    simplified: true,
    wide: true,
  });

  const pane = imagePane('結果', '');
  w.view.appendChild(pane.root);

  const slots = [];
  const slotRow = el('div', { class: 'slot-row' });
  for (let i = 0; i < 4; i++) {
    const s = el('div', {
      class: 'slot', role: 'button', tabindex: '0',
      'aria-label': `${i + 1}番目のスロット`,
    }, [el('span', {}, [el('span', { class: 'slot-num', text: `${i + 1}番目` }), el('span', { text: '(空)' })])]);
    s.addEventListener('click', () => placeOrClear(i));
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); placeOrClear(i); } });
    slots.push({ node: s, block: null });
    slotRow.appendChild(s);
    if (i < 3) slotRow.appendChild(el('span', { class: 'pipeline-arrow', 'aria-hidden': 'true', text: '→' }));
  }

  const tray = el('div', { class: 'block-tray' });
  const pipeline = el('div', { class: 'pipeline' }, [
    el('div', { class: 'ctl-label', text: 'ならべる場所(タップして置く / もう一度タップで外す)' }),
    slotRow,
    el('div', { class: 'ctl-label', text: '使えるブロック' }),
    tray,
  ]);
  w.controls.appendChild(pipeline);

  let selected = null;
  let wrongCount = 0;
  let hintSlot = -1;

  function rebuildTray() {
    tray.replaceChildren();
    for (const b of BLOCKS) {
      const used = slots.some((s) => s.block === b.id);
      if (used) continue;
      const node = el('button', {
        type: 'button',
        class: 'block' + (b.dummy ? ' is-dummy' : '') + (selected === b.id ? ' selected' : ''),
        title: b.note,
      }, [el('span', { text: b.label }), el('span', { class: 'slot-num', text: b.note })]);
      node.addEventListener('click', () => { selected = selected === b.id ? null : b.id; rebuildTray(); });
      // マウスでのドラッグにも対応します。
      node.draggable = true;
      node.addEventListener('dragstart', (e) => { selected = b.id; e.dataTransfer.setData('text/plain', b.id); });
      tray.appendChild(node);
    }
  }

  for (let i = 0; i < 4; i++) {
    slots[i].node.addEventListener('dragover', (e) => { e.preventDefault(); slots[i].node.classList.add('is-target'); });
    slots[i].node.addEventListener('dragleave', () => slots[i].node.classList.remove('is-target'));
    slots[i].node.addEventListener('drop', (e) => {
      e.preventDefault();
      slots[i].node.classList.remove('is-target');
      const id = e.dataTransfer.getData('text/plain');
      if (id) { selected = id; placeOrClear(i); }
    });
  }

  function placeOrClear(i) {
    if (slots[i].block && !selected) {
      slots[i].block = null;
    } else if (selected) {
      // すでに他の場所にあれば、そこから外します。
      for (const s of slots) if (s.block === selected) s.block = null;
      slots[i].block = selected;
      selected = null;
    }
    refresh();
  }

  function refresh() {
    slots.forEach((s, i) => {
      const b = BLOCKS.find((x) => x.id === s.block);
      s.node.className = 'slot' + (b ? ' filled' : '') + (i === hintSlot ? ' is-target' : '');
      s.node.replaceChildren(el('span', {}, [
        el('span', { class: 'slot-num', text: `${i + 1}番目` }),
        el('span', { text: b ? b.label : '(空)' }),
      ]));
    });
    rebuildTray();
    draw();
  }

  const image = getScene('sunset', 480, 270);
  const renderer = new Renderer(pane.canvas);
  renderer.setImage(image);

  const inputT = () => [new TransferNode('srgb', 'decode'), gamutNode('sRGB', 'AP1')];
  const workT = () => [];
  const lookT = () => [new CDLNode({ slope: [1.10, 1.0, 0.88], sat: 1.1, gamut: 'AP1' })];
  const outputT = () => [buildOutputTransform(OUTPUT_PRESETS.sdr100.opts)];

  // 素材は「sRGB の画像ファイル」だとします。
  const source = new TransformChain([
    buildOutputTransform(OUTPUT_PRESETS.sdr100.opts),
  ]);

  function buildChain() {
    const nodes = [...source.nodes];
    for (const s of slots) {
      switch (s.block) {
        case 'input': nodes.push(...inputT()); break;
        case 'work': nodes.push(...workT()); break;
        case 'look': nodes.push(...lookT()); break;
        case 'output': nodes.push(...outputT()); break;
        default: break; // 空とダミーは何もしません
      }
    }
    nodes.push(new ClampNode(0, 1));
    return new TransformChain(nodes);
  }

  function diagnose() {
    const order = slots.map((s) => s.block);
    if (order.every((x, i) => x === ANSWER[i])) return null;
    if (order.some((x) => x === 'save' || x === 'post')) return 'dummy';
    const io = order.indexOf('output'), ii = order.indexOf('input'), il = order.indexOf('look');
    if (io === 0) return 'output-first';
    if (io >= 0 && il > io) return 'look-after-output';
    if (ii < 0) return 'no-input';
    if (io < 0) return 'no-output';
    return 'other';
  }

  function draw() {
    renderer.resizeToDisplay(640);
    renderer.draw({ chainA: buildChain() });
    const filled = slots.filter((s) => s.block).length;
    const problem = diagnose();
    if (filled < 4) {
      pane.setTag('まだ組み立て中');
      w.say(`ブロックを選んで、スロットに置いてください。あと ${4 - filled} 個です。`);
      return;
    }
    if (!problem) {
      pane.setTag('正解');
      hintSlot = -1;
      w.say('<b>正解です。</b>素材を共通の場所に翻訳し、そこで作業し、味付けをして、最後に画面用に仕上げる。これが色の流れの基本形です。');
      return;
    }
    wrongCount++;
    pane.setTag('この順番だとこうなります');
    let msg = WRONG_NOTES[problem];
    if (wrongCount >= 3 && hintSlot < 0) {
      hintSlot = 0;
      msg += ' ヒント: 1番目は「入力変換」です。';
      refreshSlotsOnly();
    }
    w.say(msg);
  }

  function refreshSlotsOnly() {
    slots.forEach((s, i) => {
      s.node.classList.toggle('is-target', i === hintSlot);
    });
  }

  w.controls.appendChild(el('div', { class: 'ctl-group' }, [
    button('ぜんぶ外す', () => { for (const s of slots) s.block = null; selected = null; refresh(); }),
  ]));
  w.onReset(() => {
    for (const s of slots) s.block = null;
    selected = null; wrongCount = 0; hintSlot = -1;
    refresh();
  });

  refresh();
  window.addEventListener('resize', () => draw());

  w.setDetails(`
    <p>この4つの順番には、それぞれ理由があります。</p>
    <ol>
      <li><b>入力変換</b>が最初。素材が何の色空間なのかを決めないと、その先の計算が何をしているのか分かりません。</li>
      <li><b>作業</b>は共通の場所で。全部の素材が同じものさしの上にいるので、混ぜても壊れません。</li>
      <li><b>味付け</b>は出力変換の前。ここに置くと、出力先を変えても味付けが保たれます。</li>
      <li><b>出力変換</b>が最後。見る機械に合わせて仕上げる、いちばん最後の工程です。</li>
    </ol>
    <p>味付けを出力変換のあとに置くと何が起きるかは、第9章で実際に確かめます。
       「ファイルに保存」と「SNSに投稿」は、色の変換ではないので、この並びには入りません。</p>
  `);
}
