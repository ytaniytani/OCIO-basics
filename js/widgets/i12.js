// I-12 グレーディング位置ラボ(第9章)
// ねらい: 味付けを入れる場所で結果が変わる。正しい場所が1つだと確かめる。
//
// 3つの位置 × 2つの出力先(SDR / HDR)で結果をならべます。

import {
  createWidget, imagePane, paneGrid, buttonGroup, slider, el, fmtNum,
} from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, CDLNode, gamutNode,
  buildOutputTransform, buildPQPreview, OUTPUT_PRESETS,
} from '../core/transforms.js';

const POSITIONS = [
  { value: 'before', label: '① 入力変換の前' },
  { value: 'working', label: '② 作業空間の中' },
  { value: 'after', label: '③ 出力変換の後' },
];

const POS_NOTES = {
  before: {
    title: 'ここに入れると、素材ごとに効きかたが変わります',
    body: '素材を切りかえてみてください。同じ設定なのに、まったくちがう結果になります。'
      + 'カメラを変えるたびに調整をやり直すことになります。',
    good: false,
  },
  working: {
    title: 'ここが正しい場所です',
    body: '素材を切りかえても、出力先を切りかえても、味付けの効きかたが変わりません。'
      + 'まだ白飛びしていない状態で調整できるので、明るいところも自由に動かせます。',
    good: true,
  },
  after: {
    title: 'ここに入れると、出力先ごとに破綻します',
    body: 'SDR で合わせた設定を HDR に持っていくと、まったくちがう結果になります。'
      + 'すでに白飛びしたあとなので、飛んだところは戻せません。出力先の数だけ作業をやり直すことになります。',
    good: false,
  },
};

const MATERIALS = {
  phone: {
    label: 'スマホの動画', scene: 'sunset',
    bake: () => [buildOutputTransform(OUTPUT_PRESETS.sdr100.opts)],
    input: () => [new TransferNode('srgb', 'decode'), gamutNode('sRGB', 'AP1')],
  },
  log: {
    label: 'ログ映像', scene: 'window',
    bake: () => [new TransferNode('demolog', 'encode'), gamutNode('AP1', 'Rec2020')],
    input: () => [new TransferNode('demolog', 'decode'), gamutNode('Rec2020', 'AP1')],
  },
  cg: {
    label: '3DCG', scene: 'cgball',
    bake: () => [],
    input: () => [],
  },
};

