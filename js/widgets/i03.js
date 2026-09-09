// I-03 ガンマカーブ・エクスプローラ(第3章)
// ねらい: 伝達関数を目で見る。色空間ごとに曲線がちがうことを知る。

import { createWidget, el, buttonGroup, toggle, fmtNum } from '../core/ui.js';
import { TRANSFERS, to8bit, MIDDLE_GREY } from '../core/color.js';

const CURVES = [
  { value: 'linear', label: 'リニア' },
  { value: 'srgb', label: 'sRGB' },
  { value: 'rec709', label: 'Rec.709' },
  { value: 'gamma22', label: 'ガンマ2.2' },
  { value: 'acescct', label: 'ACEScct' },
  { value: 'demolog', label: 'Log(一例)' },
];

const NOTES = {
  linear: '曲げていません。光の量がそのまま数値になります。暗い側の段階が足りなくなります。',
  srgb: 'パソコンやスマホの標準です。暗い側に段階を多く割りあてています。',
  rec709: 'テレビ用です。sRGB とよく似ていますが、少しだけちがいます。',
  gamma22: 'いちばん単純な曲げ方です。sRGB とほぼ同じ形になります。',
  acescct: '色を調整するとき用です。とても広い明るさの範囲を扱えます。',
  demolog: '広い明るさを詰めこむ記録方式です。この曲線は学習用に作った一例で、実在のカメラの曲線ではありません。眠い灰色に見えるのはこのためです。',
};

const W = 520, H = 360, PAD = 46;

