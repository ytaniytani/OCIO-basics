// I-05 タグ違い事故シミュレータ(第2章)
// ねらい: 数値が同じでもラベルがちがえば別の色になる、を体感する。

import { createWidget, imagePane, paneGrid, buttonGroup, toggle, fmt8bit } from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, gamutNode,
  buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';

// 「このラベルだと思って開いた」の一覧。伝達関数と色域の組み合わせです。
const LABELS = {
  srgb: { label: 'sRGB(正解)', transfer: 'srgb', gamut: 'sRGB' },
  rec709: { label: 'Rec.709', transfer: 'rec709', gamut: 'Rec709' },
  p3: { label: 'Display P3', transfer: 'srgb', gamut: 'P3D65' },
  rec2020: { label: 'Rec.2020', transfer: 'rec709', gamut: 'Rec2020' },
  linear: { label: 'リニア', transfer: 'linear', gamut: 'sRGB' },
};

const COMMENTS = {
  srgb: '正しいラベルです。左右が同じになります。',
  rec709: 'よく似ていますが、暗いところがわずかに変わります。テレビ用と画面用のちがいです。',
  p3: '広い色空間だと思って開いたので、色がうすく見えます。とくに赤と緑が弱くなります。',
  rec2020: 'もっと広い色空間だと思って開いたので、色がかなりうすくなります。',
  linear: '曲げていない数値だと思って開いたので、全体がとても明るく、白っぽくなります。',
};

const SCENES = [
  { value: 'chart', label: 'カラーチャート' },
  { value: 'sunset', label: '夕焼け' },
  { value: 'skin', label: '肌色の帯' },
];

export default function i05(mount) {
  const w = createWidget(mount, {
    title: 'ラベルをまちがえるとどうなるか',
    aim: '左右で読みこんでいる数値はまったく同じです。ちがうのは「どの色空間のつもりで開いたか」だけです。',
    simplified: true,
    wide: true,
  });

  const left = imagePane('正しいラベル', 'sRGB として開いた');
  const right = imagePane('まちがったラベル', '');
  w.view.appendChild(paneGrid(2, [left, right]));

  let sceneName = 'chart';
  let label = 'p3';
  let showDiff = false;
  let doubleConv = false;

  const rendererL = new Renderer(left.canvas);
  const rendererR = new Renderer(right.canvas);

  // 画像ファイルの中身にあたるもの。ここまでが「保存された数値」です。
  const toFile = buildOutputTransform(OUTPUT_PRESETS.sdr100.opts);

  const scenePick = buttonGroup({
    label: '画像', options: SCENES, value: sceneName, compact: true,
    onChange: (v) => { sceneName = v; loadScene(); draw(); },
  });
  const labelPick = buttonGroup({
    label: '右の画像を、どのラベルだと思って開くか',
    options: Object.entries(LABELS).map(([k, v]) => ({ value: k, label: v.label })),
    value: label, compact: true,
    onChange: (v) => { label = v; draw(); },
  });
  const diffToggle = toggle({
    label: 'ちがいを強調して表示', note: '差を8倍にして見せます',
    onChange: (v) => { showDiff = v; draw(); },
  });
  const doubleToggle = toggle({
    label: '二重変換の事故も再現する', note: '同じ変換を2回かけてしまった場合',
    onChange: (v) => { doubleConv = v; draw(); },
  });

  w.controls.append(scenePick.root, labelPick.root, diffToggle.root, doubleToggle.root);
  w.onReset(() => {
    scenePick.set('chart', true); sceneName = 'chart'; loadScene();
    labelPick.set('p3', true); label = 'p3';
    diffToggle.set(false, true); showDiff = false;
    doubleToggle.set(false, true); doubleConv = false;
    draw();
  });

  function loadScene() {
    const img = getScene(sceneName, 480, sceneName === 'chart' ? 320 : 270);
    rendererL.setImage(img);
    rendererR.setImage(img);
  }

  function correctChain() {
    // 保存された数値を、そのまま正しい約束で画面に出します。
    return new TransformChain([toFile]);
  }

  function wrongChain() {
    const L = LABELS[label];
    const nodes = [toFile];
    if (doubleConv) {
      // 同じ変換をもう一度かけてしまう事故。数値をさらに曲げます。
      nodes.push(new TransferNode('srgb', 'encode'));
    }
    // まちがったラベルとして数値を光にもどし、その色空間の色として画面に出します。
    nodes.push(new TransferNode(L.transfer, 'decode'));
    nodes.push(gamutNode(L.gamut, 'sRGB'));
    nodes.push(new ClampNode(0, 1));
    nodes.push(new TransferNode('srgb', 'encode'));
    return new TransformChain(nodes);
  }

  function draw() {
    const a = correctChain(), b = wrongChain();
    rendererL.resizeToDisplay(640);
    rendererR.resizeToDisplay(640);
    rendererL.draw({ chainA: a });
    rendererR.draw({ chainA: b, chainB: a, mode: showDiff ? 'diff' : 'A', diffGain: 8 });
    right.setTag(`${LABELS[label].label} として開いた${doubleConv ? ' + 二重変換' : ''}`);

    // 同じ画素の数値を読んで、数字でも見せます。
    const img = rendererL.image;
    const probe = img.sample(img.width * 0.18, img.height * 0.62);
    const va = a.applyCPU(probe), vb = b.applyCPU(probe);
    const same = fmt8bit(va[0]) === fmt8bit(vb[0]) && fmt8bit(va[1]) === fmt8bit(vb[1]);
    w.say(`${COMMENTS[label]}${doubleConv ? ' さらに二重変換で色が大きくずれています。' : ''}<br>
      同じ場所の 8bit の値: 左 <b>(${fmt8bit(va[0])}, ${fmt8bit(va[1])}, ${fmt8bit(va[2])})</b> /
      右 <b>(${fmt8bit(vb[0])}, ${fmt8bit(vb[1])}, ${fmt8bit(vb[2])})</b>
      ${same ? '' : '— <b>保存されている数値は左右で同じ</b>です。変わったのは解釈だけです。'}`);
  }

  loadScene();
  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p>画像ファイルには、色を表す数字がならんでいるだけです。
       その数字が「どの色空間の数字なのか」は、ファイルの中の小さなラベル(タグ)に書いてあります。</p>
    <p>ラベルが無い画像や、ラベルがまちがっている画像を開くと、
       開いた側は自分の思いこみで解釈します。その結果がこの右側です。
       数字は1ビットも変わっていないのに、色が変わってしまいます。</p>
    <p><b>二重変換</b>は現場でよくある事故です。
       すでに変換ずみの画像に、もう一度同じ変換をかけてしまう状態です。
       誰がどこで変換したのかを、チーム全体で決めておかないと起こります。</p>
  `);
}
