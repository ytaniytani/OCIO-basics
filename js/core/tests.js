// tests.js — ブラウザで開くだけで動くテスト。ビルドは要りません。
//
// 確かめること (docs/OCIO-ENGINE.md 8節):
//   ・往復テスト: to_reference → from_reference で元にもどるか
//   ・既知値テスト: 公表されている値と一致するか
//   ・行列テスト: 色域の往復が単位行列になるか
//   ・CPU と GPU の一致テスト
//   ・パーサテスト: 教材の設定が読めて、意図したエラーが意図した行で出るか

import {
  TRANSFERS, GAMUTS, gamutConversionMatrix, matMul, matEquals, MAT_IDENTITY,
  luminanceWeights, to8bit, MIDDLE_GREY,
} from './color.js';
import {
  TransformChain, TransferNode, MatrixNode, MonitorCurveNode, LogAffineNode,
  PowerNode, ToneMapNode, gamutNode, buildOutputTransform, buildPQPreview,
  OUTPUT_PRESETS, GLSL_PRELUDE,
} from './transforms.js';
import { Renderer, FloatImage } from './render.js';
import { loadConfig } from './ocio-mini.js';
import { parseYAML, YamlError } from './yaml-mini.js';
import { spectralLocus } from '../widgets/i04.js';

const results = [];

function test(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err && err.message ? err.message : err) });
  }
}

function near(got, want, tol, label) {
  if (!(Math.abs(got - want) <= tol)) {
    throw new Error(`${label}: ${got} が ${want} と一致しません(許容 ${tol})`);
  }
}

// ---------------------------------------------------------------------------
// 往復テスト
// ---------------------------------------------------------------------------

test('伝達関数の往復(すべての種類)', () => {
  const values = [0.0001, 0.005, 0.05, 0.18, 0.5, 1, 4, 16];
  for (const [name, t] of Object.entries(TRANSFERS)) {
    if (name === 'pq' || name === 'hlg') continue; // 入力の意味がちがうので別に試します
    for (const v of values) {
      const back = t.decode(t.encode(v));
      near(back, v, Math.max(1e-5, v * 1e-4), `${name} の往復 (${v})`);
    }
  }
  return `${Object.keys(TRANSFERS).length - 2} 種類 × ${values.length} 点`;
});

test('PQ と HLG の往復', () => {
  for (const nits of [0.1, 1, 100, 1000, 4000, 10000]) {
    const back = TRANSFERS.pq.decode(TRANSFERS.pq.encode(nits / 10000)) * 10000;
    near(back, nits, nits * 1e-3, `PQ の往復 (${nits} nit)`);
  }
  for (const v of [0, 0.01, 0.1, 0.5, 1]) {
    const back = TRANSFERS.hlg.decode(TRANSFERS.hlg.encode(v));
    near(back, v, 1e-5, `HLG の往復 (${v})`);
  }
  return '6 + 5 点';
});

test('色域の往復が単位行列になる', () => {
  const names = Object.keys(GAMUTS);
  for (const a of names) {
    for (const b of names) {
      const m = matMul(gamutConversionMatrix(b, a), gamutConversionMatrix(a, b));
      if (!matEquals(m, MAT_IDENTITY, 1e-9)) throw new Error(`${a} ↔ ${b} が単位行列になりません`);
    }
  }
  return `${names.length}×${names.length} 通り`;
});

test('変換ノードの逆変換', () => {
  const cases = [
    new MonitorCurveNode(2.4, 0.055),
    new PowerNode([2.2, 2.2, 2.2]),
    new TransferNode('acescct', 'encode'),
    new LogAffineNode({ base: 2, logSideSlope: 0.0570776, logSideOffset: 0.5547945, linSideBreak: 0.0078125 }),
    gamutNode('AP1', 'Rec709'),
  ];
  for (const node of cases) {
    const inv = node.inverse();
    if (!inv) throw new Error(`${node.type} の逆変換が作れません`);
    const v = [0.31, 0.18, 0.62];
    const back = inv.applyCPU(node.applyCPU(v));
    for (let i = 0; i < 3; i++) near(back[i], v[i], 1e-6, `${node.type} の往復`);
  }
  return `${cases.length} 種類`;
});

