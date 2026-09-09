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
  demolog: '広い明るさを詰めこむ記録方式の一例です。眠い灰色に見えるのはこのためです。',
};

const W = 520, H = 360, PAD = 46;

export default function i03(mount) {
  const w = createWidget(mount, {
    title: '曲がりかたを見てみる',
    aim: '横が光の量、縦が保存される数値です。線の上をなぞると、対応する2つの値が読めます。',
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  const title = document.createElementNS(svgNS, 'title');
  const desc = document.createElementNS(svgNS, 'desc');
  svg.append(title, desc);
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
    note: 'Log の形が見えるようになります',
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

    // 中間グレー 0.18 の位置
    const gx = px(linToX(MIDDLE_GREY)), gy = py(fn(MIDDLE_GREY));
    parts.push(`<line class="grey-line" x1="${gx}" y1="${py(0)}" x2="${gx}" y2="${gy}"/>`);
    parts.push(`<line class="grey-line" x1="${px(0)}" y1="${gy}" x2="${gx}" y2="${gy}"/>`);
    parts.push(`<circle class="grey-dot" cx="${gx}" cy="${gy}" r="4.5"/>`);
    parts.push(`<text class="grey-label" x="${gx + 8}" y="${gy - 8}">中間グレー 0.18</text>`);

    // 読み取り点
    const ppx = px(linToX(probe)), ppy = py(fn(probe));
    parts.push(`<circle class="probe-dot" cx="${ppx}" cy="${ppy}" r="6"/>`);

    svg.innerHTML = `<title>${TRANSFERS[curve].label} の曲線</title>
      <desc>横軸が光の量、縦軸が保存される数値のグラフ。中間グレー 0.18 は数値 ${fn(MIDDLE_GREY).toFixed(3)} の位置にあります。</desc>
      ${parts.join('\n')}`;

    drawRamp(fn);

    const code = fn(probe);
    w.say(`<span class="kv">光の量 ${fmtNum(probe, 3)}</span> → <span class="kv">数値 ${code.toFixed(3)}</span>
      → <span class="kv">8bit ${to8bit(code)}</span>。
      ${NOTES[curve]}`);
  }

  // グレーの帯。左から右へ光の量が 1段ずつ(2倍ずつ)増えます。
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

  draw();

  w.setDetails(`
    <p>点線がリニア(曲げない場合)、太い線がいま選んでいる曲げかたです。
       sRGB を選ぶと、線がリニアより上にふくらむのが分かります。
       暗い光にも大きめの数値を割りあてている、という意味です。</p>
    <p>Log と ACEScct を選ぶと、光の量が 1.0 を大きく超えても数値が 1.0 に収まっています。
       とても明るいところまで記録できるのがこの形の利点です。
       横軸を対数にすると、Log の線がまっすぐになります。</p>
  `);
}
