// I-11 ACES 全景マップ(第8章)
// ねらい: ACES の流れを1枚で把握する。
//
// 各段のサムネイルは「その時点の数値を、そのまま画面に出したらこう見える」という絵です。
// 途中の段が眠く見えたり白飛びして見えたりするのは異常ではありません。

import {
  createWidget, el, buttonGroup, imagePane,
} from '../core/ui.js';
import { Renderer, FloatImage } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, CDLNode, gamutNode,
  buildOutputTransform, buildPQPreview, OUTPUT_PRESETS,
} from '../core/transforms.js';
import { TRANSFERS, gamutConversionMatrix, matApply } from '../core/color.js';

const SRGB_TO_AP1 = gamutConversionMatrix('sRGB', 'AP1');
const toAP1 = (rgb) => matApply(SRGB_TO_AP1, rgb.map((v) => TRANSFERS.srgb.decode(v)));

const MATERIALS = {
  phone: {
    label: 'スマホの動画', scene: 'sunset',
    fileNote: 'すでに画面用に仕上がっている',
    bake: () => [buildOutputTransform(OUTPUT_PRESETS.sdr100.opts)],
    input: () => [new TransferNode('srgb', 'decode'), gamutNode('sRGB', 'AP1')],
    inputNote: 'sRGB の映像として読みこむ',
  },
  log: {
    label: '一眼のログ映像', scene: 'chart',
    fileNote: '眠い灰色。広い明るさを詰めこんである',
    bake: () => [new TransferNode('demolog', 'encode'), gamutNode('AP1', 'Rec2020')],
    input: () => [new TransferNode('demolog', 'decode'), gamutNode('Rec2020', 'AP1')],
    inputNote: 'Log の映像として読みこむ',
  },
  cg: {
    label: '3DCG', scene: 'cgball',
    fileNote: '光の量そのまま。1.0 を大きく超える値が入っている',
    bake: () => [],
    input: () => [],
    inputNote: 'すでに光の量なので、変換は要らない',
  },
};

const OUTPUTS = {
  sdr: { label: 'ふつうの画面', preset: 'sdr100', nits: 100 },
  tv: { label: 'テレビ', preset: 'sdr709', nits: 100 },
  hdr: { label: 'HDR テレビ', preset: 'hdr1000', nits: 1000 },
  cinema: { label: '劇場', preset: 'sdr709', nits: 48 },
};

const STAGES = [
  {
    id: 'file', label: '① 素材', short: '素材',
    why: 'カメラや CG から出てきたファイル。色空間はバラバラです。',
  },
  {
    id: 'input', label: '② 入力変換', short: '入力変換',
    why: 'どのカメラの絵も、ACES の共通の座標に翻訳します。ここを通ると、素材のちがいが消えます。',
  },
  {
    id: 'work', label: '③ 作業空間', short: '作業',
    why: 'ここで合成や CG の足しこみをします。全部が光の量そろっているので、混ぜても壊れません。',
  },
  {
    id: 'look', label: '④ ルック', short: '味付け',
    why: '作品ぜんたいの雰囲気を作ります。出力変換の「前」に置くのがポイントです。',
  },
  {
    id: 'output', label: '⑤ 出力変換', short: '出力変換',
    why: '見る機械に合わせて仕上げます。ここだけ差しかえれば、別の出力先ぶんが作れます。',
  },
];

