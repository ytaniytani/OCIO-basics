// I-13 HDR 出力比較(第10章)
// ねらい: 同じデータから、明るさのちがう出力が何通りも作れると知る。
//
// HDR に対応していない画面では、擬似表示に切りかえます。
// そのときは「擬似表示です」と画面に出しっぱなしにします。ごまかしません。

import {
  createWidget, imagePane, paneGrid, buttonGroup, toggle, el, fmtNum,
} from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, Node, ToneMapNode, ClampNode, TransferNode, gamutNode,
  buildOutputTransform, buildPQPreview, OUTPUT_PRESETS,
} from '../core/transforms.js';

const SCENES = [
  { value: 'window', label: '逆光の部屋' },
  { value: 'night', label: '夜の街' },
  { value: 'sunset', label: '夕焼け' },
];

const OUTPUTS = [
  { value: 'sdr100', label: 'SDR 100 nit', peak: 100, grey: 10 },
  { value: 'hdr1000', label: 'HDR 1000 nit', peak: 1000, grey: 12 },
  { value: 'hdr4000', label: 'HDR 4000 nit', peak: 4000, grey: 14 },
  { value: 'hlg1000', label: 'HLG(放送向け)', peak: 1000, grey: 12 },
];

// 明るさの色分け。色だけに頼らないよう、凡例に必ず数値を書きます。
const HEAT_STOPS = [
  { nits: 0.1, color: [0.05, 0.02, 0.16], label: '0.1' },
  { nits: 1, color: [0.15, 0.10, 0.55], label: '1' },
  { nits: 10, color: [0.05, 0.45, 0.55], label: '10' },
  { nits: 100, color: [0.20, 0.65, 0.20], label: '100' },
  { nits: 1000, color: [0.92, 0.72, 0.10], label: '1000' },
  { nits: 10000, color: [0.95, 0.95, 0.95], label: '10000' },
];

/** 絶対輝度 (nit) を、対数の目もりで色に置きかえます。 */
class HeatmapNode extends Node {
  constructor() { super('heatmap'); }
  applyCPU(c) {
    const nits = Math.max(0.05, (c[0] + c[1] + c[2]) / 3);
    const t = Math.min(1, Math.max(0, (Math.log10(nits) + 1) / 5));
    const n = HEAT_STOPS.length - 1;
    const f = t * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const a = HEAT_STOPS[i].color, b = HEAT_STOPS[i + 1].color;
    return [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * k);
  }
  emitGLSL(v) {
    const stops = HEAT_STOPS.map((s) => `vec3(${s.color.map((x) => x.toFixed(4)).join(', ')})`);
    const lines = [
      `float _n = max(0.05, (${v}.r + ${v}.g + ${v}.b) / 3.0);`,
      `float _t = clamp((log(_n) / log(10.0) + 1.0) / 5.0, 0.0, 1.0) * ${(HEAT_STOPS.length - 1).toFixed(1)};`,
      `int _i = int(min(${(HEAT_STOPS.length - 2).toFixed(1)}, floor(_t)));`,
      `float _k = _t - float(_i);`,
      `vec3 _a = ${stops[0]}; vec3 _b = ${stops[1]};`,
    ];
    for (let i = 1; i < HEAT_STOPS.length - 1; i++) {
      lines.push(`if (_i == ${i}) { _a = ${stops[i]}; _b = ${stops[i + 1]}; }`);
    }
    lines.push(`${v} = mix(_a, _b, _k);`);
    return lines.join('\n  ');
  }
  describe() { return '明るさを色分けして表示'; }
}