// ---------------------------------------------------------------------------
// 既知値テスト
// ---------------------------------------------------------------------------

test('sRGB の既知値', () => {
  near(TRANSFERS.srgb.decode(0.5), 0.2140, 0.0001, 'sRGB 0.5 → linear');
  near(TRANSFERS.srgb.encode(0.18), 0.4614, 0.0001, 'linear 0.18 → sRGB');
  near(to8bit(TRANSFERS.srgb.encode(MIDDLE_GREY)), 118, 0.5, '中間グレーの 8bit 値');
  near(TRANSFERS.srgb.encode(1), 1, 1e-9, 'sRGB 1.0');
  return '0.5 → 0.2140 / 0.18 → 0.4614 / 8bit 118';
});

test('Rec.709 の輝度係数', () => {
  const w = luminanceWeights('Rec709');
  near(w[0], 0.2126, 0.0001, '赤');
  near(w[1], 0.7152, 0.0001, '緑');
  near(w[2], 0.0722, 0.0001, '青');
  return '0.2126 / 0.7152 / 0.0722';
});

test('ACEScg から Rec.709 への行列', () => {
  const m = gamutConversionMatrix('AP1', 'Rec709');
  near(m[0], 1.7051, 0.001, '1行1列');
  near(m[1], -0.6218, 0.001, '1行2列');
  near(m[2], -0.0833, 0.001, '1行3列');
  return '1.7051, -0.6218, -0.0833';
});

test('ACEScct の既知値', () => {
  near(TRANSFERS.acescct.encode(0.0078125), 0.155251, 1e-5, 'さかい目');
  near(TRANSFERS.acescct.encode(0.18), 0.413588, 1e-5, '中間グレー');
  near(TRANSFERS.acescct.encode(1.0), 0.554795, 1e-5, '1.0');
  return 'さかい目 0.155251 / 0.18 → 0.413588';
});

test('LogCameraTransform が ACEScct を再現する', () => {
  const node = new LogAffineNode({
    base: 2, logSideSlope: 1 / 17.52, logSideOffset: 9.72 / 17.52,
    linSideSlope: 1, linSideOffset: 0, linSideBreak: 0.0078125,
  });
  for (const x of [0.0001, 0.0078125, 0.18, 1, 16, 65504]) {
    near(node.applyCPU([x, x, x])[0], TRANSFERS.acescct.encode(x), 1e-5, `ACEScct (${x})`);
  }
  return '6 点で一致';
});

test('ExponentWithLinear が sRGB とほぼ同じ曲線になる', () => {
  const node = new MonitorCurveNode(2.4, 0.055);
  near(node.scale, 12.92, 0.02, '直線部分の傾き');
  near(node.applyCPU([0.5, 0.5, 0.5])[0], 0.2140, 0.0005, '0.5 → linear');
  return `傾き ${node.scale.toFixed(3)}`;
});

test('PQ の既知値', () => {
  near(TRANSFERS.pq.encode(100 / 10000), 0.50808, 0.0001, '100 nit');
  near(TRANSFERS.pq.encode(1), 1, 1e-6, '10000 nit');
  return '100 nit → 0.50808';
});

test('色度図のスペクトル軌跡が公表値と一致する', () => {
  // CIE 1931 (2度視野) の公表値。以前は解析近似を使っていて、
  // 700nm で x=0.5684 と大きく外れ、馬蹄形の赤い先端が切れていた。
  const REF = {
    400: [0.1733, 0.0048], 480: [0.0913, 0.1327], 500: [0.0082, 0.5384],
    520: [0.0743, 0.8338], 550: [0.3016, 0.6923], 600: [0.6270, 0.3725],
    700: [0.7347, 0.2653],
  };
  const pts = spectralLocus();
  for (const [nm, ref] of Object.entries(REF)) {
    const p = pts.find((q) => q[2] === Number(nm));
    if (!p) throw new Error(`${nm}nm の点がありません`);
    near(p[0], ref[0], 1e-4, `${nm}nm の x`);
    near(p[1], ref[1], 1e-4, `${nm}nm の y`);
  }
  return `${pts.length} 点。両端と頂点を含む 7 波長で一致`;
});