export default function i11(mount) {
  const w = createWidget(mount, {
    title: 'ACES の流れを1枚で見る',
    aim: '左から右へ、素材が完成品になるまでの5つの段です。段を選ぶと、その時点の絵が見られます。',
    simplified: true,
    wide: true,
  });

  let material = 'phone';
  let output = 'sdr';
  let stage = 4;

  const strip = el('div', { class: 'aces-strip', role: 'tablist', 'aria-label': 'ACES の各段' });
  const bigPane = imagePane('選んだ段の絵', '');
  const explain = el('div', { class: 'stage-explain' });
  w.view.append(strip, bigPane.root, explain);

  const matPick = buttonGroup({
    label: '素材',
    options: Object.entries(MATERIALS).map(([k, v]) => ({ value: k, label: v.label })),
    value: material, compact: true,
    onChange: (v) => { material = v; loadScene(); redraw(); },
  });
  const outPick = buttonGroup({
    label: '出力先',
    options: Object.entries(OUTPUTS).map(([k, v]) => ({ value: k, label: v.label })),
    value: output, compact: true,
    onChange: (v) => { output = v; redraw(); },
  });
  w.controls.append(matPick.root, outPick.root);
  w.onReset(() => {
    matPick.set('phone', true); material = 'phone';
    outPick.set('sdr', true); output = 'sdr';
    stage = 4;
    loadScene(); redraw();
  });

  // 各段のサムネイル
  const thumbs = STAGES.map((s, i) => {
    const canvas = el('canvas', { class: 'stage-thumb-canvas' });
    const btn = el('button', {
      type: 'button', class: 'stage-card', role: 'tab',
      'aria-selected': 'false', 'aria-label': s.label,
    }, [canvas, el('span', { class: 'stage-name', text: s.label })]);
    btn.addEventListener('click', () => { stage = i; redraw(); });
    return { btn, canvas, renderer: null };
  });
  for (let i = 0; i < thumbs.length; i++) {
    strip.appendChild(thumbs[i].btn);
    if (i < thumbs.length - 1) strip.appendChild(el('span', { class: 'stage-arrow', 'aria-hidden': 'true', text: '→' }));
  }

  const bigRenderer = new Renderer(bigPane.canvas);
  let base = null;      // 素材そのもの (AP1 シーンリニア)
  let composited = null; // CG を足したあと

  function loadScene() {
    const m = MATERIALS[material];
    base = getScene(m.scene, 480, 270);
    composited = compositeCG(base);
    bigRenderer.setImage(base);
    for (let i = 0; i < thumbs.length; i++) {
      if (!thumbs[i].renderer) thumbs[i].renderer = new Renderer(thumbs[i].canvas);
      thumbs[i].renderer.setImage(base);
    }
  }

  /** ③ 作業の段で「合成した」ことを見せるため、CG の球を足しこみます。 */
  function compositeCG(img) {
    const out = img.clone();
    const W = img.width, H = img.height;
    const cx = 0.24, cy = 0.66, r = 0.13;
    const lightDir = [-0.45, 0.72, 0.53];
    const len = Math.hypot(...lightDir);
    const L = lightDir.map((v) => v / len);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x / W - cx) / r * (W / H) * 0.5625;
        const v = (y / H - cy) / r;
        const d2 = u * u + v * v;
        if (d2 > 1.15) continue;
        const alpha = Math.min(1, Math.max(0, (1.03 - Math.sqrt(d2)) / 0.06));
        if (alpha <= 0) continue;
        const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d2)));
        const ndl = Math.max(0, u * L[0] - v * L[1] + nz * L[2]);
        const albedo = toAP1([0.25, 0.55, 0.85]);
        const spec = Math.pow(ndl, 90) * 26;
        const c = [
          albedo[0] * (ndl * 2.2 + 0.12) + spec,
          albedo[1] * (ndl * 2.2 + 0.12) + spec,
          albedo[2] * (ndl * 2.2 + 0.12) + spec,
        ];
        const o = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) {
          out.data[o + k] = c[k] * alpha + out.data[o + k] * (1 - alpha);
        }
      }
    }
    return out;
  }

  // 途中の段を「そのまま画面に出す」ときの見せかた
  const naive = () => [gamutNode('AP1', 'sRGB'), new ClampNode(0, 1), new TransferNode('srgb', 'encode')];
  const lookT = () => [new CDLNode({ slope: [1.08, 1.0, 0.88], offset: [0, 0, 0.015], sat: 1.15, gamut: 'AP1' })];

  function chainFor(stageIndex) {
    const m = MATERIALS[material];
    const nodes = [...m.bake()];
    if (stageIndex === 0) {
      // 素材そのもの。CG のときは光の量なので、そのまま出すと白飛びします。
      return new TransformChain(material === 'cg' ? [...naive()] : [new ClampNode(0, 1)]);
    }
    nodes.push(...m.input());
    if (stageIndex === 1) return new TransformChain([...nodes, ...naive()]);
    if (stageIndex === 2) return new TransformChain([...nodes, ...naive()]);
    nodes.push(...lookT());
    if (stageIndex === 3) return new TransformChain([...nodes, ...naive()]);
    const o = OUTPUTS[output];
    const preset = { ...OUTPUT_PRESETS[o.preset].opts, peakNits: o.nits };
    nodes.push(buildOutputTransform(preset));
    if (o.preset === 'hdr1000') nodes.push(buildPQPreview({ peakNits: o.nits }));
    return new TransformChain(nodes);
  }

  function imageFor(stageIndex) {
    return stageIndex >= 2 ? composited : base;
  }

  function redraw() {
    for (let i = 0; i < STAGES.length; i++) {
      const t = thumbs[i];
      t.renderer.setImage(imageFor(i));
      t.renderer.resizeToDisplay(220);
      t.renderer.draw({ chainA: chainFor(i) });
      t.btn.setAttribute('aria-selected', i === stage ? 'true' : 'false');
      t.btn.classList.toggle('is-selected', i === stage);
    }
    bigRenderer.setImage(imageFor(stage));
    bigRenderer.resizeToDisplay(680);
    bigRenderer.draw({ chainA: chainFor(stage) });

    const s = STAGES[stage];
    const m = MATERIALS[material];
    bigPane.setTag(s.label);
    const extra = stage === 0 ? m.fileNote
      : stage === 1 ? m.inputNote
        : stage === 4 ? `${OUTPUTS[output].label}(${OUTPUTS[output].nits} nit)向けに仕上げた状態`
          : '';
    explain.innerHTML = `<p class="stage-why"><b>${s.label}</b> ${s.why}</p>`
      + (extra ? `<p class="stage-extra">いまの素材では: ${extra}</p>` : '');

    if (stage === 4) {
      w.say(`完成品です。<b>出力先を切りかえてみてください。</b>
        ①から④までは何も変わらず、⑤だけが差しかわります。これが ACES のいちばんの利点です。`);
    } else if (stage === 0) {
      w.say('素材ごとに色空間がちがいます。<b>素材を切りかえて、見え方のちがいを見てください。</b>');
    } else {
      w.say(`この段の数値を、そのまま画面に出すとこう見えます。
        <b>眠く見えたり白飛びして見えたりしますが、こわれてはいません。</b>
        まだ画面用に仕上げていないだけです。`);
    }
  }

  loadScene();
  requestAnimationFrame(redraw);
  window.addEventListener('resize', () => requestAnimationFrame(redraw));

  w.setDetails(`
    <p>ACES の作業空間は、用途によって3つに分かれています。理由は用途がちがうからです。</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>名前</th><th>使いみち</th><th>なぜ</th></tr></thead>
      <tbody>
        <tr><td>ACES2065-1 (AP0)</td><td>保存と受けわたし</td><td>いちばん広い。将来どんな機械が出てきても入る</td></tr>
        <tr><td>ACEScg (AP1)</td><td>CG と合成の作業</td><td>リニアで、計算しやすい広さ</td></tr>
        <tr><td>ACEScct</td><td>色の調整</td><td>対数なので、つまみの効きかたが自然</td></tr>
      </tbody>
    </table>
    </div>
    <p><b>出力変換のよび名について。</b> ACES 1.x では、共通の仕上げをする RRT と、
       機器ごとに合わせる ODT の2段に分かれていました。
       ACES 2.0 では、この2つが1つの Output Transform にまとまりました。
       このサイトでは新しいよび名の「出力変換」で通しています。</p>
    <div class="callout callout-warn">
      <p class="note-title">このマップの出力変換は簡略版です</p>
      <p>本物の ACES の出力変換とは、細かいところがちがいます。傾向を見るためのものです。</p>
    </div>
  `);
}