export default function i12(mount) {
  const w = createWidget(mount, {
    title: '味付けをどこに入れるか',
    aim: '同じ調整を3か所に入れて比べます。左がふつうの画面用、右が HDR 用の結果です。',
    simplified: true,
    wide: true,
  });

  const paneSDR = imagePane('ふつうの画面用 (SDR 100 nit)', '');
  const paneHDR = imagePane('HDR 用 (1000 nit)', '擬似表示');
  w.view.appendChild(paneGrid(2, [paneSDR, paneHDR]));
  const notice = el('p', { class: 'hdr-notice' });
  w.view.appendChild(notice);

  const rS = new Renderer(paneSDR.canvas);
  const rH = new Renderer(paneHDR.canvas);

  let position = 'working';
  let material = 'phone';
  const grade = { bright: 0, contrast: 0, warm: 0, sat: 1 };

  const posPick = buttonGroup({
    label: '味付けをどこに入れるか', options: POSITIONS, value: position,
    onChange: (v) => { position = v; draw(); },
  });
  const matPick = buttonGroup({
    label: '素材',
    options: Object.entries(MATERIALS).map(([k, v]) => ({ value: k, label: v.label })),
    value: material, compact: true,
    onChange: (v) => { material = v; loadScene(); draw(); },
  });
  const sBright = slider({
    label: '明るさ', min: -1, max: 1, step: 0.02, value: 0,
    onChange: (v) => { grade.bright = v; draw(); },
  });
  const sContrast = slider({
    label: 'コントラスト', min: -0.6, max: 0.6, step: 0.02, value: 0,
    onChange: (v) => { grade.contrast = v; draw(); },
  });
  const sWarm = slider({
    label: '色み(左が青、右がオレンジ)', min: -1, max: 1, step: 0.02, value: 0,
    onChange: (v) => { grade.warm = v; draw(); },
  });
  const sSat = slider({
    label: '鮮やかさ', min: 0, max: 2, step: 0.02, value: 1,
    onChange: (v) => { grade.sat = v; draw(); },
  });

  w.controls.append(posPick.root, matPick.root, sBright.root, sContrast.root, sWarm.root, sSat.root);
  w.onReset(() => {
    posPick.set('working', true); position = 'working';
    matPick.set('phone', true); material = 'phone';
    sBright.set(0, true); sContrast.set(0, true); sWarm.set(0, true); sSat.set(1, true);
    grade.bright = 0; grade.contrast = 0; grade.warm = 0; grade.sat = 1;
    loadScene(); draw();
  });

  /**
   * 4つのつまみを CDL の形にします。
   *
   * 位置ごとに、つまみが働く場所(数値の意味)がちがいます。そのままだと
   * 「作業空間の中」だけ効きが強くなりすぎて、強さのちがいばかりが目についてしまいます。
   * この実験で見てほしいのは強さではなく「素材や出力先を替えたときのふるまい」なので、
   * 中間グレーの落ちつき先がだいたいそろうよう、位置ごとに倍率をかけています。
   */
  const STRENGTH = { before: 1, working: 0.5, after: 1 };

  function makeCDL(pos) {
    const s = STRENGTH[pos];
    const lift = grade.bright * 0.35 * s;
    const gain = 1 + grade.contrast * 0.9 * s;
    const warm = grade.warm * s;
    const pw = 1 - grade.contrast * 0.4 * s;
    return new CDLNode({
      slope: [gain * (1 + warm * 0.14), gain, gain * (1 - warm * 0.14)],
      offset: [lift, lift, lift],
      power: [pw, pw, pw],
      sat: 1 + (grade.sat - 1) * s,
      gamut: 'AP1',
    });
  }

  const acescctIn = () => new TransferNode('acescct', 'encode');
  const acescctOut = () => new TransferNode('acescct', 'decode');

  function buildChain(target) {
    const m = MATERIALS[material];
    const cdl = makeCDL(position);
    const nodes = [...m.bake()];

    if (position === 'before') nodes.push(cdl);   // ファイルの数値を直接いじる
    nodes.push(...m.input());
    if (position === 'working') {
      // ACEScct に移してから味付けし、光の量にもどします。実際の現場と同じ手順です。
      nodes.push(acescctIn(), cdl, acescctOut());
    }

    if (target === 'sdr') {
      nodes.push(buildOutputTransform(OUTPUT_PRESETS.sdr100.opts));
      if (position === 'after') nodes.push(cdl, new ClampNode(0, 1));
    } else {
      nodes.push(buildOutputTransform(OUTPUT_PRESETS.hdr1000.opts));
      if (position === 'after') nodes.push(cdl, new ClampNode(0, 1));
      nodes.push(buildPQPreview({ peakNits: 1000 }));
    }
    return new TransformChain(nodes);
  }

  function loadScene() {
    const img = getScene(MATERIALS[material].scene, 480, 270);
    rS.setImage(img);
    rH.setImage(img);
  }

  function draw() {
    const a = buildChain('sdr'), b = buildChain('hdr');
    rS.resizeToDisplay(620);
    rH.resizeToDisplay(620);
    rS.draw({ chainA: a });
    rH.draw({ chainA: b });
    const n = POS_NOTES[position];
    paneSDR.setTag(POSITIONS.find((p) => p.value === position).label);
    paneHDR.setTag(POSITIONS.find((p) => p.value === position).label);
    notice.textContent = 'HDR 側は、SDR の画面で見るための擬似表示です。本物の HDR の見え方とはちがいます。'
      + ' また、つまみの効きの強さは位置ごとにだいたいそろえてあります。'
      + 'くらべてほしいのは強さではなく、素材や出力先を替えたときのふるまいです。';

    // 中間グレーがどこに行ったかを数字で見せます。
    const img = rS.image;
    const probe = img.sample(img.width * 0.5, img.height * 0.5);
    const va = a.applyCPU(probe)[1], vb = b.applyCPU(probe)[1];
    const graded = grade.bright !== 0 || grade.contrast !== 0 || grade.warm !== 0 || grade.sat !== 1;
    w.say(`<b>${n.title}</b> ${n.body}
      ${graded ? `<br>まん中の明るさ: SDR <b>${fmtNum(va, 3)}</b> / HDR <b>${fmtNum(vb, 3)}</b>`
    : '<br>つまみを動かしてから、位置を切りかえてみてください。'}`);
  }

  loadScene();
  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p>実際の現場では、味付けは2つに分かれています。どちらも出力変換の<b>前</b>です。</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>よび名</th><th>何をするか</th><th>どこに入れるか</th></tr></thead>
      <tbody>
        <tr><td>LMT</td><td>作品ぜんたいに共通の味付け</td><td>作業空間の中(出力変換の前)</td></tr>
        <tr><td>ショットグレード / CDL</td><td>カット1つずつの調整</td><td>作業空間の中(LMT の前)</td></tr>
      </tbody>
    </table>
    </div>
    <p>調整には <b>ACEScct</b> という対数の色空間を使うのがふつうです。
       リニアのままだと、暗い部分のつまみが効きすぎて操作しづらいためです。
       ACEScct は暗い側の効きかたを、昔からの機材の感触に近づけてあります。</p>
    <p>「出力変換の後」に入れてはいけない理由をもう一度まとめます。</p>
    <ul>
      <li>出力先ごとに数値の意味がちがうので、同じ設定が同じ結果になりません。</li>
      <li>すでに白飛びしたあとなので、飛んだところは戻せません。</li>
      <li>出力先が増えるたびに、その数だけ調整をやり直すことになります。</li>
    </ul>
  `);
}
