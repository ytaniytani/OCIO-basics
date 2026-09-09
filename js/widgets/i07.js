// I-07 リニア合成ラボ(第5章)
// ねらい: 同じ操作でも、どの空間で計算するかで結果が変わることを確かめる。
//
// 上のパネル: 光の量(シーンリニア)のまま計算して、最後に画面用にする ← 正しい
// 下のパネル: 先に画面用の数値にしてから計算する               ← よくある間違い

import {
  createWidget, imagePane, paneGrid, buttonGroup, slider, toggle, el, fmtNum,
} from '../core/ui.js';
import { Renderer, FloatImage, blur, downsample, mapImage } from '../core/render.js';
import {
  TransformChain, buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';
import { TRANSFERS, gamutConversionMatrix, matApply } from '../core/color.js';

const SRGB_TO_AP1 = gamutConversionMatrix('sRGB', 'AP1');
const toAP1 = (rgb) => matApply(SRGB_TO_AP1, rgb.map((v) => TRANSFERS.srgb.decode(v)));

const W = 320, H = 180;

const OPS = [
  { value: 'add', label: '足す(光を2つ)' },
  { value: 'alpha', label: '半透明を重ねる' },
  { value: 'blur', label: 'ぼかす' },
  { value: 'resize', label: '小さくする' },
  { value: 'glow', label: '光をにじませる' },
];

const OP_INFO = {
  add: {
    aim: '2つのライトの光を足しあわせます。',
    param: { label: '2つ目のライトの強さ', min: 0, max: 2, step: 0.05, value: 1 },
    wrong: '重なったところが真っ白につぶれます。足しすぎた計算になっています。',
    right: '2つの光が正しく足しあわされ、重なりの中心だけが明るくなります。',
  },
  alpha: {
    aim: '半透明の丸を、背景に重ねます。',
    param: { label: '丸の不透明度(0=すきとおる / 1=すけない)', min: 0, max: 1, step: 0.02, value: 0.5 },
    wrong: '境目に暗いふちが出ます。混ざりぐあいが足りません。',
    right: '境目がなめらかにつながります。',
  },
  blur: {
    aim: '画像全体をぼかします。',
    param: { label: 'ぼかしの強さ', min: 0, max: 14, step: 1, value: 8 },
    wrong: '全体が暗くなります。明るい点のにじみも弱くなります。',
    right: '明るさが保たれたままぼけます。明るい点は大きく広がります。',
  },
  resize: {
    aim: '画像を4分の1の大きさに縮めます。',
    param: { label: '縮小の度合い', min: 2, max: 8, step: 1, value: 4 },
    wrong: '細かい模様のところが暗く沈みます。',
    right: '細かい模様のところも、もとの明るさのまま残ります。',
  },
  glow: {
    aim: '明るいところを、まわりににじませます。',
    param: { label: 'にじみの強さ', min: 0, max: 2, step: 0.05, value: 1 },
    wrong: 'にじみが白くつぶれて、光の強さのちがいが分からなくなります。',
    right: '強い光ほど遠くまでにじみます。',
  },
};

export default function i07(mount) {
  const w = createWidget(mount, {
    title: '同じ操作、ちがう計算のしかた',
    aim: 'どちらも同じ操作です。ちがうのは、光の量のまま計算したか、画面用の数値のまま計算したかだけです。',
    simplified: true,
    wide: true,
  });

  const paneA = imagePane('光の量のまま計算(正しい)', '');
  const paneB = imagePane('画面用の数値のまま(まちがい)', '');
  const paneD = imagePane('ちがい(8倍に強調)', '');
  paneD.root.hidden = true;
  w.view.appendChild(paneGrid(2, [paneA, paneB]));
  const diffWrap = el('div', { class: 'diff-wrap', hidden: true }, [paneD.root]);
  paneD.root.hidden = false;
  w.view.appendChild(diffWrap);

  const rA = new Renderer(paneA.canvas);
  const rB = new Renderer(paneB.canvas);
  const rD = new Renderer(paneD.canvas);

  const output = buildOutputTransform(OUTPUT_PRESETS.sdr100.opts);
  const outputChain = new TransformChain([output]);
  const identity = new TransformChain([]);

  let op = 'add';
  let strength = OP_INFO.add.param.value;
  let showDiff = false;

  const opPick = buttonGroup({
    label: '操作', options: OPS, value: op, compact: true,
    onChange: (v) => { op = v; param.set(OP_INFO[v].param.value, true); strength = OP_INFO[v].param.value; rebuildParam(); update(); },
  });
  let param = slider({
    ...OP_INFO.add.param,
    onChange: (v) => { strength = v; update(); },
  });
  const paramSlot = el('div');
  paramSlot.appendChild(param.root);
  const diffToggle = toggle({
    label: 'ちがいを強調して表示',
    onChange: (v) => { showDiff = v; diffWrap.hidden = !v; update(); },
  });

  w.controls.append(opPick.root, paramSlot, diffToggle.root);
  w.onReset(() => {
    opPick.set('add', true); op = 'add';
    rebuildParam();
    diffToggle.set(false, true); showDiff = false; diffWrap.hidden = true;
    update();
  });

  function rebuildParam() {
    const p = OP_INFO[op].param;
    strength = p.value;
    param = slider({ ...p, onChange: (v) => { strength = v; update(); } });
    paramSlot.replaceChildren(param.root);
  }

  // -------------------------------------------------------------------------
  // もとになる画像。すべてここで作ります。
  // -------------------------------------------------------------------------

  function makeLight(cx, cy, color, gain) {
    const img = new FloatImage(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x / W - cx) * 1.7, dy = y / H - cy;
        const d = dx * dx + dy * dy;
        const i = Math.exp(-d / 0.045) * gain;
        img.set(x, y, [color[0] * i, color[1] * i, color[2] * i]);
      }
    }
    return img;
  }

  function makePattern() {
    const img = new FloatImage(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        let c;
        if (v < 0.5) {
          // 上半分: 細かいしま模様(縮小とぼかしで差が出ます)
          const stripe = Math.sin(x * 1.1) > 0 ? 0.9 : 0.02;
          c = toAP1([stripe, stripe * 0.9, stripe * 0.8]);
        } else {
          // 下半分: 暗い背景に明るい点
          c = toAP1([0.05, 0.06, 0.09]);
        }
        // 明るい点をいくつか
        for (const p of [[0.25, 0.74, 60], [0.5, 0.74, 200], [0.75, 0.74, 700]]) {
          const dx = (u - p[0]) * 1.7, dy = v - p[1];
          const d = dx * dx + dy * dy;
          const i = Math.exp(-d / 0.00025) * p[2];
          c = [c[0] + i, c[1] + i * 0.96, c[2] + i * 0.9];
        }
        img.set(x, y, c);
      }
    }
    return img;
  }

  function makeAlphaPair() {
    const bg = new FloatImage(W, H);
    const fg = new FloatImage(W, H);
    const alpha = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        bg.set(x, y, toAP1([0.05 + u * 0.85, 0.55 - v * 0.4, 0.12 + v * 0.7]));
        fg.set(x, y, toAP1([0.95, 0.85, 0.15]));
        const dx = (u - 0.5) * 1.7, dy = v - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        alpha[y * W + x] = 1 - Math.min(1, Math.max(0, (d - 0.22) / 0.10));
      }
    }
    return { bg, fg, alpha };
  }

  const lightA = makeLight(0.36, 0.5, toAP1([1, 0.35, 0.25]), 1.0);
  const lightB = makeLight(0.64, 0.5, toAP1([0.25, 0.5, 1]), 1.0);
  const pattern = makePattern();
  const alphaPair = makeAlphaPair();

  // 画面用の数値にした版(「よくある間違い」の入力になります)
  const encode = (img) => mapImage(img, (c) => output.applyCPU(c));
  const encLightA = encode(lightA);
  const encLightB = encode(lightB);
  const encPattern = encode(pattern);
  const encBG = encode(alphaPair.bg);
  const encFG = encode(alphaPair.fg);

  function addImages(a, b, gain) {
    const out = new FloatImage(a.width, a.height);
    for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] + b.data[i] * gain;
    return out;
  }

  function clampImage(img) {
    const out = new FloatImage(img.width, img.height);
    for (let i = 0; i < out.data.length; i++) out.data[i] = Math.min(1, Math.max(0, img.data[i]));
    return out;
  }

  function overImages(fg, bg, alpha, opacity) {
    const out = new FloatImage(fg.width, fg.height);
    for (let p = 0, i = 0; p < alpha.length; p++, i += 3) {
      const a = alpha[p] * opacity;
      out.data[i] = fg.data[i] * a + bg.data[i] * (1 - a);
      out.data[i + 1] = fg.data[i + 1] * a + bg.data[i + 1] * (1 - a);
      out.data[i + 2] = fg.data[i + 2] * a + bg.data[i + 2] * (1 - a);
    }
    return out;
  }

  function glowImage(src, threshold, gain) {
    const bright = mapImage(src, (c) => c.map((v) => Math.max(0, v - threshold)));
    const soft = blur(bright, 10);
    const out = new FloatImage(src.width, src.height);
    for (let i = 0; i < out.data.length; i++) out.data[i] = src.data[i] + soft.data[i] * gain;
    return out;
  }

  /** いまの操作について、正しい結果とまちがった結果の2枚を返します。 */
  function compute() {
    switch (op) {
      case 'add':
        return {
          a: addImages(lightA, lightB, strength),
          b: clampImage(addImages(encLightA, encLightB, strength)),
        };
      case 'alpha':
        return {
          a: overImages(alphaPair.fg, alphaPair.bg, alphaPair.alpha, strength),
          b: clampImage(overImages(encFG, encBG, alphaPair.alpha, strength)),
        };
      case 'blur':
        return { a: blur(pattern, strength), b: clampImage(blur(encPattern, strength)) };
      case 'resize':
        return {
          a: downsample(pattern, strength),
          b: clampImage(downsample(encPattern, strength)),
        };
      case 'glow':
      default:
        return {
          a: glowImage(pattern, 1.0, strength),
          b: clampImage(glowImage(encPattern, 0.75, strength)),
        };
    }
  }

  /** 表示したあとの2枚の差を、目に見える形にした画像を作ります。 */
  function diffImage(a, b) {
    const da = mapImage(a, (c) => output.applyCPU(c));
    const out = new FloatImage(a.width, a.height);
    for (let i = 0; i < out.data.length; i++) {
      out.data[i] = Math.min(1, Math.abs(da.data[i] - b.data[i]) * 8);
    }
    return out;
  }

  let pending = null;
  function update() {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = null;
      const { a, b } = compute();
      rA.setImage(a); rB.setImage(b);
      rA.resizeToDisplay(640); rB.resizeToDisplay(640);
      rA.draw({ chainA: outputChain });
      rB.draw({ chainA: identity });
      const info = OP_INFO[op];
      paneA.setTag('');
      paneB.setTag('');
      if (showDiff) {
        const d = diffImage(a, b);
        rD.setImage(d); rD.resizeToDisplay(640);
        rD.draw({ chainA: identity });
      }
      // 同じ場所の明るさを数字で比べます。
      const probe = op === 'add' ? [0.5, 0.5] : op === 'alpha' ? [0.5, 0.5] : [0.5, 0.25];
      const pa = output.applyCPU(a.sample(a.width * probe[0], a.height * probe[1]))[1];
      const pb = b.sample(b.width * probe[0], b.height * probe[1])[1];
      const diffPct = Math.abs(pa - pb) * 100;
      w.say(`<b>下</b>: ${info.wrong} <b>上</b>: ${info.right}<br>
        同じ場所の明るさ: 上 <b>${pa.toFixed(3)}</b> / 下 <b>${pb.toFixed(3)}</b>
        (ちがい ${fmtNum(diffPct, 1)}%)`);
    });
  }

  update();
  window.addEventListener('resize', update);

  w.setDetails(`
    <p>足し算・平均・ぼかし・縮小は、どれも「光の量をまぜる」計算です。
       だから光の量に比例した数値のうえでやらないと、物理的に正しい結果になりません。</p>
    <p>かんたんな例で確かめます。画面用の数値 0.5 は、光の量では 0.214 でした。</p>
    <ul>
      <li><b>正しいやりかた</b>: 0.214 + 0.214 = 0.428 の光 → 画面用の数値では 0.686(8bit で 175)</li>
      <li><b>まちがい</b>: 0.5 + 0.5 = 1.0 → 真っ白</li>
    </ul>
    <p>まちがったほうは、光を2倍にしただけなのに真っ白になってしまいました。</p>
    <p>ぼかしや縮小は「たくさんの画素の平均」です。こちらは逆に暗くなります。
       黒(0)と白(1)を半分ずつ混ぜた場合で確かめます。</p>
    <ul>
      <li><b>正しいやりかた</b>: 光の量で平均 → 0.5 の光 → 画面用の数値では 0.735</li>
      <li><b>まちがい</b>: 画面用の数値のまま平均 → 0.5 → 光の量にすると 0.214 しかない</li>
    </ul>
    <p>足し算では明るくなりすぎ、平均では暗くなりすぎます。どちらも
       「比例していない数字を計算に使った」ことが原因です。</p>
    <p>だから CG や合成の作業は、必ず光の量のまま(シーンリニアで)行います。
       画面用に変換するのは、見るときのいちばん最後だけです。
       <b>この「作業する空間と、見るための空間を分ける」考えかたが、OCIO の土台になります。</b></p>
  `);
}