test('馬蹄形が途中で折り返していない', () => {
  // 端の点が内側に折り返すと、図が切れて見える。
  // 波長が増えるほど右下へ向かうこと(560nm 以降)を確かめる。
  const pts = spectralLocus().filter((p) => p[2] >= 560);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] < pts[i - 1][0] - 1e-9) {
      throw new Error(`${pts[i][2]}nm で x が左に戻っています (${pts[i][0]} < ${pts[i - 1][0]})`);
    }
    if (pts[i][1] > pts[i - 1][1] + 1e-9) {
      throw new Error(`${pts[i][2]}nm で y が上に戻っています`);
    }
  }
  const last = pts[pts.length - 1];
  return `560nm から ${last[2]}nm まで単調。終点 (${last[0]}, ${last[1]})`;
});

test('ACES AP0 の赤の原色がスペクトル軌跡の上にある', () => {
  // AP0 の赤は 700nm の単色光と同じ座標に定義されている。
  // 第2章で「AP0 は馬蹄形をはみ出す」と説明する際の土台になる。
  const red = GAMUTS.AP0.primaries.red;
  const tip = spectralLocus().find((p) => p[2] === 700);
  near(red[0], tip[0], 1e-4, 'AP0 の赤の x');
  near(red[1], tip[1], 1e-4, 'AP0 の赤の y');
  return `AP0 の赤 (${red[0]}, ${red[1]}) = 700nm の点`;
});

// ---------------------------------------------------------------------------
// 出力変換のふるまい
// ---------------------------------------------------------------------------

test('出力変換: 中間グレーの落ちつき先', () => {
  const cases = [['sdr100', 10], ['hdr1000', 12], ['hdr4000', 14]];
  const out = [];
  for (const [key, greyNits] of cases) {
    const o = OUTPUT_PRESETS[key].opts;
    const nits = new ToneMapNode(o.greyNits, o.peakNits).applyCPU([0.18, 0.18, 0.18])[0];
    near(nits, greyNits, greyNits * 0.06, `${key} の中間グレー`);
    out.push(`${key}: ${nits.toFixed(1)} nit`);
  }
  return out.join(' / ');
});

test('出力変換: ピーク輝度を超えない、かつ単調である', () => {
  for (const key of Object.keys(OUTPUT_PRESETS)) {
    const o = OUTPUT_PRESETS[key].opts;
    const tm = new ToneMapNode(o.greyNits, o.peakNits);
    let prev = -1;
    for (let ev = -12; ev <= 14; ev += 0.25) {
      const x = 0.18 * Math.pow(2, ev);
      const n = tm.applyCPU([x, x, x])[0];
      if (n > o.peakNits + 1e-6) throw new Error(`${key}: ピークを超えました (${n})`);
      if (n < prev - 1e-9) throw new Error(`${key}: 単調に増えていません`);
      prev = n;
    }
  }
  return `${Object.keys(OUTPUT_PRESETS).length} 種類 × 105 点`;
});

test('HDR のほうが、SDR より明るいところを多く残せる', () => {
  const sdr = new ToneMapNode(10, 100);
  const hdr = new ToneMapNode(12, 1000);
  // シーンリニア 16 は SDR ではほぼ飽和し、HDR ではまだ余裕がある
  const a = sdr.applyCPU([16, 16, 16])[0] / 100;
  const b = hdr.applyCPU([16, 16, 16])[0] / 1000;
  if (!(a > 0.99)) throw new Error(`SDR が飽和していません (${a})`);
  if (!(b < 0.9)) throw new Error(`HDR に余裕がありません (${b})`);
  return `シーン 16 → SDR ${(a * 100).toFixed(1)}% / HDR ${(b * 100).toFixed(1)}%`;
});

// ---------------------------------------------------------------------------
// CPU と GPU の一致
// ---------------------------------------------------------------------------