export default function i03(mount) {
  const w = createWidget(mount, {
    title: '曲がりかたを見てみる',
    aim: '横が光の量(0.0 が真っ暗、1.0 が基準の白。上限ではありません)、縦が保存される数値(0〜1。8bit の 0〜255 と同じもの)です。線の上をなぞると、対応する2つの値が読めます。',
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.classList.add('curve-svg');

  const ramp = el('canvas', { class: 'ramp-canvas', width: 512, height: 44 });
  w.view.append(svg, el('div', { class: 'pane' }, [
    el('div', { class: 'pane-label' }, [el('span', { text: 'この曲げかたで保存したグレーの帯' })]),
    ramp,
  ]));

  let curve = 'srgb';
  let logX = false;
  let probe = MIDDLE_GREY;

  const pick = buttonGroup({
    label: '曲げかた', options: CURVES, value: curve,
    onChange: (v) => { curve = v; draw(); }, compact: true,
  });
  const logToggle = toggle({
    label: '横軸を対数にする',
    note: '目もりが 0.001、0.01、0.1、1 と10倍ごとになります(右端だけ 16)。Log の形が見えるようになります',
    onChange: (v) => { logX = v; draw(); },
  });
  w.controls.append(pick.root, logToggle.root);
  w.onReset(() => { pick.set('srgb'); logToggle.set(false); probe = MIDDLE_GREY; draw(); });

  // 横軸の位置と光の量の対応。対数のときは 0.001 〜 16 の範囲を使います。
  const LO = 0.001, HI = 16;
  function xToLin(t) {
    return logX ? LO * Math.pow(HI / LO, t) : t;
  }
  function linToX(v) {
    if (!logX) return Math.min(1, Math.max(0, v));
    return Math.min(1, Math.max(0, Math.log(Math.max(LO, v) / LO) / Math.log(HI / LO)));
  }

  function px(t) { return PAD + t * (W - PAD - 14); }
  function py(v) { return H - PAD - Math.min(1.05, Math.max(-0.05, v)) * (H - PAD - 16); }

  function draw() {
    const fn = TRANSFERS[curve].encode;
    const parts = [];

    // 目もり
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      parts.push(`<line class="grid" x1="${px(0)}" y1="${py(v)}" x2="${px(1)}" y2="${py(v)}"/>`);
      parts.push(`<text class="ax" x="${px(0) - 8}" y="${py(v) + 4}" text-anchor="end">${v.toFixed(2)}</text>`);
    }
    const xticks = logX ? [0.001, 0.01, 0.1, 1, 16] : [0, 0.25, 0.5, 0.75, 1];
    for (const t of xticks) {
      const x = px(linToX(t));
      parts.push(`<line class="grid" x1="${x}" y1="${py(0)}" x2="${x}" y2="${py(1.05)}"/>`);
      parts.push(`<text class="ax" x="${x}" y="${py(0) + 20}" text-anchor="middle">${t}</text>`);
    }
    parts.push(`<text class="axname" x="${px(0.5)}" y="${H - 6}" text-anchor="middle">光の量</text>`);
    parts.push(`<text class="axname" transform="translate(13 ${py(0.5)}) rotate(-90)" text-anchor="middle">保存される数値</text>`);

    // 比較用のリニア線
    if (curve !== 'linear') {
      const lin = [];
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        lin.push(`${px(t)},${py(xToLin(t))}`);
      }
      parts.push(`<polyline class="curve-ref" points="${lin.join(' ')}"/>`);
    }

    // 本体の曲線
    const pts = [];
    for (let i = 0; i <= 300; i++) {
      const t = i / 300;
      pts.push(`${px(t)},${py(fn(xToLin(t)))}`);
    }
    parts.push(`<polyline class="curve-main" points="${pts.join(' ')}"/>`);

    // 中間グレーの位置。
    // 横(光の量)は 0.18 で固定です。中間グレーは「光の量が 0.18」という
    // 決めごとなので、曲げかたを変えても動きません。
    // 縦(保存される数値)は曲げかたごとに変わります。
    // ラベルに両方の数字を出さないと、どちらの軸の 0.18 なのか読者に伝わりません。
    const greyCode = fn(MIDDLE_GREY);
    const gx = px(linToX(MIDDLE_GREY)), gy = py(greyCode);
    parts.push(`<line class="grey-line" x1="${gx}" y1="${py(0)}" x2="${gx}" y2="${gy}"/>`);
    parts.push(`<line class="grey-line" x1="${px(0)}" y1="${gy}" x2="${gx}" y2="${gy}"/>`);
    parts.push(`<circle class="grey-dot" cx="${gx}" cy="${gy}" r="4.5"/>`);
    // 点の右上に2行で置きます。曲線や目もりと重なっても読めるよう、
    // 文字の下に背景の板を敷きます。
    const lx = gx + 12, ly = gy - 34;
    parts.push(`<rect class="grey-label-bg" x="${lx - 5}" y="${ly - 2}" width="152" height="32" rx="4"/>`);
    parts.push(`<text class="grey-label grey-label-strong" x="${lx}" y="${ly + 11}">中間グレー</text>`);
    parts.push(`<text class="grey-label" x="${lx}" y="${ly + 25}">光 0.18 → 数値 ${greyCode.toFixed(3)}</text>`);

    // 読み取り点
    const ppx = px(linToX(probe)), ppy = py(fn(probe));
    parts.push(`<circle class="probe-dot" cx="${ppx}" cy="${ppy}" r="6"/>`);

    svg.innerHTML = `<title>${TRANSFERS[curve].label} の曲線</title>
      <desc>横軸が光の量、縦軸が保存される数値のグラフ。中間グレーは光の量 0.18 で、この曲げかたでは保存される数値が ${greyCode.toFixed(3)} になります。光の量 0.18 はどの曲げかたでも変わりません。</desc>
      ${parts.join('\n')}`;

    drawRamp(fn);

    const code = fn(probe);
    w.say(`<span class="kv">光の量 ${fmtNum(probe, 3)}</span> → <span class="kv">数値 ${code.toFixed(3)}</span>
      → <span class="kv">8bit ${to8bit(code)}</span>(0〜255の256段階)。
      ${NOTES[curve]}`);
  }

  // グレーの帯。横軸と同じ並びで、左から右へ光の量が増えます。
  // (対数にしていないときは 0〜1 の等間隔、対数にしているときは 0.001〜16 です)
  function drawRamp(fn) {
    const ctx = ramp.getContext('2d');
    const im = ctx.createImageData(ramp.width, ramp.height);
    for (let x = 0; x < ramp.width; x++) {
      const t = x / (ramp.width - 1);
      const lin = xToLin(t);
      const v = to8bit(fn(lin));
      for (let y = 0; y < ramp.height; y++) {
        const i = (y * ramp.width + x) * 4;
        im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
  }

  function moveProbe(clientX) {
    const r = svg.getBoundingClientRect();
    const t = (clientX - r.left) / r.width * W;
    const frac = (t - px(0)) / (px(1) - px(0));
    probe = xToLin(Math.min(1, Math.max(0, frac)));
    draw();
  }
  svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); moveProbe(e.clientX); });
  svg.addEventListener('pointermove', (e) => { if (e.buttons) moveProbe(e.clientX); });

  // キーボードでも読み取り点を動かせるようにします。
  // 左右キーで 1%、Shift を押しながらで 10% ずつ動きます。
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', '伝達関数のグラフ。左右キーで読み取り点を動かせます');
  svg.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.1 : 0.01) * dir;
    probe = xToLin(Math.min(1, Math.max(0, linToX(probe) + step)));
    draw();
  });

  draw();

  w.setDetails(`
    <p>点線がリニア(曲げない場合)、太い線がいま選んでいる曲げかたです。
       sRGB を選ぶと、線がリニアより上にふくらむのが分かります。
       暗い光にも大きめの数値を割りあてている、という意味です。</p>
    <p>Log と ACEScct を選ぶと、光の量が 1.0 を大きく超えても数値が 1.0 に収まっています。
       とても明るいところまで記録できるのがこの形の利点です。
       横軸を対数にすると、Log の線がまっすぐになります。</p>
    <div class="callout">
      <p class="note-title">中間グレーの点は、なぜ横に動かないの?</p>
      <p>まず、この 0.18 は<b>光の量のほうの数字</b>です。0〜255 のうちの 0.18 ではありません。
         光の量は「0.0 が真っ暗、1.0 が基準の白」として書きます。
         基準の白とは「当たった光をぜんぶ返す理想の白」のことで、上限ではありません。
         その目もりの上の 0.18、つまり反射率 18% の灰色、という意味です。</p>
      <p>曲げかたを切りかえると、中間グレーの点は<b>上下には動きますが、左右には動きません</b>。
         これは「中間グレー = 光の量が 0.18」という決めごとだからです。
         カメラの前に置いた灰色の板が反射する光の量そのものなので、
         あとから数値をどう曲げても、光の量のほうは変わりません。</p>
      <p>変わるのは「その光を、いくつという数値で保存するか」のほうです。
         同じ中間グレーでも、曲げかたによってこれだけ変わります。</p>
      <div class="table-wrap">
      <table>
        <thead><tr><th>曲げかた</th><th class="num">光の量</th><th class="num">保存される数値</th><th class="num">8bit(0〜255)</th></tr></thead>
        <tbody>
          <tr><td>リニア</td><td class="num">0.18</td><td class="num">0.180</td><td class="num">46</td></tr>
          <tr><td>sRGB</td><td class="num">0.18</td><td class="num">0.461</td><td class="num">118</td></tr>
          <tr><td>Rec.709</td><td class="num">0.18</td><td class="num">0.409</td><td class="num">104</td></tr>
          <tr><td>ガンマ2.2</td><td class="num">0.18</td><td class="num">0.459</td><td class="num">117</td></tr>
          <tr><td>ACEScct</td><td class="num">0.18</td><td class="num">0.414</td><td class="num">105</td></tr>
          <tr><td>Log(一例)</td><td class="num">0.18</td><td class="num">0.399</td><td class="num">102</td></tr>
        </tbody>
      </table>
      </div>
      <p>リニアだけ 0.18 のままなのは、リニアが「曲げない」やりかただからです。
         光の量と数値が同じ、ということです。</p>
    </div>
  `);
}