/** SDR で白飛びしてしまう部分(100 nit を超えるところ)に印を付けます。 */
class OverSDRNode extends Node {
  constructor() { super('over_sdr'); }
  applyCPU(c) {
    const over = Math.max(c[0], c[1], c[2]) > 100;
    if (!over) {
      const g = (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 100;
      const v = Math.min(1, Math.max(0, g)) * 0.5;
      return [v, v, v];
    }
    return [0.95, 0.25, 0.15];
  }
  emitGLSL(v) {
    return [
      `float _g = clamp(dot(${v}, vec3(0.2126, 0.7152, 0.0722)) / 100.0, 0.0, 1.0) * 0.5;`,
      `${v} = max(max(${v}.r, ${v}.g), ${v}.b) > 100.0 ? vec3(0.95, 0.25, 0.15) : vec3(_g);`,
    ].join('\n  ');
  }
  describe() { return 'SDR で切り捨てられる部分に印' }
}

export default function i13(mount) {
  const w = createWidget(mount, {
    title: '同じデータから、明るさのちがう出力を作る',
    aim: '左はふつうの画面用、右はえらんだ出力先です。もとのデータは同じ1つです。',
    simplified: true,
    wide: true,
  });

  const hdrCapable = window.matchMedia
    && window.matchMedia('(dynamic-range: high)').matches;

  const paneA = imagePane('ふつうの画面用 (SDR 100 nit)', '');
  const paneB = imagePane('えらんだ出力先', '');
  w.view.appendChild(paneGrid(2, [paneA, paneB]));

  const notice = el('p', { class: 'hdr-notice' });
  const legend = el('div', { class: 'nit-legend', hidden: true });
  const meter = el('div', { class: 'nit-meter', text: '画像の上にカーソルを置くと、そこの明るさ(nit)が出ます' });
  w.view.append(notice, legend, meter);

  const rA = new Renderer(paneA.canvas);
  const rB = new Renderer(paneB.canvas);

  let sceneName = 'window';
  let outputKey = 'hdr1000';
  let mode = 'normal'; // normal / heat / over

  const scenePick = buttonGroup({
    label: 'シーン', options: SCENES, value: sceneName, compact: true,
    onChange: (v) => { sceneName = v; loadScene(); draw(); },
  });
  const outPick = buttonGroup({
    label: '右がわの出力先', options: OUTPUTS, value: outputKey,
    onChange: (v) => { outputKey = v; draw(); },
  });
  const heatToggle = toggle({
    label: '明るさを色分けして見る',
    note: '画素ごとの目標の明るさ (nit)',
    onChange: (v) => { mode = v ? 'heat' : 'normal'; if (v) overToggle.set(false, true); legend.hidden = !v; draw(); },
  });
  const overToggle = toggle({
    label: 'SDR で切り捨てられる部分を見る',
    onChange: (v) => { mode = v ? 'over' : 'normal'; if (v) { heatToggle.set(false, true); legend.hidden = true; } draw(); },
  });

  w.controls.append(scenePick.root, outPick.root, heatToggle.root, overToggle.root);
  w.onReset(() => {
    scenePick.set('window', true); sceneName = 'window';
    outPick.set('hdr1000', true); outputKey = 'hdr1000';
    heatToggle.set(false, true); overToggle.set(false, true);
    mode = 'normal'; legend.hidden = true;
    loadScene(); draw();
  });

  for (const s of HEAT_STOPS) {
    legend.appendChild(el('span', { class: 'item' }, [
      el('span', { class: 'box', style: `background: rgb(${s.color.map((v) => Math.round(v * 255)).join(',')})` }),
      el('span', { text: `${s.label} nit` }),
    ]));
  }

  function loadScene() {
    const img = getScene(sceneName, 560, 315);
    rA.setImage(img);
    rB.setImage(img);
  }

  function outputSpec(key) {
    return OUTPUTS.find((o) => o.value === key);
  }

  function displayChain(key) {
    const o = outputSpec(key);
    if (mode === 'heat') {
      return new TransformChain([
        new ToneMapNode(o.grey, o.peak), new HeatmapNode(),
        new ClampNode(0, 1), new TransferNode('srgb', 'encode'),
      ]);
    }
    if (mode === 'over') {
      return new TransformChain([
        new ToneMapNode(o.grey, o.peak), new OverSDRNode(),
        new ClampNode(0, 1), new TransferNode('srgb', 'encode'),
      ]);
    }
    const preset = { ...OUTPUT_PRESETS[key].opts };
    const nodes = [buildOutputTransform(preset)];
    if (!hdrCapable && key !== 'sdr100') {
      // HDR 非対応の画面では、擬似表示に切りかえます。
      if (preset.encoding === 'pq') nodes.push(buildPQPreview({ peakNits: preset.peakNits }));
      else {
        nodes.push(new TransferNode('hlg', 'decode'));
        nodes.push(gamutNode('Rec2020', 'sRGB'));
        nodes.push(new ClampNode(0, 1));
        nodes.push(new TransferNode('srgb', 'encode'));
      }
    }
    return new TransformChain(nodes);
  }

  function draw() {
    rA.resizeToDisplay(620);
    rB.resizeToDisplay(620);
    rA.draw({ chainA: displayChain('sdr100') });
    rB.draw({ chainA: displayChain(outputKey) });
    const o = outputSpec(outputKey);
    paneA.setTag(mode === 'heat' ? '明るさの色分け' : mode === 'over' ? '赤 = 切り捨てられる部分' : '');
    paneB.setTag(o.label);

    notice.textContent = hdrCapable
      ? 'あなたの画面は HDR 表示に対応しています。右がわは本物の HDR として描いています。'
      : 'あなたの画面は SDR です。右がわは HDR の見え方をシミュレーションしたものです。本物の HDR とはちがいます。';
    notice.className = hdrCapable ? 'hdr-notice is-ok' : 'hdr-notice';

    // 何割の画素が SDR では飛んでしまうかを数えます。
    const img = rA.image;
    const tmSDR = new ToneMapNode(10, 100);
    let over = 0, total = 0, maxNits = 0;
    for (let i = 0; i < img.data.length; i += 3 * 11) {
      const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      const n = tmSDR.applyCPU(c);
      if (Math.max(n[0], n[1], n[2]) > 99.4) over++;
      total++;
      const tm = new ToneMapNode(o.grey, o.peak).applyCPU(c);
      maxNits = Math.max(maxNits, tm[0], tm[1], tm[2]);
    }
    w.say(`このシーンは、SDR にすると <b>${fmtNum(over / total * 100, 1)}%</b> の画素が
      いちばん明るい白でつぶれます。${o.peak > 100
    ? `${o.label} なら、いちばん明るいところを <b>${fmtNum(maxNits, 0)} nit</b> まで出せます。`
    : ''}
      <b>もとのデータは1つも変えていません。</b>差しかえたのは出力変換だけです。`);
  }

  // 明るさメーター
  function probeAt(e) {
    const img = rB.image;
    if (!img) return;
    const r = paneB.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * img.width;
    const y = (e.clientY - r.top) / r.height * img.height;
    const c = img.sample(x, y);
    const o = outputSpec(outputKey);
    const nitsOut = new ToneMapNode(o.grey, o.peak).applyCPU(c);
    const nitsSDR = new ToneMapNode(10, 100).applyCPU(c);
    meter.textContent = `シーンの光の量 ${fmtNum(c[1], 2)} → `
      + `SDR では ${fmtNum(nitsSDR[1], 0)} nit / ${o.label} では ${fmtNum(nitsOut[1], 0)} nit`;
  }
  paneB.canvas.addEventListener('pointermove', probeAt);
  paneA.canvas.addEventListener('pointermove', probeAt);

  loadScene();
  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p><b>nit(ニト)</b>は、画面がどれくらい強く光るかの単位です。身のまわりの数字を並べておきます。</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>もの</th><th>だいたいの明るさ</th></tr></thead>
      <tbody>
        <tr><td>室内で見る白い紙</td><td>数十 nit</td></tr>
        <tr><td>スマホの画面の白</td><td>400 〜 1000 nit</td></tr>
        <tr><td>SDR の映像の白</td><td>100 nit を前提に作られている</td></tr>
        <tr><td>HDR の映像の白</td><td>1000 nit 以上まで出せる</td></tr>
        <tr><td>晴れた日の空</td><td>数千 nit 以上</td></tr>
      </tbody>
    </table>
    </div>
    <p><b>PQ と HLG のちがい。</b>
       PQ は「ここは 500 nit」と絶対的な明るさを決め打ちする方式です。配信やディスクで使います。
       HLG は画面の明るさに合わせて伸び縮みする方式で、従来のテレビとも両立しやすく、放送で使われます。</p>
    <div class="callout callout-warn">
      <p class="note-title">この部品の出力変換は簡略版です</p>
      <p>本物の ACES の出力変換とはちがいます。また、あなたの画面が HDR に対応していない場合、
         右がわは擬似表示です。明るさの色分けとメーターの数値は、擬似表示でも正しく計算しています。</p>
    </div>
  `);
}