test('CPU と GPU の結果が一致する', () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const renderer = new Renderer(canvas);
  if (!renderer.usesGPU) return 'この環境では WebGL2 が使えないので、このテストは飛ばしました';

  // 縦横に色を振った画像を作ります。1.0 を超える値も入れます。
  const img = new FloatImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const t = x / 63, u = y / 63;
      img.set(x, y, [0.001 * Math.pow(2, t * 16), 0.18 * (0.2 + u * 3), 0.05 + t * u * 8]);
    }
  }
  renderer.setImage(img);

  const chains = [
    new TransformChain([buildOutputTransform(OUTPUT_PRESETS.sdr100.opts)]),
    new TransformChain([buildOutputTransform(OUTPUT_PRESETS.hdr1000.opts), buildPQPreview({ peakNits: 1000 })]),
    new TransformChain([new MonitorCurveNode(2.4, 0.055, 'inverse'), gamutNode('AP1', 'sRGB')]),
    new TransformChain([new TransferNode('acescct', 'encode')]),
  ];

  let worst = 0;
  for (const chain of chains) {
    renderer.draw({ chainA: chain });
    const gl = renderer.gl;
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let y = 0; y < 64; y += 7) {
      for (let x = 0; x < 64; x += 7) {
        // WebGL の読み出しは下から上なので、y を反転します。
        const src = img.sample(x, y);
        const want = chain.applyCPU(src);
        const i = ((63 - y) * 64 + x) * 4;
        for (let k = 0; k < 3; k++) {
          const got = px[i + k] / 255;
          const w = Math.min(1, Math.max(0, want[k]));
          worst = Math.max(worst, Math.abs(got - w));
        }
      }
    }
  }
  renderer.dispose();
  if (worst > 1.5 / 255) throw new Error(`いちばん大きなずれが ${(worst * 255).toFixed(2)}/255 ありました`);
  return `いちばん大きなずれ ${(worst * 255).toFixed(2)}/255`;
});

test('GLSL の前置きに、必要な関数がそろっている', () => {
  const needed = ['srgb_encode', 'srgb_decode', 'rec709_encode', 'acescct_encode',
    'acescct_decode', 'pq_encode', 'pq_decode', 'hlg_encode', 'hlg_decode', 'sgn_pow'];
  for (const n of needed) {
    if (!GLSL_PRELUDE.includes(`float ${n}(`)) throw new Error(`${n} がありません`);
  }
  return `${needed.length} 個`;
});

// ---------------------------------------------------------------------------
// YAML パーサと設定
// ---------------------------------------------------------------------------

test('YAML: 基本の形が読める', () => {
  const doc = parseYAML(`a: 1
b: にほんご
c: [1, 2, 3]
d: {x: 1, y: "文字"}
e:
  - !<Tag> {name: foo}
  - !<Tag>
    name: bar
    v: 2.5
f: true
`);
  if (doc.a !== 1) throw new Error('数値が読めません');
  if (doc.b !== 'にほんご') throw new Error('日本語が読めません');
  if (doc.c.length !== 3) throw new Error('リストが読めません');
  if (doc.d.y !== '文字') throw new Error('インラインマップが読めません');
  if (doc.e[0].__tag !== 'Tag' || doc.e[0].name !== 'foo') throw new Error('型タグつきインラインが読めません');
  if (doc.e[1].name !== 'bar' || doc.e[1].v !== 2.5) throw new Error('型タグつきブロックが読めません');
  if (doc.f !== true) throw new Error('真偽値が読めません');
  return '7 種類';
});

test('YAML: 対応していない書きかたを、行番号つきで断る', () => {
  const cases = [
    { text: 'a: 1\nb:\n\tc: 2\n', line: 3, what: 'タブ' },
    { text: 'a: &anchor 1\n', line: 1, what: 'アンカー' },
    { text: 'a: 1\n---\nb: 2\n', line: 2, what: 'ドキュメント区切り' },
    { text: 'a 1\n', line: 1, what: 'コロン忘れ' },
  ];
  for (const c of cases) {
    let caught = null;
    try { parseYAML(c.text); } catch (err) { caught = err; }
    if (!caught) throw new Error(`${c.what} がエラーになりません`);
    if (!(caught instanceof YamlError)) throw new Error(`${c.what} のエラーの型がちがいます`);
    if (caught.line !== c.line) throw new Error(`${c.what} の行番号が ${caught.line}(期待 ${c.line})`);
    if (!caught.fixes.length) throw new Error(`${c.what} に直しかたの説明がありません`);
  }
  return `${cases.length} 種類`;
});

const CONFIG_FILES = ['minimal', 'broken-role', 'looks', 'two-displays', 'aces-lite'];

test('教材の設定が5本とも読める(broken-role だけは意図したエラー)', async () => 'あとで', true);

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

function renderResults(target, extra = []) {
  const all = [...results, ...extra];
  const okCount = all.filter((r) => r.ok).length;
  const head = document.createElement('p');
  head.className = 'test-summary ' + (okCount === all.length ? 't-pass' : 't-fail');
  head.textContent = `${all.length} 件中 ${okCount} 件が成功`
    + (okCount === all.length ? '。すべて問題ありません。' : `。${all.length - okCount} 件が失敗しました。`);
  target.replaceChildren(head);
  const list = document.createElement('div');
  list.className = 'test-list';
  for (const r of all) {
    const row = document.createElement('div');
    row.className = 'test-row ' + (r.ok ? 't-ok' : 't-fail');
    const mark = document.createElement('span');
    mark.className = 'test-mark';
    mark.textContent = r.ok ? 'OK' : 'NG';
    const name = document.createElement('span');
    name.className = 'test-name';
    name.textContent = r.name;
    const detail = document.createElement('span');
    detail.className = 'test-detail';
    detail.textContent = r.detail;
    row.append(mark, name, detail);
    list.appendChild(row);
  }
  target.appendChild(list);
}

/** 設定ファイルは読みこみが要るので、あとから走らせます。 */
async function configTests() {
  const extra = [];
  for (const name of CONFIG_FILES) {
    try {
      const res = await fetch(`assets/data/configs/${name}.ocio`);
      if (!res.ok) throw new Error(`読みこめません (${res.status})`);
      const text = await res.text();
      const { config, errors } = loadConfig(text);
      if (name === 'broken-role') {
        if (!errors.length) throw new Error('意図したエラーが出ませんでした');
        const e = errors[0];
        if (!e.problem.includes('scene_linear')) throw new Error('エラーの中身がちがいます');
        extra.push({ name: `設定 ${name}.ocio`, ok: true, detail: `${e.line}行目で意図どおりエラー` });
      } else {
        if (errors.length) throw new Error(errors.map((x) => x.toDisplay()).join(' / '));
        const d = config.getDisplayNames()[0];
        const v = config.getViewNames(d)[0];
        const chain = config.getProcessor({ src: config.getRole('scene_linear'), display: d, view: v });
        const grey = chain.applyCPU([0.18, 0.18, 0.18]);
        if (!(grey[0] > 0.05 && grey[0] < 0.95)) throw new Error(`中間グレーが ${grey[0]} になりました`);
        extra.push({
          name: `設定 ${name}.ocio`, ok: true,
          detail: `色空間 ${config.getColorSpaceNames().length} 個 / 中間グレー ${grey[0].toFixed(3)}`,
        });
      }
    } catch (err) {
      extra.push({ name: `設定 ${name}.ocio`, ok: false, detail: String(err.message || err) });
    }
  }

  // minimal.ocio は 40 行を超えないこと(第7章に全文を載せるため)
  try {
    const res = await fetch('assets/data/configs/minimal.ocio');
    const lines = (await res.text()).split('\n').filter((l) => l.trim()).length;
    if (lines > 40) throw new Error(`${lines} 行あります`);
    extra.push({ name: 'minimal.ocio が 40 行以内', ok: true, detail: `${lines} 行` });
  } catch (err) {
    extra.push({ name: 'minimal.ocio が 40 行以内', ok: false, detail: String(err.message || err) });
  }
  return extra;
}

export async function run(target) {
  // 仮置きのテストを取りのぞきます。
  const i = results.findIndex((r) => r.name.startsWith('教材の設定が5本とも'));
  if (i >= 0) results.splice(i, 1);
  renderResults(target, [{ name: '設定ファイルのテスト', ok: true, detail: '読みこみ中…' }]);
  const extra = await configTests();
  renderResults(target, extra);
}
